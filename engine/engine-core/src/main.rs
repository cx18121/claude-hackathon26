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

/// HTML-escape a string for safe interpolation into HTML attributes, text
/// content, and (with the data-url indirection in `room_page_html`) JS string
/// literals read from `dataset`. Covers the five characters that can break
/// out of any of those contexts. (BLK-01 / WR-04 / WR-05)
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&#39;")
}

/// Validate that a Host header value contains only characters that are legal
/// in a hostname / authority. Anything outside `[A-Za-z0-9._:-]` is rejected
/// and the caller falls back to `localhost:8000`. (BLK-01 mitigation layer 2)
fn host_is_safe(host: &str) -> bool {
    !host.is_empty()
        && host.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || b == b'.'
                || b == b'_'
                || b == b'-'
                || b == b':'
        })
}

/// D-18: Prefer PUBLIC_URL env var (set in Railway); fall back to Host header for local dev.
///
/// BLK-01: validate the Host header against `host_is_safe` before
/// concatenating it into URL strings; on failure, fall back to localhost.
fn public_base_url(headers: &HeaderMap) -> String {
    if let Ok(url) = std::env::var("PUBLIC_URL") {
        return url.trim_end_matches('/').to_string();
    }
    let host_raw = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8000");
    let host = if host_is_safe(host_raw) {
        host_raw
    } else {
        tracing::warn!("rejected unsafe Host header (falling back to localhost:8000)");
        "localhost:8000"
    };
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
///
/// BLK-01 / WR-04 / WR-05: every value derived from request input
/// (`code`, `game_type`, `base_url` via `p1_url`/`p2_url`/`overlay_url`) is
/// HTML-escaped before being interpolated into HTML attributes or text
/// content. URLs for the Copy Link buttons are placed into `data-copy-url`
/// attributes (HTML-escaped only) and read by a single delegated event
/// listener, eliminating the JS-string-inside-HTML-attribute escaping
/// requirement entirely.
fn room_page_html(code: &str, game_type: &str, base_url: &str) -> String {
    let ws_url = ws_url_from_http(base_url);
    let p1_url = format!("{}/mobile?server={}&room={}&slot=1", base_url, ws_url, code);
    let p2_url = format!("{}/mobile?server={}&room={}&slot=2", base_url, ws_url, code);
    let overlay_url = format!("{}/overlay?server={}&room={}", base_url, ws_url, code);
    // Escape every URL we splice into the rendered HTML — both the href/text
    // sites and the data-copy-url attribute.
    let p1_url_esc = html_escape(&p1_url);
    let p2_url_esc = html_escape(&p2_url);
    let overlay_url_esc = html_escape(&overlay_url);
    // QR SVGs are generated from *raw* (unescaped) URLs because the QR encoder
    // operates on bytes, not HTML. The SVG output itself is structured XML
    // emitted by the qrcode crate — it is safe to splice into HTML body.
    let p1_svg = generate_qr_svg(&p1_url);
    let p2_svg = generate_qr_svg(&p2_url);
    let overlay_svg = generate_qr_svg(&overlay_url);
    // WR-04: escape code and game_type even though create_room currently
    // bounds them to alphanumeric — defends against a future code-injection
    // path (e.g. vanity codes) becoming a stored XSS sink.
    let code_esc = html_escape(code);
    let game_type_upper = game_type.to_ascii_uppercase();
    let game_type_upper_esc = html_escape(&game_type_upper);
    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Room {code_esc} — SPECTRE</title>
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
  <div class="room-code">{code_esc}</div>
  <div class="game-badge">{game_type_upper_esc}</div>
  <p class="subtitle">Share these links with your players</p>
  <div class="qr-grid">
    <div class="qr-card p1">
      <div class="role-label">PLAYER 1</div>
      <div class="qr-code">{p1_svg}</div>
      <a href="{p1_url_esc}" target="_blank" class="url-link">{p1_url_esc}</a>
      <button class="copy-btn" data-copy-url="{p1_url_esc}">Copy Link</button>
    </div>
    <div class="qr-card p2">
      <div class="role-label">PLAYER 2</div>
      <div class="qr-code">{p2_svg}</div>
      <a href="{p2_url_esc}" target="_blank" class="url-link">{p2_url_esc}</a>
      <button class="copy-btn" data-copy-url="{p2_url_esc}">Copy Link</button>
    </div>
    <div class="qr-card overlay">
      <div class="role-label">OVERLAY</div>
      <div class="qr-code">{overlay_svg}</div>
      <a href="{overlay_url_esc}" target="_blank" class="url-link">{overlay_url_esc}</a>
      <button class="copy-btn" data-copy-url="{overlay_url_esc}">Copy Link</button>
    </div>
  </div>
  <script>
    // WR-05: single delegated listener reads the URL from data-copy-url
    // instead of inlining it into an onclick attribute. This eliminates
    // the JS-string-inside-HTML-attribute escaping requirement; HTML
    // escaping of the data attribute alone is sufficient.
    document.querySelectorAll('.copy-btn').forEach(function(btn) {{
      btn.addEventListener('click', function() {{
        var url = btn.dataset.copyUrl || '';
        navigator.clipboard.writeText(url).then(function() {{
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function() {{
            btn.textContent = 'Copy Link';
            btn.classList.remove('copied');
          }}, 2000);
        }});
      }});
    }});
  </script>
</body>
</html>"#,
        code_esc = code_esc,
        game_type_upper_esc = game_type_upper_esc,
        p1_svg = p1_svg,
        p2_svg = p2_svg,
        overlay_svg = overlay_svg,
        p1_url_esc = p1_url_esc,
        p2_url_esc = p2_url_esc,
        overlay_url_esc = overlay_url_esc,
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
  <title>SPECTRE</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;900&display=swap" rel="stylesheet">
  <style>
    :root {
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
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
      background: var(--bg-deep);
      color: var(--text-primary);
      max-width: 480px;
      margin: 48px auto;
      padding: 0 16px;
    }
    .site-heading {
      font-size: 28px; font-weight: 900; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--text-primary); line-height: 1.1;
    }
    .tagline {
      font-size: 12px; font-weight: 400; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--text-secondary); margin-top: 4px;
      margin-bottom: 32px;
    }
    .section-label {
      font-size: 12px; font-weight: 900; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--text-secondary); margin-bottom: 12px;
    }
    .game-picker { display: flex; gap: 8px; margin-bottom: 16px; }
    .game-tile {
      flex: 1; min-height: 80px; display: flex; align-items: center; justify-content: center;
      background: var(--bg-surface); border: 1px solid var(--text-dim); border-radius: 4px;
      font-size: 16px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--text-primary); cursor: pointer; font-family: inherit;
      transition: border-color 0.12s, background 0.12s; user-select: none;
    }
    .game-tile:hover { border-color: var(--text-secondary); background: var(--bg-mid); }
    .game-tile:active { transform: scale(0.97); transition: transform 80ms ease-out; }
    .game-tile.selected-boxing {
      border-color: var(--accent);
      background: color-mix(in oklch, var(--accent) 10%, transparent);
    }
    .game-tile.selected-dance {
      border-color: var(--accent-p2);
      background: color-mix(in oklch, var(--accent-p2) 10%, transparent);
    }
    .btn-create {
      width: 100%; min-height: 52px; border-radius: 4px; border: 1px solid var(--text-dim);
      background: var(--bg-surface); color: var(--text-primary); font-family: inherit;
      font-size: 16px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase;
      cursor: pointer; opacity: 0.5; pointer-events: none;
      transition: background 0.15s, border-color 0.15s; margin-bottom: 32px;
    }
    .btn-create.enabled {
      border-color: var(--accent);
      background: color-mix(in oklch, var(--accent) 15%, transparent);
      opacity: 1; pointer-events: auto; cursor: pointer;
    }
    .btn-create.enabled:hover {
      background: color-mix(in oklch, var(--accent) 25%, transparent);
      border-color: var(--accent-bright);
    }
    .btn-create.enabled:active { transform: scale(0.97); transition: transform 80ms ease-out; }
    .separator {
      display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
    }
    .separator::before, .separator::after {
      content: ''; flex: 1; height: 1px;
      background: color-mix(in oklch, var(--text-dim) 40%, transparent);
    }
    .separator span {
      font-size: 12px; font-weight: 400; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;
    }
    .join-row { display: flex; gap: 8px; }
    .join-input {
      flex: 1; min-height: 52px; background: var(--bg-surface); border: 1px solid var(--text-dim);
      border-radius: 4px; padding: 0 16px; color: var(--text-primary); font-family: inherit;
      font-size: 16px; font-weight: 900; letter-spacing: 0.2em; text-transform: uppercase;
      outline: none; transition: border-color 0.12s;
    }
    .join-input::placeholder { color: var(--text-dim); font-weight: 400; letter-spacing: 0.04em; text-transform: none; }
    .join-input:focus { border-color: var(--accent); }
    .btn-join {
      min-width: 100px; min-height: 52px; background: var(--bg-surface); border: 1px solid var(--text-dim);
      border-radius: 4px; color: var(--text-primary); font-family: inherit; font-size: 16px;
      font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
      opacity: 0.5; pointer-events: none;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-join.enabled {
      opacity: 1; pointer-events: auto; cursor: pointer;
    }
    .btn-join.enabled:hover {
      border-color: color-mix(in oklch, var(--accent) 60%, transparent);
      background: color-mix(in oklch, var(--accent) 8%, transparent);
    }
    .btn-join.enabled:active { transform: scale(0.97); transition: transform 80ms ease-out; }
    .error-msg {
      display: none; margin-top: 8px; padding: 8px 12px; border-radius: 4px;
      background: color-mix(in oklch, var(--accent-bright) 15%, transparent);
      border: 1px solid color-mix(in oklch, var(--accent-bright) 40%, transparent);
      font-size: 16px; font-weight: 400; color: var(--text-primary);
    }
    .error-msg.visible { display: block; }
  </style>
</head>
<body>
  <h1 class="site-heading">SPECTRE</h1>
  <p class="tagline">real punches. real fights.</p>

  <p class="section-label">Select a Game</p>
  <div class="game-picker">
    <button class="game-tile" id="tile-boxing" onclick="selectGame('boxing')">BOXING</button>
    <button class="game-tile" id="tile-dance" onclick="selectGame('dance')">DANCE</button>
  </div>

  <button class="btn-create" id="btn-create" onclick="createRoom()">Create Room</button>
  <div class="error-msg" id="create-error"></div>

  <div class="separator"><span>or</span></div>

  <p class="section-label">Join a Room</p>
  <div class="join-row">
    <input
      type="text"
      id="join-input"
      class="join-input"
      placeholder="Room Code"
      maxlength="6"
      autocomplete="off"
      spellcheck="false"
      oninput="onJoinInput(this)"
    />
    <button class="btn-join" id="btn-join" onclick="joinRoom()">Join Room</button>
  </div>

  <script>
    var selectedGame = null;

    function selectGame(game) {
      if (selectedGame === game) return;
      selectedGame = game;
      document.getElementById('tile-boxing').className = 'game-tile' + (game === 'boxing' ? ' selected-boxing' : '');
      document.getElementById('tile-dance').className = 'game-tile' + (game === 'dance' ? ' selected-dance' : '');
      var btn = document.getElementById('btn-create');
      btn.classList.add('enabled');
    }

    async function createRoom() {
      if (!selectedGame) return;
      var btn = document.getElementById('btn-create');
      var errEl = document.getElementById('create-error');
      btn.textContent = 'Creating...';
      btn.classList.remove('enabled');
      errEl.className = 'error-msg';
      try {
        var res = await fetch('/rooms?game=' + selectedGame, { method: 'POST' });
        var data = await res.json();
        if (res.ok) {
          window.location.href = '/rooms/' + data.room_code;
        } else {
          errEl.textContent = data.error ? data.error : 'Server error — try again';
          errEl.className = 'error-msg visible';
          btn.textContent = 'Create Room';
          btn.classList.add('enabled');
        }
      } catch (_) {
        errEl.textContent = 'Could not reach server';
        errEl.className = 'error-msg visible';
        btn.textContent = 'Create Room';
        btn.classList.add('enabled');
      }
    }

    function onJoinInput(input) {
      input.value = input.value.toUpperCase();
      var joinBtn = document.getElementById('btn-join');
      if (input.value.length > 0) {
        joinBtn.classList.add('enabled');
      } else {
        joinBtn.classList.remove('enabled');
      }
    }

    function joinRoom() {
      var code = document.getElementById('join-input').value.trim();
      if (!code) return;
      var server = window.location.origin;
      window.location.href = '/mobile?room=' + encodeURIComponent(code) + '&server=' + encodeURIComponent(server);
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
        assert!(html.contains("selectGame('boxing')"), "lobby missing boxing tile");
        assert!(html.contains("selectGame('dance')"), "lobby missing dance tile");
        assert!(html.contains("SPECTRE"), "lobby missing SPECTRE heading");
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

    /// BLK-01 regression: a malicious Host header value containing `'` and
    /// `<` must not be able to break out of either the HTML attribute /
    /// text context or the JS-string context in any rendered URL site.
    /// Because URLs flow only through HTML-escaped variables AND copy URLs
    /// live in `data-copy-url` (read by a delegated listener), neither
    /// raw `'` nor `<` from the *input* should appear in the output (the
    /// page's own legitimate `<script>` tag is allowed).
    #[test]
    fn room_page_url_html_escaping() {
        // Simulate a hostile base_url derived from a poisoned Host header.
        // The single-quote and `<` characters are exactly the ones that
        // would have broken the old onclick="copyLink(this, '...')" sink
        // and the old href="..." attribute respectively. We use a
        // distinctive payload tag (`<scr1pt>...`) so we can grep for the
        // verbatim attacker string and not collide with the page's own
        // legitimate <script> element.
        let hostile_base = "https://evil.com'),alert(document.cookie),copyLink(this,'<scr1pt>XSS</scr1pt>";
        let html = room_page_html("ABCDEF", "boxing", hostile_base);

        // Verbatim attacker payload (the hostile tag and the JS-string-
        // breakout sequence) must NOT appear anywhere in the rendered
        // HTML — escaping must transform every `'` into `&#39;`, every
        // `<` into `&lt;`, every `>` into `&gt;` before interpolation.
        assert!(
            !html.contains(hostile_base),
            "raw hostile base URL appears unescaped in rendered HTML"
        );
        assert!(
            !html.contains("'),alert(document.cookie),copyLink(this,'"),
            "raw single-quoted JS payload appears in rendered HTML"
        );
        assert!(
            !html.contains("<scr1pt>"),
            "raw <scr1pt> payload from hostile input appears unescaped"
        );
        assert!(
            !html.contains("</scr1pt>"),
            "raw </scr1pt> payload from hostile input appears unescaped"
        );
        // Positive check: escaped form is what we expect to see.
        assert!(
            html.contains("&#39;"),
            "expected &#39; entity (escaped single-quote) in rendered HTML"
        );
        assert!(
            html.contains("&lt;scr1pt&gt;"),
            "expected &lt;scr1pt&gt; (escaped tag) in rendered HTML"
        );
        // Verify the old onclick-with-JS-string sink no longer exists at all.
        assert!(
            !html.contains("onclick=\"copyLink"),
            "onclick=\"copyLink(...)\" sink must be removed in favor of data-copy-url"
        );
        // Verify the data-copy-url indirection is present.
        assert!(
            html.contains("data-copy-url=\""),
            "expected data-copy-url attribute on copy buttons"
        );
    }

    /// BLK-01 / WR-04 regression: malicious `code` and `game_type` (e.g.
    /// injected via a future vanity-code path) must also be HTML-escaped
    /// before being interpolated into <title>, .room-code, .game-badge.
    #[test]
    fn room_page_code_and_game_type_html_escaping() {
        let html = room_page_html(
            "ABC<>'",
            "<img src=x onerror=alert(1)>",
            "https://example.com",
        );
        assert!(
            !html.contains("ABC<>'"),
            "raw code with HTML metachars appears unescaped"
        );
        assert!(
            !html.contains("<img src=x onerror=alert(1)>"),
            "raw game_type with HTML payload appears unescaped"
        );
        assert!(
            html.contains("ABC&lt;&gt;&#39;"),
            "expected escaped form of code in rendered HTML"
        );
    }

    /// BLK-01 regression: an unsafe Host header (containing characters
    /// outside `[A-Za-z0-9._:-]`) must be rejected and fall back to
    /// `localhost:8000` rather than being interpolated into URLs.
    #[test]
    fn public_base_url_rejects_unsafe_host_header() {
        use std::sync::Mutex;
        static ENV_LOCK: Mutex<()> = Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap();

        let prev = std::env::var("PUBLIC_URL").ok();
        std::env::remove_var("PUBLIC_URL");

        let mut headers = HeaderMap::new();
        // Inject a hostile Host containing characters outside the safe set
        // `[A-Za-z0-9._:-]`. `'` is a valid byte for HeaderValue but is
        // rejected by `host_is_safe` and triggers the localhost fallback.
        headers.insert(
            "host",
            "evil.com'/script".parse().unwrap(),
        );
        let url = public_base_url(&headers);
        assert_eq!(
            url, "http://localhost:8000",
            "unsafe Host header must trigger localhost fallback"
        );

        match prev {
            Some(v) => std::env::set_var("PUBLIC_URL", v),
            None => std::env::remove_var("PUBLIC_URL"),
        }
    }
}
