use axum::{
    extract::{Path, State, WebSocketUpgrade},
    http::HeaderMap,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::cors::{Any, CorsLayer};
use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use plugin_trait::GamePlugin;

pub mod protocol;
mod commentator;
mod room;
mod room_manager;
mod input_delay;
mod broadcast;
mod game_loop;

pub struct EngineConfig {
    pub port: u16,
    pub client_dist: String,
    pub game_name: String,
}

pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugin: Arc<dyn GamePlugin + Send + Sync>,
    pub game_name: String,
    pub client_dist: String,
}

pub async fn run(plugin: Arc<dyn GamePlugin + Send + Sync>, config: EngineConfig) {
    tracing_subscriber::fmt::init();
    let state = Arc::new(AppState {
        rooms: Arc::new(room_manager::RoomManager::new()),
        plugin,
        game_name: config.game_name.clone(),
        client_dist: config.client_dist.clone(),
    });
    tokio::spawn(room_manager::expiry_task(state.rooms.rooms.clone()));
    let app = build_app(state);
    let port = std::env::var("PORT").unwrap_or_else(|_| config.port.to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("{} server listening on {}", config.game_name, addr);
    axum::serve(listener, app).await.unwrap();
}

fn build_app(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers(Any);

    let index = format!("{}/index.html", state.client_dist);
    let spa = ServeDir::new(&state.client_dist)
        .fallback(ServeFile::new(index));

    Router::new()
        .route("/rooms", post(create_room))
        .route("/rooms/{code}", get(get_room_page))
        .route("/rooms/{code}/rematch", post(rematch_room))
        .route("/ws/player/{room_code}", get(ws_player))
        .route("/ws/spectator/{room_code}", get(ws_spectator))
        .fallback_service(spa)
        .layer(cors)
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
/// BLK-02: if PUBLIC_URL is set without a scheme, prepend `https://` and log
/// an error rather than silently producing a malformed URL.
/// BLK-01: validate the Host header against `host_is_safe` before
/// concatenating it into URL strings; on failure, fall back to localhost.
fn public_base_url(headers: &HeaderMap) -> String {
    if let Ok(url) = std::env::var("PUBLIC_URL") {
        let url = url.trim_end_matches('/').to_string();
        if url.starts_with("http://") || url.starts_with("https://") {
            return url;
        }
        tracing::error!(
            "PUBLIC_URL must include scheme (http:// or https://); got '{}'. Defaulting to https://.",
            url
        );
        return format!("https://{}", url);
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
///
/// BLK-02 defense-in-depth: if the input has neither scheme (which should be
/// impossible after `public_base_url` normalization, but guard anyway), we
/// prepend `wss://` so the output always begins with `ws://` or `wss://` and
/// QR codes are never silently malformed.
fn ws_url_from_http(http_url: &str) -> String {
    if http_url.starts_with("https://") {
        http_url.replacen("https://", "wss://", 1)
    } else if http_url.starts_with("http://") {
        http_url.replacen("http://", "ws://", 1)
    } else {
        tracing::error!(
            "ws_url_from_http received URL without http(s):// scheme: '{}'. Forcing wss://.",
            http_url
        );
        format!("wss://{}", http_url)
    }
}

/// Inline SVG fallback shown when the URL cannot be encoded into a QR code.
/// Dimensions match the real QR card (160x160) so layout is unaffected.
/// Static — no user input, no escaping needed. (WR-01)
const QR_ERROR_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="#f5efe4"/><text x="80" y="86" font-family="monospace" font-size="16" font-weight="900" text-anchor="middle" fill="#0c0809">QR error</text></svg>"##;

/// Strip a leading `<?xml ... ?>` processing instruction from an SVG string so
/// it can be embedded inline in HTML5 body content. Idempotent — returns the
/// input unchanged if no prolog is present. (WR-02)
fn strip_xml_prolog(svg: &str) -> String {
    let trimmed = svg.trim_start();
    if trimmed.starts_with("<?xml") {
        if let Some((_, rest)) = trimmed.split_once("?>") {
            return rest.trim_start().to_string();
        }
    }
    svg.to_string()
}

/// Generate an inline SVG QR code for the given URL using the qrcode crate.
/// Dark module color #0c0809 (--bg-deep), light module color #f5efe4 (--text-primary).
///
/// WR-01: on encoding failure (e.g. URL too long), return a static
/// "QR error" SVG instead of either panicking via the prior unwrap-chain
/// or rendering a misleading fallback QR that decodes to the literal
/// string "error". A failure is now distinguishable at-a-glance from a
/// valid scannable code, and the error is surfaced through tracing.
/// WR-02: strip the `<?xml ... ?>` prolog from `qrcode`'s output so the
/// returned fragment is a valid HTML5 inline-SVG element.
fn generate_qr_svg(url: &str) -> String {
    use qrcode::QrCode;
    use qrcode::render::svg;
    let code = match QrCode::new(url.as_bytes()) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                "QR encoding failed for url (len={}): {}; rendering error placeholder",
                url.len(),
                e
            );
            return QR_ERROR_SVG.to_string();
        }
    };
    let raw = code
        .render::<svg::Color>()
        .dark_color(svg::Color("#0c0809"))
        .light_color(svg::Color("#f5efe4"))
        .min_dimensions(160, 160)
        .max_dimensions(160, 160)
        .build();
    strip_xml_prolog(&raw)
}

/// HTML template for the room page — rendered with simple `{{KEY}}`
/// substitution at request time. Compiled into the binary so deployment
/// stays self-contained.
const ROOM_HTML_TEMPLATE: &str = include_str!("../web/room.html");

/// Build the room page HTML with QR cards (P1, P2, and optionally Overlay).
///
/// BLK-01 / WR-04 / WR-05: every value derived from request input
/// (`code`, `game_name`, `base_url` via `p1_url`/`p2_url`/`overlay_url`) is
/// HTML-escaped before being interpolated into HTML attributes or text
/// content. URLs for the Copy Link buttons are placed into `data-copy-url`
/// attributes (HTML-escaped only) and read by a single delegated event
/// listener, eliminating the JS-string-inside-HTML-attribute escaping
/// requirement entirely.
fn room_page_html(code: &str, game_name: &str, base_url: &str) -> String {
    let ws_url = ws_url_from_http(base_url);
    let is_fps = game_name == "fps_boxing";

    let p1_url = format!("{}/?server={}&room={}&slot=1", base_url, ws_url, code);
    let p2_url = format!("{}/?server={}&room={}&slot=2", base_url, ws_url, code);
    let overlay_url = if !is_fps {
        format!("{}/?server={}&room={}", base_url, ws_url, code)
    } else {
        String::new()
    };

    let p1_url_esc = html_escape(&p1_url);
    let p2_url_esc = html_escape(&p2_url);
    let overlay_url_esc = html_escape(&overlay_url);
    let p1_svg = generate_qr_svg(&p1_url);
    let p2_svg = generate_qr_svg(&p2_url);
    let overlay_svg = if !is_fps { generate_qr_svg(&overlay_url) } else { String::new() };

    let p1_qr_div = format!("      <div class=\"qr-code\">{}</div>\n", p1_svg);
    let p2_qr_div = format!("      <div class=\"qr-code\">{}</div>\n", p2_svg);
    let overlay_card = if !is_fps {
        format!(
            "    <div class=\"qr-card overlay\">\n      <div class=\"role-label\">OVERLAY</div>\n      <div class=\"qr-code\">{overlay_svg}</div>\n      <a href=\"{overlay_url_esc}\" target=\"_blank\" class=\"url-link\">{overlay_url_esc}</a>\n      <button class=\"copy-btn\" data-copy-url=\"{overlay_url_esc}\">Copy Link</button>\n    </div>\n"
        )
    } else {
        String::new()
    };

    // WR-04: escape code and game_name even though create_room currently
    // bounds them to alphanumeric — defends against a future code-injection
    // path (e.g. vanity codes) becoming a stored XSS sink.
    let code_esc = html_escape(code);
    let game_type_upper = game_name.to_ascii_uppercase();
    let game_type_upper_esc = html_escape(&game_type_upper);

    ROOM_HTML_TEMPLATE
        .replace("{{CODE}}", &code_esc)
        .replace("{{GAME_TYPE_UPPER}}", &game_type_upper_esc)
        .replace("{{P1_QR_DIV}}", &p1_qr_div)
        .replace("{{P2_QR_DIV}}", &p2_qr_div)
        .replace("{{OVERLAY_CARD}}", &overlay_card)
        .replace("{{P1_URL}}", &p1_url_esc)
        .replace("{{P2_URL}}", &p2_url_esc)
}

/// 404 page when a room code is not found. Static HTML, no substitution.
fn room_not_found_html() -> String {
    include_str!("../web/room_not_found.html").to_string()
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

#[derive(Serialize)]
struct CreateRoomResponse {
    room_code: String,
}

async fn create_room(State(app): State<Arc<AppState>>) -> impl IntoResponse {
    let initial_code: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(|c| char::from(c).to_ascii_uppercase())
        .collect();
    let code = app.rooms.create_room(
        initial_code,
        Arc::clone(&app.plugin),
        app.game_name.clone(),
    );
    (
        axum::http::StatusCode::CREATED,
        Json(CreateRoomResponse { room_code: code }),
    ).into_response()
}

/// B1: POST /rooms/{code}/rematch — triggers a match reset and broadcasts
/// MsgRematchStart to all clients in the room. Both mobile and fps
/// useGameSocket.playAgain() callers POST this endpoint; before this route
/// existed the fetch silently 404'd and neither player could rematch.
async fn rematch_room(
    Path(code): Path<String>,
    State(app): State<Arc<AppState>>,
) -> impl IntoResponse {
    use tokio::sync::oneshot;
    use crate::room::RoomCmd;
    // Room codes are stored uppercase (see room_manager.create_room) — match
    // get_room_page's behavior so clients can send either case.
    let code_upper = code.to_ascii_uppercase();
    let cmd_tx = match app.rooms.get_cmd_tx(&code_upper) {
        Some(tx) => tx,
        None => return axum::http::StatusCode::NOT_FOUND,
    };
    let (reply_tx, reply_rx) = oneshot::channel();
    if cmd_tx.send(RoomCmd::Rematch { reply: reply_tx }).await.is_err() {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    }
    match reply_rx.await {
        Ok(()) => axum::http::StatusCode::OK,
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
    }
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
    use axum::extract::ws::{Message, CloseFrame};
    use tokio::sync::oneshot;
    use crate::room::RoomCmd;
    use crate::protocol::InboundMobileMsg;

    let (mut ws_sink, mut ws_stream) = socket.split();

    // ENG-05: channel created here (needed by PlayerConnect), but the outbound task is
    // spawned after early-exit checks so ws_sink stays available for close-code delivery.
    let (player_tx, mut player_rx) = tokio::sync::mpsc::channel::<String>(32);

    // PROTO-01 / join-first: read the first message — must be MsgJoin.
    // Extract player_slot (1-indexed from client, convert to 0-indexed) AND solo flag.
    let (slot_idx, join_solo): (usize, bool) = match ws_stream.next().await {
        Some(Ok(Message::Text(raw))) => {
            match serde_json::from_str::<InboundMobileMsg>(&raw) {
                Ok(InboundMobileMsg::Join(msg)) => {
                    // WR-05: reject slot=0 explicitly; saturating_sub(1) would silently map 0→0 (same as slot 1)
                    if msg.player_slot == 0 || msg.player_slot > 2 {
                        tracing::warn!("handle_player: invalid player_slot {}, closing", msg.player_slot);
                        return;
                    }
                    // player_slot is 1 or 2; convert to 0-indexed
                    ((msg.player_slot as usize) - 1, msg.solo)
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
            let _ = ws_sink.send(Message::Close(Some(CloseFrame {
                code: 4004,
                reason: "Room not found".into(),
            }))).await;
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
        solo: join_solo,
    }).await.is_err() {
        return;
    }
    let connect_result = match reply_rx.await {
        Ok(Some(r)) => r,
        Ok(None) => {
            tracing::warn!("room {} slot {} already occupied", room_code, slot_idx + 1);
            let _ = ws_sink.send(Message::Close(Some(CloseFrame {
                code: 4000,
                reason: "Slot already taken".into(),
            }))).await;
            return;
        }
        Err(_) => return,
    };

    // Connection confirmed — start outbound task now (moves ws_sink).
    tokio::spawn(async move {
        while let Some(msg) = player_rx.recv().await {
            if ws_sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    tracing::info!("player {} connected to room {}", connect_result.slot + 1, room_code);

    // Send MsgJoined back to client
    use crate::protocol::MsgJoined;
    let game_type = app.rooms.get_room_game_type(&room_code)
        .unwrap_or_else(|| "unknown".to_string());
    if let Ok(json) = serde_json::to_string(&MsgJoined {
        msg_type: "joined".to_string(),
        room_code: room_code.clone(),
        player_slot: (connect_result.slot + 1) as u8,
        opponent_connected: connect_result.opponent_connected,
        game_type,
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

#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};

    /// Module-level lock for tests that mutate the process-global PUBLIC_URL
    /// env var. Previously each test declared its own `static ENV_LOCK` inside
    /// its function body; those are *distinct* mutex instances (each `static`
    /// inside a `fn` is scoped to that function), so they didn't actually
    /// serialize against each other. With cargo's default parallel test
    /// runner, two PUBLIC_URL tests could observe each other's mid-flight
    /// env mutations, intermittently flipping the assertion. One shared lock
    /// here is the actual fix.
    static PUBLIC_URL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_state() -> Arc<AppState> {
        Arc::new(AppState {
            rooms: Arc::new(room_manager::RoomManager::new()),
            plugin: Arc::new(BoxingPlugin::new(BoxingConfig {
                hp: 100,
                round_secs: 10.0,
                max_wins: 1,
                bot_difficulty: Difficulty::Normal,
            })),
            game_name: "boxing".to_string(),
            client_dist: "games/boxing/client/dist".to_string(),
        })
    }

    #[tokio::test]
    async fn post_rooms_returns_201() {
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
            .oneshot(Request::builder().method("POST").uri("/rooms").body(Body::empty()).unwrap())
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
                .oneshot(Request::builder().method("POST").uri("/rooms").body(Body::empty()).unwrap())
                .await.unwrap();
            let body = resp.into_body().collect().await.unwrap().to_bytes();
            let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let code = v["room_code"].as_str().unwrap();
            assert!(!code.is_empty(), "room code must never be empty string");
        }
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
            .oneshot(Request::builder().method("POST").uri("/rooms").body(Body::empty()).unwrap())
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

    #[test]
    fn room_page_html_boxing_uses_slot_urls() {
        let html = room_page_html("ABCD", "boxing", "https://example.com");
        assert!(html.contains("slot=1"), "boxing room page must contain slot=1 URL");
        assert!(html.contains("slot=2"), "boxing room page must contain slot=2 URL");
        assert!(html.contains("qr-card overlay"), "boxing room page must contain overlay QR card");
    }

    #[test]
    fn room_page_html_fps_boxing_uses_slot_urls() {
        let html = room_page_html("ABCD", "fps_boxing", "https://example.com");
        assert!(html.contains("slot=1"), "fps_boxing room page must contain slot=1 URL");
        assert!(html.contains("slot=2"), "fps_boxing room page must contain slot=2 URL");
        assert!(!html.contains("qr-card overlay"), "fps_boxing room page must NOT contain overlay QR card");
    }

    /// BLK-01 regression: an unsafe Host header (containing characters
    /// outside `[A-Za-z0-9._:-]`) must be rejected and fall back to
    /// `localhost:8000` rather than being interpolated into URLs.
    #[test]
    fn public_base_url_rejects_unsafe_host_header() {
        // Hold the shared lock until the env is restored — see PUBLIC_URL_ENV_LOCK doc.
        // `.unwrap_or_else` rather than `.unwrap()` so a sibling test panicking
        // mid-section (poisoning the mutex) doesn't cascade-fail this test.
        let _guard = PUBLIC_URL_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

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

    // -----------------------------------------------------------------------
    // html_escape tests
    // -----------------------------------------------------------------------
    #[test]
    fn html_escape_ampersand() {
        assert_eq!(html_escape("a&b"), "a&amp;b");
    }

    #[test]
    fn html_escape_less_than() {
        assert_eq!(html_escape("<tag>"), "&lt;tag&gt;");
    }

    #[test]
    fn html_escape_greater_than() {
        assert_eq!(html_escape("a>b"), "a&gt;b");
    }

    #[test]
    fn html_escape_double_quote() {
        assert_eq!(html_escape(r#"say "hello""#), "say &quot;hello&quot;");
    }

    #[test]
    fn html_escape_single_quote() {
        assert_eq!(html_escape("it's"), "it&#39;s");
    }

    #[test]
    fn html_escape_clean_string_unchanged() {
        assert_eq!(html_escape("hello world"), "hello world");
    }

    #[test]
    fn html_escape_empty_string() {
        assert_eq!(html_escape(""), "");
    }

    #[test]
    fn html_escape_all_five_chars_together() {
        let input = "&<>\"'";
        let output = html_escape(input);
        assert_eq!(output, "&amp;&lt;&gt;&quot;&#39;");
    }

    // -----------------------------------------------------------------------
    // host_is_safe tests
    // -----------------------------------------------------------------------
    #[test]
    fn host_is_safe_valid_hostname() {
        assert!(host_is_safe("example.com"));
    }

    #[test]
    fn host_is_safe_valid_with_port() {
        assert!(host_is_safe("localhost:8000"));
    }

    #[test]
    fn host_is_safe_valid_ip() {
        assert!(host_is_safe("127.0.0.1"));
    }

    #[test]
    fn host_is_safe_rejects_single_quote() {
        assert!(!host_is_safe("evil.com'"));
    }

    #[test]
    fn host_is_safe_rejects_less_than() {
        assert!(!host_is_safe("evil.com<script>"));
    }

    #[test]
    fn host_is_safe_rejects_space() {
        assert!(!host_is_safe("evil com"));
    }

    #[test]
    fn host_is_safe_rejects_empty_string() {
        assert!(!host_is_safe(""));
    }

    #[test]
    fn host_is_safe_rejects_path_traversal() {
        assert!(!host_is_safe("evil.com/../etc/passwd"));
    }

    // -----------------------------------------------------------------------
    // ws_url_from_http tests
    // -----------------------------------------------------------------------
    #[test]
    fn ws_url_https_becomes_wss() {
        assert_eq!(ws_url_from_http("https://example.com/path"), "wss://example.com/path");
    }

    #[test]
    fn ws_url_http_becomes_ws() {
        assert_eq!(ws_url_from_http("http://localhost:8000"), "ws://localhost:8000");
    }

    #[test]
    fn ws_url_https_not_double_converted() {
        // Must not produce ws://s://...
        let result = ws_url_from_http("https://example.com");
        assert!(!result.contains("https://"), "https:// must not remain after conversion");
        assert!(result.starts_with("wss://"), "must start with wss://, got: {}", result);
    }

    #[test]
    fn ws_url_schemeless_gets_wss_prefix() {
        let result = ws_url_from_http("example.com/path");
        assert!(result.starts_with("wss://"), "schemeless input must get wss:// prefix, got: {}", result);
    }

    // -----------------------------------------------------------------------
    // strip_xml_prolog tests
    // -----------------------------------------------------------------------
    #[test]
    fn strip_xml_prolog_removes_prolog() {
        let svg = r#"<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>"#;
        let result = strip_xml_prolog(svg);
        assert!(!result.contains("<?xml"), "prolog must be stripped");
        assert!(result.starts_with("<svg"), "result must start with <svg after stripping");
    }

    #[test]
    fn strip_xml_prolog_no_prolog_unchanged() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#;
        let result = strip_xml_prolog(svg);
        assert_eq!(result, svg, "SVG without prolog must be returned unchanged");
    }

    #[test]
    fn strip_xml_prolog_empty_string() {
        assert_eq!(strip_xml_prolog(""), "");
    }

    // -----------------------------------------------------------------------
    // room_not_found_html tests
    // -----------------------------------------------------------------------
    #[test]
    fn room_not_found_html_contains_not_found_text() {
        let html = room_not_found_html();
        assert!(!html.is_empty(), "room_not_found_html must return non-empty HTML");
        // Check it contains either "404" or "not found" (case-insensitive)
        let lower = html.to_lowercase();
        assert!(
            lower.contains("not found") || lower.contains("404"),
            "room_not_found_html must contain 'not found' or '404', got snippet: {}",
            &html[..100.min(html.len())]
        );
        assert!(html.contains("<!DOCTYPE html>") || html.contains("<html"), "must be HTML document");
    }

    /// WR-02 regression: the rendered room page must not contain an
    /// `<?xml ... ?>` prolog inside its HTML body (the qrcode crate emits
    /// one before `<svg ...>` by default, but it is stripped before
    /// embedding so the page is a valid HTML5 document).
    #[test]
    fn room_page_strips_xml_prolog_from_qr_svgs() {
        let html = room_page_html("ABCDEF", "boxing", "https://example.com");
        assert!(
            !html.contains("<?xml"),
            "rendered room page must not contain an <?xml ?> prolog"
        );
        // Sanity check: the QR cards themselves are present (otherwise the
        // negative assertion above is vacuous).
        assert!(
            html.contains("<svg"),
            "expected at least one inline <svg> element from QR rendering"
        );
    }

    /// BLK-02 regression: PUBLIC_URL set without a scheme is normalized to
    /// `https://...` rather than silently producing a malformed base URL
    /// that would cascade into broken `ws://...` URLs in QR codes.
    #[test]
    fn public_base_url_handles_missing_scheme() {
        // Hold the shared lock until the env is restored — see PUBLIC_URL_ENV_LOCK doc.
        let _guard = PUBLIC_URL_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

        let prev = std::env::var("PUBLIC_URL").ok();
        std::env::set_var("PUBLIC_URL", "spectre.example.com");
        let url = public_base_url(&HeaderMap::new());
        assert_eq!(
            url, "https://spectre.example.com",
            "missing-scheme PUBLIC_URL must be normalized to https://"
        );

        // Also verify the ws_url_from_http defensive guard handles a
        // schemeless URL by forcing wss://.
        let ws = ws_url_from_http("spectre.example.com");
        assert!(
            ws.starts_with("wss://") || ws.starts_with("ws://"),
            "ws_url_from_http output must start with ws:// or wss://, got: {}",
            ws
        );

        // Restore prior env state.
        match prev {
            Some(v) => std::env::set_var("PUBLIC_URL", v),
            None => std::env::remove_var("PUBLIC_URL"),
        }
    }
}
