use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::HeaderMap,
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
mod commentator;
mod room;
mod room_manager;
mod input_delay;
mod broadcast;
mod game_loop;

pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>>,
}

fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(lobby_html))
        .route("/rooms", post(create_room))
        .route("/rooms/{code}", get(get_room_page))
        .route("/ws/player/{room_code}", get(ws_player))
        .route("/ws/spectator/{room_code}", get(ws_spectator))
        .nest_service("/mobile", ServeDir::new("mobile/dist"))
        .nest_service("/overlay", ServeDir::new("overlay/dist"))
        .with_state(state)
}

/// D-18: Prefer PUBLIC_URL env var (set in Railway); fall back to Host header for local dev.
fn public_base_url(headers: &HeaderMap) -> String {
    if let Ok(url) = std::env::var("PUBLIC_URL") {
        return url.trim_end_matches('/').to_string();
    }
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8000");
    if host.starts_with("localhost") || host.starts_with("127.0.0.1") {
        format!("http://{}", host)
    } else {
        format!("https://{}", host)
    }
}

/// Convert https:// → wss:// and http:// → ws://.
fn ws_url_from_http(http_url: &str) -> String {
    if http_url.starts_with("https://") {
        http_url.replacen("https://", "wss://", 1)
    } else {
        http_url.replacen("http://", "ws://", 1)
    }
}

/// Generate an inline SVG QR code for the given URL using the qrcode crate.
/// Dark module color #0c0809 (--bg-deep), light module color #f5efe4 (--text-primary).
fn generate_qr_svg(url: &str) -> String {
    use qrcode::QrCode;
    use qrcode::render::svg;
    let code = QrCode::new(url.as_bytes()).unwrap_or_else(|_| QrCode::new(b"error").unwrap());
    code.render::<svg::Color>()
        .dark_color(svg::Color("#0c0809"))
        .light_color(svg::Color("#f5efe4"))
        .min_dimensions(160, 160)
        .max_dimensions(160, 160)
        .build()
}

/// Build the room page HTML with three QR cards (P1, P2, Overlay).
fn room_page_html(code: &str, game_type: &str, base_url: &str) -> String {
    let ws_url = ws_url_from_http(base_url);
    let p1_url = format!("{}/mobile?server={}&room={}&slot=1", base_url, ws_url, code);
    let p2_url = format!("{}/mobile?server={}&room={}&slot=2", base_url, ws_url, code);
    let overlay_url = format!("{}/overlay?server={}&room={}", base_url, ws_url, code);
    let p1_svg = generate_qr_svg(&p1_url);
    let p2_svg = generate_qr_svg(&p2_url);
    let overlay_svg = generate_qr_svg(&overlay_url);
    let game_type_upper = game_type.to_ascii_uppercase();
    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Room {code} — SPECTRE</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;900&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg-deep: oklch(7% 0.008 22);
      --bg-mid: oklch(11% 0.009 22);
      --bg-surface: oklch(17% 0.01 22);
      --accent: oklch(44% 0.22 22);
      --accent-bright: oklch(60% 0.25 22);
      --accent-p2: oklch(50% 0.18 250);
      --gold: oklch(78% 0.11 85);
      --text-primary: oklch(95% 0.008 85);
      --text-secondary: oklch(65% 0.008 85);
      --text-dim: oklch(38% 0.006 85);
    }}
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
      background: var(--bg-deep);
      color: var(--text-primary);
      max-width: 720px;
      margin: 48px auto;
      padding: 0 24px;
    }}
    .back-link {{ display: block; color: var(--text-secondary); text-decoration: none; font-size: 16px; font-weight: 400; margin-bottom: 24px; }}
    .back-link:hover {{ color: var(--text-primary); }}
    .room-code {{ font-size: 32px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-primary); line-height: 1.1; }}
    .game-badge {{ display: inline-block; font-size: 12px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary); border: 1px solid var(--text-dim); padding: 4px 8px; border-radius: 4px; margin-top: 8px; }}
    .subtitle {{ color: var(--text-secondary); font-size: 16px; font-weight: 400; margin-top: 8px; margin-bottom: 32px; }}
    .qr-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }}
    @media (max-width: 599px) {{ .qr-grid {{ grid-template-columns: 1fr; gap: 16px; }} }}
    .qr-card {{
      background: var(--bg-surface);
      border-radius: 4px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    }}
    .qr-card.p1 {{ border: 1px solid var(--accent); }}
    .qr-card.p2 {{ border: 1px solid var(--accent-p2); }}
    .qr-card.overlay {{ border: 1px solid color-mix(in oklch, var(--gold) 60%, transparent); }}
    .role-label {{ font-size: 12px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary); align-self: flex-start; }}
    .qr-code {{ width: 160px; height: 160px; flex-shrink: 0; }}
    .url-link {{ font-size: 12px; font-weight: 900; color: var(--text-secondary); letter-spacing: 0.04em; word-break: break-all; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-overflow: ellipsis; width: 100%; }}
    .url-link:hover {{ text-decoration: underline; color: var(--text-primary); }}
    .copy-btn {{
      width: 100%; min-height: 36px; background: var(--bg-mid); border: 1px solid var(--text-dim);
      border-radius: 4px; color: var(--text-secondary); font-family: inherit; font-size: 12px;
      font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }}
    .copy-btn:hover {{ border-color: color-mix(in oklch, var(--accent) 60%, transparent); background: color-mix(in oklch, var(--accent) 8%, transparent); }}
    .copy-btn.copied {{ border-color: color-mix(in oklch, var(--gold) 60%, transparent); color: var(--text-primary); }}
  </style>
