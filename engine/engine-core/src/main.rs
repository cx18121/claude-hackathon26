use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use tower_http::services::ServeDir;
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};

mod protocol;
mod room;
mod room_manager;
mod input_delay;
mod broadcast;
mod game_loop;

pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let state = Arc::new(AppState {
        rooms: Arc::new(room_manager::RoomManager::new()),
    });
    // Spawn room expiry background task (D-08)
    tokio::spawn(room_manager::expiry_task(state.rooms.rooms.clone()));
    let app = Router::new()
        .route("/ws/player/{room_code}", get(ws_player))
        .route("/ws/spectator/{room_code}", get(ws_spectator))
        .nest_service("/mobile", ServeDir::new("mobile/dist"))
        .nest_service("/overlay", ServeDir::new("overlay/dist"))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await.unwrap();
    tracing::info!("engine-core listening on 0.0.0.0:8000");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_player(
    Path(room_code): Path<String>,
    State(app): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_player(socket, room_code, app))
}

async fn handle_player(
    socket: axum::extract::ws::WebSocket,
    room_code: String,
    app: Arc<AppState>,
) {
    use axum::extract::ws::Message;
    use tokio::sync::oneshot;
    use crate::room::RoomCmd;
    use crate::protocol::InboundMobileMsg;

    let (mut ws_sink, mut ws_stream) = socket.split();

    // ENG-05: dedicated outbound Tokio task with bounded mpsc channel (capacity 32)
    let (player_tx, mut player_rx) = tokio::sync::mpsc::channel::<String>(32);
    tokio::spawn(async move {
        while let Some(msg) = player_rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // PROTO-01 / join-first: read the first message — must be MsgJoin.
    // Extract player_slot (1-indexed from client, convert to 0-indexed).
    let slot_idx: usize = match ws_stream.next().await {
        Some(Ok(Message::Text(raw))) => {
            match serde_json::from_str::<InboundMobileMsg>(&raw) {
                Ok(InboundMobileMsg::Join(msg)) => {
                    // player_slot is 1 or 2; convert to 0-indexed
                    let slot = (msg.player_slot as usize).saturating_sub(1);
                    if slot >= 2 {
                        tracing::warn!("handle_player: invalid player_slot {}, closing", msg.player_slot);
                        return;
                    }
                    slot
                }
                Ok(_) | Err(_) => {
                    tracing::warn!("handle_player: first message was not a join, closing {}", room_code);
                    return; // Close connection — join must be first
                }
            }
        }
        _ => {
            tracing::warn!("handle_player: connection closed before join message, room {}", room_code);
            return;
        }
    };

    // ENG-02 room-on-demand: get cmd_tx, creating the room if it doesn't exist yet.
    // Clone immediately — do NOT hold DashMap guard across await (Pitfall 4).
    // actual_code is the real room code (may differ from room_code if collision occurred).
    let actual_code: String;
    let cmd_tx = match app.rooms.get_cmd_tx(&room_code) {
        Some(tx) => {
            actual_code = room_code.clone();
            tx
        }
        None => {
            // Room does not exist — create it on demand using the client-provided code.
            let created_code = app.rooms.create_room(room_code.clone());
            tracing::info!("room {} created on demand for player {}", created_code, slot_idx + 1);
            match app.rooms.get_cmd_tx(&created_code) {
                Some(tx) => {
                    actual_code = created_code;
                    tx
                }
                None => {
                    tracing::error!("room {} missing after create_room — logic error", created_code);
                    return;
                }
            }
        }
    };
    let pose_tx = match app.rooms.rooms.get(&actual_code).map(|h| h.pose_tx.clone()) {
        Some(tx) => tx,
        None => {
            tracing::error!("room {} missing pose_tx after create_room — logic error", actual_code);
            return;
        }
    };

    // Send PlayerConnect to actor — slot is determined by the join message.
    let (reply_tx, reply_rx) = oneshot::channel();
    if cmd_tx.send(RoomCmd::PlayerConnect {
        slot: slot_idx,
        tx: player_tx.clone(),
        reply: reply_tx,
    }).await.is_err() {
        return;
    }
    let connect_result = match reply_rx.await {
        Ok(Some(r)) => r,
        Ok(None) => {
            tracing::warn!("room {} slot {} already occupied", room_code, slot_idx + 1);
            return;
        }
        Err(_) => return,
    };

    tracing::info!("player {} connected to room {}", connect_result.slot + 1, room_code);

    // Send MsgJoined back to client
    use crate::protocol::MsgJoined;
    if let Ok(json) = serde_json::to_string(&MsgJoined {
        msg_type: "joined".to_string(),
        room_code: room_code.clone(),
        player_slot: (connect_result.slot + 1) as u8,
        opponent_connected: connect_result.opponent_connected,
    }) {
        let _ = player_tx.send(json).await;
    }

    // Receive loop: parse, dispatch (log-and-continue on bad input)
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(raw) => {
                match serde_json::from_str::<InboundMobileMsg>(&raw) {
                    Ok(InboundMobileMsg::PoseFrame(frame)) => {
                        let arrived_at = std::time::Instant::now();
                        // Immediate pose fan-out to spectators (ENG-07) — before sending to actor
                        use crate::protocol::MsgPoseUpdate;
                        let pu = MsgPoseUpdate {
                            msg_type: "pose_update".to_string(),
                            player: (slot_idx + 1) as u8,
                            keypoints: frame.keypoints.clone(),
                        };
                        if let Ok(json) = serde_json::to_string(&pu) {
                            let _ = pose_tx.send(json);
                        }
                        // Then route to actor for game loop processing
                        let _ = cmd_tx.send(RoomCmd::PoseFrame { slot: slot_idx, frame, arrived_at }).await;
                    }
                    Ok(InboundMobileMsg::Ping(ping)) => {
                        use crate::protocol::MsgPong;
                        if let Ok(json) = serde_json::to_string(&MsgPong { msg_type: "pong".to_string(), t: ping.t }) {
                            let _ = player_tx.send(json).await;
                        }
                    }
                    Ok(InboundMobileMsg::Pong(pong)) => {
                        let _ = cmd_tx.send(RoomCmd::RecordPong { slot: slot_idx, original_t: pong.t }).await;
                    }
                    Ok(InboundMobileMsg::CalibrationDone(cal)) => {
                        let _ = cmd_tx.send(RoomCmd::CalibrationDone { slot: slot_idx, reference_velocity: cal.reference_velocity }).await;
                    }
                    Ok(InboundMobileMsg::Join(_)) => {
                        // Ignore re-join messages during session (join was already processed above)
                    }
                    Err(e) => {
                        tracing::warn!("player {} bad message in room {}: {}", slot_idx + 1, room_code, e);
                        // log-and-continue (Python pattern)
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Disconnect
    let _ = cmd_tx.send(RoomCmd::PlayerDisconnect { slot: slot_idx }).await;
    tracing::info!("player {} disconnected from room {}", slot_idx + 1, room_code);
}

async fn ws_spectator(
    Path(room_code): Path<String>,
    State(app): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_spectator(socket, room_code, app))
}

async fn handle_spectator(
    socket: axum::extract::ws::WebSocket,
    room_code: String,
    app: Arc<AppState>,
) {
    use tokio::sync::oneshot;
    use crate::room::RoomCmd;

    // Get broadcast channels and cmd_tx — do NOT hold DashMap guard across await (Pitfall 4)
    let (game_rx, pose_rx, cmd_tx) = match app.rooms.subscribe_spectator(&room_code) {
        Some(channels) => channels,
        None => {
            tracing::warn!("spectator tried to join unknown room {}", room_code);
            return;
        }
    };

    tracing::info!("spectator connected to room {}", room_code);

    let (mut ws_sink, mut ws_stream) = socket.split();

    // FIX-02: Subscribe to broadcast BEFORE requesting snapshot (Pitfall 6)
    // Subscription already active (game_rx and pose_rx are live receivers from subscribe_spectator)
    // Now request snapshot from room actor via oneshot
    let (reply_tx, reply_rx) = oneshot::channel();
    if cmd_tx.send(RoomCmd::GetSnapshot { reply: reply_tx }).await.is_err() {
        return;
    }
    let snapshot = match reply_rx.await {
        Ok(s) => s,
        Err(_) => return,
    };

    // Send snapshot before entering broadcast forward loop (FIX-02)
    if !crate::broadcast::send_snapshot(&mut ws_sink, snapshot).await {
        return; // spectator disconnected during snapshot send
    }

    // Spawn spectator forward task (consumes ws_sink, game_rx, pose_rx)
    let forward_handle = tokio::spawn(
        crate::broadcast::forward_broadcast_to_spectator(ws_sink, game_rx, pose_rx)
    );

    // Drain spectator's inbound stream (keep-alive, discard all input like Python server)
    // T-04-02: All inbound messages from spectators are discarded without parsing
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            axum::extract::ws::Message::Close(_) => break,
            _ => {} // discard — spectators are read-only
        }
    }

    // Spectator disconnected — abort the forward task
    forward_handle.abort();
    tracing::info!("spectator disconnected from room {}", room_code);
}
