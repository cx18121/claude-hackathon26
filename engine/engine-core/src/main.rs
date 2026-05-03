use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tower_http::services::ServeDir;
use std::sync::Arc;
use std::collections::HashMap;
use futures_util::{SinkExt, StreamExt};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use plugin_trait::GamePlugin;
use boxing_plugin::{BoxingPlugin, BoxingConfig};
use boxing_plugin::Difficulty;
use dance_plugin::{DancePlugin, DanceConfig};

mod protocol;
mod room;
mod room_manager;
mod input_delay;
mod broadcast;
mod game_loop;

pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let boxing_config = BoxingConfig {
        hp: 800,
        round_secs: 90.0,
        max_wins: 3,
        bot_difficulty: Difficulty::Normal,
    };
    let dance_config = DanceConfig { max_wins: 3 };
    // Build plugin registry before Arc::new — cannot insert after wrapping (Pitfall 2)
    let mut plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>> = HashMap::new();
    plugins.insert("boxing".to_string(), Arc::new(BoxingPlugin::new(boxing_config)));
    plugins.insert("dance".to_string(), Arc::new(DancePlugin::new(dance_config)));
    let state = Arc::new(AppState {
        rooms: Arc::new(room_manager::RoomManager::new()),
        plugins,
    });
    // Spawn room expiry background task (D-08)
    tokio::spawn(room_manager::expiry_task(state.rooms.rooms.clone()));
    let app = Router::new()
        .route("/", get(lobby_html))
        .route("/rooms", post(create_room))
        .route("/ws/player/{room_code}", get(ws_player))
        .route("/ws/spectator/{room_code}", get(ws_spectator))
        .nest_service("/mobile", ServeDir::new("mobile/dist"))
        .nest_service("/overlay", ServeDir::new("overlay/dist"))
        .with_state(state);
    let port = std::env::var("PORT").unwrap_or_else(|_| "8000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("engine-core listening on {}", addr);
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
                    // WR-05: reject slot=0 explicitly; saturating_sub(1) would silently map 0→0 (same as slot 1)
                    if msg.player_slot == 0 || msg.player_slot > 2 {
                        tracing::warn!("handle_player: invalid player_slot {}, closing", msg.player_slot);
                        return;
                    }
                    // player_slot is 1 or 2; convert to 0-indexed
                    (msg.player_slot as usize) - 1
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

    // Option A: room must be pre-created via POST /rooms — no on-demand creation.
    // Clone immediately — do NOT hold DashMap guard across await (Pitfall 4).
    let actual_code: String;
    let cmd_tx = match app.rooms.get_cmd_tx(&room_code) {
        Some(tx) => {
            actual_code = room_code.clone();
            tx
        }
        None => {
            tracing::warn!(
                "handle_player: room {} not found; rooms must be pre-created via POST /rooms",
                room_code
            );
            return;
        }
    };
    let pose_tx = match app.rooms.rooms.get(&actual_code).map(|h| h.pose_tx.clone()) {
        Some(tx) => tx,
        None => {
            tracing::error!("room {} missing pose_tx — logic error", actual_code);
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

const LOBBY_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PoseEngine Lobby</title>
  <style>
    :root {
      --bg-deep: oklch(7% 0.008 22);
      --bg-mid: oklch(11% 0.009 22);
      --bg-surface: oklch(17% 0.01 22);
      --accent: oklch(44% 0.22 22);
      --accent-bright: oklch(60% 0.25 22);
      --text-primary: oklch(95% 0.008 85);
      --text-secondary: oklch(65% 0.008 85);
      --text-dim: oklch(38% 0.006 85);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-deep);
      color: var(--text-primary);
      max-width: 480px;
      margin: 48px auto;
      padding: 0 16px;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin-bottom: 32px;
    }
    p.subtitle {
      font-size: 0.8rem;
      font-weight: 800;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 16px;
    }
    .btn-row { display: flex; gap: 8px; }
    button {
      min-height: 52px;
      padding: 16px 24px;
      background: var(--bg-surface);
      border: 1px solid var(--text-dim);
      color: var(--text-primary);
      font-size: 1rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.15s, border-color 0.15s;
    }
    button:hover { background: var(--accent); border-color: var(--accent-bright); }
    button:active { transform: scale(0.98); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #room-code {
      font-size: 2rem;
      font-weight: 800;
      letter-spacing: 0.2em;
      margin-top: 16px;
      color: var(--text-primary);
    }
    #room-code.error {
      color: #ff9b9b;
      background: rgba(226, 91, 91, 0.15);
      border: 1px solid rgba(226, 91, 91, 0.4);
      padding: 8px 12px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>Choose a Game</h1>
  <p class="subtitle">Create a room, then enter the code in the mobile app</p>
  <div class="btn-row">
    <button id="btn-boxing" onclick="createRoom('boxing')">Boxing</button>
    <button id="btn-dance" onclick="createRoom('dance')">Dance</button>
  </div>
  <div id="room-code"></div>
  <script>
    async function createRoom(game) {
      const buttons = document.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      const rc = document.getElementById('room-code');
      rc.className = '';
      rc.textContent = '';
      try {
        const res = await fetch('/rooms?game=' + game, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          rc.textContent = data.room_code;
        } else {
          rc.className = 'error';
          rc.textContent = data.error ?? 'Server error';
        }
      } catch (_) {
        rc.className = 'error';
        rc.textContent = 'Could not reach server';
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    }
  </script>
</body>
</html>"#;

async fn lobby_html() -> impl IntoResponse {
    axum::response::Html(LOBBY_HTML)
}

#[derive(Deserialize)]
struct CreateRoomParams {
    game: Option<String>,
}

#[derive(Serialize)]
struct CreateRoomResponse {
    room_code: String,
}

async fn create_room(
    Query(params): Query<CreateRoomParams>,
    State(app): State<Arc<AppState>>,
) -> impl IntoResponse {
    let game = params.game.as_deref().unwrap_or("boxing");
    match app.plugins.get(game) {
        Some(plugin) => {
            // Generate a random 6-char code upfront — passing "" would claim the "" slot
            // on the first call since create_room only retries on key collision, not on empty input.
            let initial_code: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(|c| char::from(c).to_ascii_uppercase())
                .collect();
            let code = app.rooms.create_room(initial_code, Arc::clone(plugin));
            (
                axum::http::StatusCode::CREATED,
                Json(CreateRoomResponse { room_code: code }),
            ).into_response()
        }
        None => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("unknown game: {}", game) })),
        ).into_response(),
    }
}