</head>
<body>
  <a href="/" class="back-link">← Lobby</a>
  <div class="room-code">{code}</div>
  <div class="game-badge">{game_type_upper}</div>
  <p class="subtitle">Share these links with your players</p>
  <div class="qr-grid">
    <div class="qr-card p1">
      <div class="role-label">PLAYER 1</div>
      <div class="qr-code">{p1_svg}</div>
      <a href="{p1_url}" target="_blank" class="url-link">{p1_url}</a>
      <button class="copy-btn" onclick="copyLink(this, '{p1_url}')">Copy Link</button>
    </div>
    <div class="qr-card p2">
      <div class="role-label">PLAYER 2</div>
      <div class="qr-code">{p2_svg}</div>
      <a href="{p2_url}" target="_blank" class="url-link">{p2_url}</a>
      <button class="copy-btn" onclick="copyLink(this, '{p2_url}')">Copy Link</button>
    </div>
    <div class="qr-card overlay">
      <div class="role-label">OVERLAY</div>
      <div class="qr-code">{overlay_svg}</div>
      <a href="{overlay_url}" target="_blank" class="url-link">{overlay_url}</a>
      <button class="copy-btn" onclick="copyLink(this, '{overlay_url}')">Copy Link</button>
    </div>
  </div>
  <script>
    function copyLink(btn, url) {{
      navigator.clipboard.writeText(url).then(function() {{
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {{
          btn.textContent = 'Copy Link';
          btn.classList.remove('copied');
        }}, 2000);
      }});
    }}
  </script>
</body>
</html>"#,
        code = code,
        game_type_upper = game_type_upper,
        p1_svg = p1_svg,
        p2_svg = p2_svg,
        overlay_svg = overlay_svg,
        p1_url = p1_url,
        p2_url = p2_url,
        overlay_url = overlay_url,
    )
}

/// 404 page when room code is not found.
fn room_not_found_html() -> String {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Room not found — SPECTRE</title>
  <style>
    :root {
      --bg-deep: oklch(7% 0.008 22);
      --text-primary: oklch(95% 0.008 85);
      --text-secondary: oklch(65% 0.008 85);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
      background: var(--bg-deep);
      color: var(--text-primary);
      max-width: 720px;
      margin: 48px auto;
      padding: 0 24px;
    }
    .error-block { text-align: center; margin-top: 80px; }
    .error-heading { font-size: 28px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-primary); margin-bottom: 16px; }
    .error-body { font-size: 16px; font-weight: 400; color: var(--text-secondary); margin-bottom: 24px; }
    .back-link { color: var(--text-secondary); font-size: 16px; text-decoration: none; }
    .back-link:hover { color: var(--text-primary); }
  </style>
</head>
<body>
  <div class="error-block">
    <div class="error-heading">Room not found</div>
    <p class="error-body">This room has expired or does not exist. Return to the lobby to create a new one.</p>
    <a href="/" class="back-link">Back to Lobby</a>
  </div>
</body>
</html>"#.to_string()
}

/// Handler for GET /rooms/{code}: returns the room page with QR cards or a 404 page.
async fn get_room_page(
    Path(code): Path<String>,
    State(app): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let code_upper = code.to_ascii_uppercase();
    match app.rooms.get_room_game_type(&code_upper) {
        Some(game_type) => {
            let base_url = public_base_url(&headers);
            let html = room_page_html(&code_upper, &game_type, &base_url);
            (axum::http::StatusCode::OK, axum::response::Html(html))
        }
        None => {
            let html = room_not_found_html();
            (axum::http::StatusCode::NOT_FOUND, axum::response::Html(html))
        }
    }
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
    let app = build_app(state);
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
            let code = app.rooms.create_room(initial_code, Arc::clone(plugin), game.to_string());
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

#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> Arc<AppState> {
        let mut plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>> = HashMap::new();
        plugins.insert("boxing".to_string(), Arc::new(BoxingPlugin::new(BoxingConfig {
            hp: 100, round_secs: 10.0, max_wins: 1, bot_difficulty: Difficulty::Normal,
        })));
        plugins.insert("dance".to_string(), Arc::new(DancePlugin::new(DanceConfig { max_wins: 1 })));
        Arc::new(AppState {
            rooms: Arc::new(room_manager::RoomManager::new()),
            plugins,
        })
    }

    #[tokio::test]
    async fn post_rooms_boxing_returns_201() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("POST").uri("/rooms?game=boxing").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn post_rooms_dance_returns_201() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("POST").uri("/rooms?game=dance").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn post_rooms_unknown_game_returns_400() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("POST").uri("/rooms?game=unknown").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["error"], "unknown game: unknown");
    }

    #[tokio::test]
    async fn post_rooms_default_game_is_boxing() {
        // No ?game= param — should default to boxing (not 400)
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("POST").uri("/rooms").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn post_rooms_returns_6char_alphanumeric_code() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("POST").uri("/rooms?game=boxing").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let code = v["room_code"].as_str().unwrap();
        assert_eq!(code.len(), 6, "room code must be 6 chars, got: {}", code);
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric()), "room code must be alphanumeric, got: {}", code);
    }

    #[tokio::test]
    async fn post_rooms_never_returns_empty_code() {
        // Regression test for the String::new() bug — first call must not return ""
        let state = test_state();
        for _ in 0..5 {
            let app = build_app(Arc::clone(&state));
            let resp = app
                .oneshot(Request::builder().method("POST").uri("/rooms?game=boxing").body(Body::empty()).unwrap())
                .await.unwrap();
            let body = resp.into_body().collect().await.unwrap().to_bytes();
            let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let code = v["room_code"].as_str().unwrap();
            assert!(!code.is_empty(), "room code must never be empty string");
        }
    }

    #[tokio::test]
    async fn get_lobby_returns_200_html() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("GET").uri("/").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let ct = resp.headers().get("content-type").unwrap().to_str().unwrap();
        assert!(ct.contains("text/html"), "expected text/html, got: {}", ct);
    }

    #[tokio::test]
    async fn get_lobby_contains_boxing_and_dance_buttons() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("GET").uri("/").body(Body::empty()).unwrap())
            .await.unwrap();
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let html = std::str::from_utf8(&body).unwrap();
        assert!(html.contains("createRoom('boxing')"), "lobby missing boxing button");
        assert!(html.contains("createRoom('dance')"), "lobby missing dance button");
    }

    #[tokio::test]
    async fn get_rooms_code_returns_404_for_unknown_code() {
        let app = build_app(test_state());
        let resp = app
            .oneshot(Request::builder().method("GET").uri("/rooms/XXXXXX").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn get_rooms_code_returns_200_for_existing_room() {
        let state = test_state();
        // First create a room
        let app1 = build_app(Arc::clone(&state));
        let create_resp = app1
            .oneshot(Request::builder().method("POST").uri("/rooms?game=boxing").body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(create_resp.status(), StatusCode::CREATED);
        let body = create_resp.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let code = v["room_code"].as_str().unwrap().to_string();
        // Then fetch the room page
        let app2 = build_app(Arc::clone(&state));
        let resp = app2
            .oneshot(Request::builder().method("GET").uri(format!("/rooms/{}", code)).body(Body::empty()).unwrap())
            .await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let ct = resp.headers().get("content-type").unwrap().to_str().unwrap();
        assert!(ct.contains("text/html"));
    }
}
