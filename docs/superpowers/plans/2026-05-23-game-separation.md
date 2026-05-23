# Game Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic spectre repo into three independently runnable games (boxing, dance, fps-boxing), each with its own Rust server binary and merged frontend client, all sharing a single `engine-core` library.

**Architecture:** `engine-core` becomes a library crate exposing `run(plugin, config)`. Each game lives in `games/<name>/` with a thin `server/` binary and a merged `client/` React app. The Cargo workspace at `engine/Cargo.toml` gains the game crates as members via relative paths.

**Tech Stack:** Rust/Axum (engine), React/Vite/TypeScript (frontends), MediaPipe (pose), PixiJS (boxing/dance renderer), Three.js (fps renderer)

---

## File Map

**Created:**
- `engine/engine-core/src/lib.rs` — all server infrastructure + `pub async fn run()`
- `games/boxing/server/Cargo.toml` + `src/main.rs`
- `games/boxing/plugin/` (moved from `engine/boxing-plugin/`)
- `games/boxing/client/` (merged from `mobile/` + `overlay/` boxing components)
- `games/dance/server/Cargo.toml` + `src/main.rs`
- `games/dance/plugin/` (moved from `engine/dance-plugin/`)
- `games/dance/client/` (merged from `mobile/` + `overlay/` dance components)
- `games/fps-boxing/server/Cargo.toml` + `src/main.rs`
- `games/fps-boxing/plugin/` (moved from `engine/fps-boxing-plugin/`)
- `games/fps-boxing/client/` (moved from `fps/`)
- `scripts/boxing.sh`, `scripts/dance.sh`, `scripts/fps-boxing.sh`

**Modified:**
- `engine/Cargo.toml` — workspace members updated
- `engine/engine-core/Cargo.toml` — remove game plugin prod deps, keep as dev-deps
- `engine/engine-core/src/main.rs` — gutted to empty stub

**Deleted (Task 15 only, after everything works):**
- `mobile/`, `overlay/`, `engine/boxing-plugin/`, `engine/dance-plugin/`, `engine/fps-boxing-plugin/`

---

## Task 1: Create engine-core/src/lib.rs

**Files:**
- Create: `engine/engine-core/src/lib.rs`

This is the biggest task. The lib extracts everything from `main.rs` except plugin imports and `main()`. Key structural changes:
- `AppState` drops the plugin HashMap → single plugin
- `build_app` serves `client_dist` via SPA fallback instead of `/mobile`, `/overlay`, `/fps`
- `create_room` no longer takes a `?game=` param
- `room_page_html` builds uniform `/?server=&room=&slot=` URLs for all games
- `pub async fn run()` is the only new public symbol

- [ ] **Step 1: Create the file with public types and run()**

Create `engine/engine-core/src/lib.rs`:

```rust
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
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
use serde::{Deserialize, Serialize};
use plugin_trait::GamePlugin;

mod protocol;
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
```

- [ ] **Step 2: Add build_app with SPA fallback**

Append to `engine/engine-core/src/lib.rs`:

```rust
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
```

- [ ] **Step 3: Add create_room (no ?game= param)**

Append to `engine/engine-core/src/lib.rs`:

```rust
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
```

- [ ] **Step 4: Add room page helpers and handlers**

Copy verbatim from `engine/engine-core/src/main.rs`: the functions `html_escape`, `host_is_safe`, `public_base_url`, `ws_url_from_http`, `QR_ERROR_SVG`, `strip_xml_prolog`, `generate_qr_svg`, `ROOM_HTML_TEMPLATE`, `room_not_found_html`, `get_room_page`, `rematch_room`.

Then add the updated `room_page_html` that uses unified `/?server=&room=&slot=` URLs:

```rust
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
```

- [ ] **Step 5: Copy WS handlers and tests verbatim from main.rs**

Copy `ws_player`, `handle_player`, `ws_spectator`, `handle_spectator` verbatim from `main.rs` — no changes needed.

Then copy the `#[cfg(test)] mod http_tests` block. Update `test_state()`:

```rust
#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::http::{Request, StatusCode};
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    static PUBLIC_URL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_state() -> Arc<AppState> {
        use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};
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
```

Remove test cases that test the old multi-game lobby HTML (`get_lobby_returns_200_html`, `get_lobby_contains_boxing_and_dance_buttons`, `get_lobby_contains_fps_boxing_button`, `lobby_join_redirect_uses_ws_scheme`). Keep all other tests. Update `post_rooms_unknown_game_returns_400` → remove it (no `?game=` param exists anymore). Update `post_rooms_boxing_returns_201` → rename to `post_rooms_returns_201`, remove `?game=boxing` from URI. Keep all html_escape, host_is_safe, ws_url, strip_xml_prolog, room_not_found tests unchanged.

Update `room_page_html_boxing_unchanged`:
```rust
#[test]
fn room_page_html_boxing_uses_slot_urls() {
    let html = room_page_html("ABCD", "boxing", "https://example.com");
    assert!(html.contains("slot=1"), "boxing room page must contain slot=1 URL");
    assert!(html.contains("slot=2"), "boxing room page must contain slot=2 URL");
    assert!(html.contains("qr-card overlay"), "boxing room page must contain overlay QR card");
}
```

Update `room_page_html_fps_boxing_uses_fps_urls`:
```rust
#[test]
fn room_page_html_fps_boxing_uses_slot_urls() {
    let html = room_page_html("ABCD", "fps_boxing", "https://example.com");
    assert!(html.contains("slot=1"), "fps_boxing room page must contain slot=1 URL");
    assert!(html.contains("slot=2"), "fps_boxing room page must contain slot=2 URL");
    assert!(!html.contains("qr-card overlay"), "fps_boxing room page must NOT contain overlay QR card");
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add engine/engine-core/src/lib.rs
git commit -m "feat: extract engine-core server infrastructure into lib.rs"
```

---

## Task 2: Gut engine-core/src/main.rs and update Cargo.toml

**Files:**
- Modify: `engine/engine-core/src/main.rs`
- Modify: `engine/engine-core/Cargo.toml`

- [ ] **Step 1: Replace main.rs with empty stub**

Overwrite `engine/engine-core/src/main.rs` with:

```rust
fn main() {}
```

- [ ] **Step 2: Update engine-core/Cargo.toml**

Remove `boxing-plugin`, `dance-plugin`, `fps-boxing-plugin` from `[dependencies]`. Add them to `[dev-dependencies]` (needed by lib.rs test suite). The paths will be updated after the plugin move in Task 3, but for now they point to the old location.

Change `[dependencies]` section — remove these lines:
```toml
boxing-plugin = { path = "../boxing-plugin" }
dance-plugin = { path = "../dance-plugin" }
fps-boxing-plugin = { path = "../fps-boxing-plugin" }
```

Add `[dev-dependencies]` block (or update existing):
```toml
[dev-dependencies]
boxing-plugin = { path = "../boxing-plugin" }
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
```

Also add `ServeFile` support — `tower-http` already has the `fs` feature so no change needed there.

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo build -p engine-core 2>&1 | tail -5
```

Expected: compiles successfully (tests won't run yet since boxing-plugin path still points to old location).

- [ ] **Step 4: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add engine/engine-core/src/main.rs engine/engine-core/Cargo.toml
git commit -m "refactor: gut engine-core binary, remove plugin prod deps"
```

---

## Task 3: Move plugin crates to games/

**Files:**
- Move: `engine/boxing-plugin/` → `games/boxing/plugin/`
- Move: `engine/dance-plugin/` → `games/dance/plugin/`
- Move: `engine/fps-boxing-plugin/` → `games/fps-boxing/plugin/`
- Modify: `engine/Cargo.toml`
- Modify: path references in each plugin's `Cargo.toml`

- [ ] **Step 1: Create directory structure and move plugin crates**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/boxing/plugin
mkdir -p /Users/sickle/Coding/spectre/games/dance/plugin
mkdir -p /Users/sickle/Coding/spectre/games/fps-boxing/plugin

cp -r /Users/sickle/Coding/spectre/engine/boxing-plugin/* /Users/sickle/Coding/spectre/games/boxing/plugin/
cp -r /Users/sickle/Coding/spectre/engine/dance-plugin/* /Users/sickle/Coding/spectre/games/dance/plugin/
cp -r /Users/sickle/Coding/spectre/engine/fps-boxing-plugin/* /Users/sickle/Coding/spectre/games/fps-boxing/plugin/
```

- [ ] **Step 2: Update games/boxing/plugin/Cargo.toml**

Change the path deps (previously relative to `engine/boxing-plugin/`, now relative to `games/boxing/plugin/`):

```toml
[package]
name = "boxing-plugin"
version = "0.1.0"
edition = "2021"

[lib]
name = "boxing_plugin"
path = "src/lib.rs"

[dependencies]
plugin-trait = { path = "../../../engine/plugin-trait" }
boxing-core = { path = "../../../engine/boxing-core" }
serde_json = "1.0.149"
rand = "0.8.6"
tracing = "0.1.44"
```

- [ ] **Step 3: Update games/dance/plugin/Cargo.toml**

```toml
[package]
name = "dance-plugin"
version = "0.1.0"
edition = "2021"

[lib]
name = "dance_plugin"
path = "src/lib.rs"

[dependencies]
plugin-trait = { path = "../../../engine/plugin-trait" }
serde_json = "1.0.149"
tracing = "0.1.44"
```

- [ ] **Step 4: Update games/fps-boxing/plugin/Cargo.toml**

```toml
[package]
name = "fps-boxing-plugin"
version = "0.1.0"
edition = "2021"

[lib]
name = "fps_boxing_plugin"
path = "src/lib.rs"

[dependencies]
plugin-trait = { path = "../../../engine/plugin-trait" }
boxing-core = { path = "../../../engine/boxing-core" }
serde_json = "1.0.149"
tracing = "0.1.44"

[dev-dependencies]
engine-core = { path = "../../../engine/engine-core" }
```

- [ ] **Step 5: Update engine/Cargo.toml workspace members**

Replace content of `engine/Cargo.toml`:

```toml
[workspace]
members = [
    "engine-core",
    "plugin-trait",
    "boxing-core",
    "../games/boxing/plugin",
    "../games/dance/plugin",
    "../games/fps-boxing/plugin",
]
resolver = "2"
```

- [ ] **Step 6: Update engine-core dev-dependency path for boxing-plugin**

In `engine/engine-core/Cargo.toml`, update the dev-dependency path for boxing-plugin:

```toml
[dev-dependencies]
boxing-plugin = { path = "../../games/boxing/plugin" }
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
```

- [ ] **Step 7: Verify workspace builds**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo build 2>&1 | tail -10
```

Expected: all workspace members compile successfully.

- [ ] **Step 8: Run lib tests**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo test -p engine-core 2>&1 | tail -20
```

Expected: all tests pass (the old multi-game lobby tests were removed in Task 1).

- [ ] **Step 9: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add games/boxing/plugin games/dance/plugin games/fps-boxing/plugin engine/Cargo.toml engine/engine-core/Cargo.toml
git commit -m "refactor: move plugin crates to games/*/plugin/"
```

---

## Task 4: Create game server binaries

**Files:**
- Create: `games/boxing/server/Cargo.toml` + `src/main.rs`
- Create: `games/dance/server/Cargo.toml` + `src/main.rs`
- Create: `games/fps-boxing/server/Cargo.toml` + `src/main.rs`
- Modify: `engine/Cargo.toml` (add server crates to workspace)

- [ ] **Step 1: Create games/boxing/server/**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/boxing/server/src
```

Write `games/boxing/server/Cargo.toml`:

```toml
[package]
name = "boxing-server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "boxing-server"
path = "src/main.rs"

[dependencies]
engine-core = { path = "../../../engine/engine-core" }
boxing-plugin = { path = "../plugin" }
tokio = { version = "1.52.1", features = ["full"] }
plugin-trait = { path = "../../../engine/plugin-trait" }
```

Write `games/boxing/server/src/main.rs`:

```rust
use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = BoxingPlugin::new(BoxingConfig {
        hp: 800,
        round_secs: 90.0,
        max_wins: 3,
        bot_difficulty: Difficulty::Normal,
    });
    run(Arc::new(plugin), EngineConfig {
        port: 8001,
        client_dist: "games/boxing/client/dist".to_string(),
        game_name: "boxing".to_string(),
    })
    .await;
}
```

- [ ] **Step 2: Create games/dance/server/**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/dance/server/src
```

Write `games/dance/server/Cargo.toml`:

```toml
[package]
name = "dance-server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "dance-server"
path = "src/main.rs"

[dependencies]
engine-core = { path = "../../../engine/engine-core" }
dance-plugin = { path = "../plugin" }
tokio = { version = "1.52.1", features = ["full"] }
plugin-trait = { path = "../../../engine/plugin-trait" }
```

Write `games/dance/server/src/main.rs`:

```rust
use dance_plugin::{DancePlugin, DanceConfig};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = DancePlugin::new(DanceConfig { max_wins: 3 });
    run(Arc::new(plugin), EngineConfig {
        port: 8002,
        client_dist: "games/dance/client/dist".to_string(),
        game_name: "dance".to_string(),
    })
    .await;
}
```

- [ ] **Step 3: Create games/fps-boxing/server/**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/fps-boxing/server/src
```

Write `games/fps-boxing/server/Cargo.toml`:

```toml
[package]
name = "fps-boxing-server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "fps-boxing-server"
path = "src/main.rs"

[dependencies]
engine-core = { path = "../../../engine/engine-core" }
fps-boxing-plugin = { path = "../plugin" }
tokio = { version = "1.52.1", features = ["full"] }
plugin-trait = { path = "../../../engine/plugin-trait" }
```

Write `games/fps-boxing/server/src/main.rs`:

```rust
use fps_boxing_plugin::{FPSBoxingPlugin, FPSBoxingConfig};
use engine_core::{run, EngineConfig};
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let plugin = FPSBoxingPlugin::new(FPSBoxingConfig {
        hp: 800,
        round_secs: 90.0,
        max_wins: 3,
    });
    run(Arc::new(plugin), EngineConfig {
        port: 8003,
        client_dist: "games/fps-boxing/client/dist".to_string(),
        game_name: "fps_boxing".to_string(),
    })
    .await;
}
```

- [ ] **Step 4: Add server crates to engine workspace**

Update `engine/Cargo.toml`:

```toml
[workspace]
members = [
    "engine-core",
    "plugin-trait",
    "boxing-core",
    "../games/boxing/plugin",
    "../games/boxing/server",
    "../games/dance/plugin",
    "../games/dance/server",
    "../games/fps-boxing/plugin",
    "../games/fps-boxing/server",
]
resolver = "2"
```

- [ ] **Step 5: Verify all three binaries compile**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo build -p boxing-server -p dance-server -p fps-boxing-server 2>&1 | tail -10
```

Expected: all three compile. Note: they will fail to start (no `games/*/client/dist` yet) but should compile.

- [ ] **Step 6: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add games/boxing/server games/dance/server games/fps-boxing/server engine/Cargo.toml
git commit -m "feat: add per-game server binaries (boxing, dance, fps-boxing)"
```

---

## Task 5: Create games/boxing/client/

**Files:**
- Create: `games/boxing/client/` (merged from `mobile/` boxing UI + `overlay/` boxing renderer)

The combined boxing client routes on `?slot=` URL param: presence → player camera view, absence → spectator/overlay view.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/src/components
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/src/hooks
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/src/lib
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/src/workers
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/src/test
mkdir -p /Users/sickle/Coding/spectre/games/boxing/client/public
```

- [ ] **Step 2: Copy player-side files from mobile/**

```bash
BOXING=/Users/sickle/Coding/spectre/games/boxing/client
MOBILE=/Users/sickle/Coding/spectre/mobile

cp $MOBILE/src/components/AvatarCanvas.tsx $BOXING/src/components/
cp $MOBILE/src/components/AvatarCanvas.test.tsx $BOXING/src/components/
cp $MOBILE/src/components/CalibrationOverlay.tsx $BOXING/src/components/
cp $MOBILE/src/components/CameraView.tsx $BOXING/src/components/
cp $MOBILE/src/components/ConnectionScreen.tsx $BOXING/src/components/
cp $MOBILE/src/components/GameScreen.tsx $BOXING/src/components/
cp $MOBILE/src/components/HitFlash.tsx $BOXING/src/components/
cp $MOBILE/src/components/MatchEndScreen.tsx $BOXING/src/components/
cp $MOBILE/src/components/PoseOverlay.tsx $BOXING/src/components/
cp $MOBILE/src/components/StatusBar.tsx $BOXING/src/components/
cp $MOBILE/src/hooks/useCalibration.test.ts $BOXING/src/hooks/
cp $MOBILE/src/hooks/useCamera.ts $BOXING/src/hooks/
cp $MOBILE/src/hooks/useGameSocket.test.ts $BOXING/src/hooks/
cp $MOBILE/src/hooks/useGameSocket.ts $BOXING/src/hooks/
cp $MOBILE/src/hooks/usePose.ts $BOXING/src/hooks/
cp $MOBILE/src/lib/skeleton.test.ts $BOXING/src/lib/
cp $MOBILE/src/lib/skeleton.ts $BOXING/src/lib/skeleton.mobile.ts
cp $MOBILE/src/lib/velocity.test.ts $BOXING/src/lib/
cp $MOBILE/src/workers/pose.worker.ts $BOXING/src/workers/
cp $MOBILE/src/test/setup.ts $BOXING/src/test/
cp $MOBILE/src/app.css $BOXING/src/
cp $MOBILE/src/index.css $BOXING/src/
cp $MOBILE/index.html $BOXING/
```

Note: `skeleton.ts` exists in both `mobile/` and `overlay/` with different implementations. Copying mobile's as `skeleton.mobile.ts` and overlay's as `skeleton.overlay.ts` then checking if they can be merged or need to stay separate.

- [ ] **Step 3: Copy overlay/spectator-side files from overlay/**

```bash
OVERLAY=/Users/sickle/Coding/spectre/overlay

cp $OVERLAY/src/components/CommentarySubtitle.tsx $BOXING/src/components/
cp $OVERLAY/src/components/HudLayer.tsx $BOXING/src/components/
cp $OVERLAY/src/components/ParallaxBackground.tsx $BOXING/src/components/
cp $OVERLAY/src/components/PixiCanvas.tsx $BOXING/src/components/
cp $OVERLAY/src/components/RoundOverlay.tsx $BOXING/src/components/
cp $OVERLAY/src/components/SettingsPanel.tsx $BOXING/src/components/
cp $OVERLAY/src/components/WaitingOverlay.tsx $BOXING/src/components/
cp $OVERLAY/src/hooks/useCommentary.ts $BOXING/src/hooks/
cp $OVERLAY/src/hooks/useSpectatorSocket.ts $BOXING/src/hooks/
cp $OVERLAY/src/hooks/useSpectatorSocket.dance.test.ts $BOXING/src/hooks/
cp $OVERLAY/src/lib/boxerDraw.ts $BOXING/src/lib/
cp $OVERLAY/src/lib/interpolate.ts $BOXING/src/lib/
cp $OVERLAY/src/lib/sfx.ts $BOXING/src/lib/
cp $OVERLAY/src/lib/skeleton.ts $BOXING/src/lib/skeleton.overlay.ts
cp $OVERLAY/src/lib/skeletonFade.ts $BOXING/src/lib/
cp $OVERLAY/src/lib/sparks.ts $BOXING/src/lib/
```

- [ ] **Step 4: Resolve skeleton.ts conflict**

Compare the two skeleton files:
```bash
diff /Users/sickle/Coding/spectre/games/boxing/client/src/lib/skeleton.mobile.ts \
     /Users/sickle/Coding/spectre/games/boxing/client/src/lib/skeleton.overlay.ts
```

If identical or nearly identical: keep one as `skeleton.ts`, delete the other, update imports.
If different: keep both as `skeleton.mobile.ts` and `skeleton.overlay.ts`, update each importing file to use the correct one.

- [ ] **Step 5: Create combined App.tsx**

Write `games/boxing/client/src/App.tsx`:

```tsx
import './app.css'

const slot = new URLSearchParams(window.location.search).get('slot')

// Lazy split: player view (slot=1 or slot=2) vs spectator overlay view
const PlayerApp = slot
  ? (await import('./PlayerApp')).default
  : null

export { default as OverlayApp } from './OverlayApp'
```

Actually, use a simpler synchronous approach. Write `games/boxing/client/src/App.tsx`:

```tsx
import './app.css'
import { PlayerApp } from './PlayerApp'
import { OverlayApp } from './OverlayApp'

const isPlayer = new URLSearchParams(window.location.search).has('slot')

export default function App() {
  return isPlayer ? <PlayerApp /> : <OverlayApp />
}
```

- [ ] **Step 6: Create PlayerApp.tsx (from mobile's App.tsx)**

Copy `mobile/src/App.tsx` to `games/boxing/client/src/PlayerApp.tsx`. Change the export:

```tsx
// At top, change:
// export default App
// to:
export { App as PlayerApp }
```

And simplify: remove the `gameType` URL param reading and the `readInitialGame` function — boxing client always plays boxing.

- [ ] **Step 7: Create OverlayApp.tsx (from overlay's App.tsx)**

Copy `overlay/src/App.tsx` to `games/boxing/client/src/OverlayApp.tsx`. Change:

1. Remove `gameType === 'dance'` branch and the `DanceHud` import entirely (boxing client never shows dance HUD).
2. Keep only `gameType === 'boxing' || gameType === 'fps_boxing'` HUD branch (simplify to always render HudLayer since this server only runs boxing).
3. Change export to named: `export { App as OverlayApp }`.

- [ ] **Step 8: Create package.json**

Write `games/boxing/client/package.json`:

```json
{
  "name": "boxing-client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b --force && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.34",
    "pixi.js": "^8.18.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "ws": "^8.20.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^24.12.2",
    "@types/react": "^18.2.79",
    "@types/react-dom": "^18.2.25",
    "@types/ws": "^8.18.1",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.2.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.5.0",
    "jsdom": "^29.0.2",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.58.2",
    "vite": "^8.0.10",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 9: Create vite.config.ts**

Write `games/boxing/client/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5173,
  },
}))
```

- [ ] **Step 10: Create tsconfig.json**

Copy from `mobile/tsconfig.json`. Update paths: change `../shared` → `../../../shared`.

- [ ] **Step 11: Install deps and build**

```bash
cd /Users/sickle/Coding/spectre/games/boxing/client
npm install
npm run build 2>&1 | tail -20
```

Expected: build succeeds and `dist/` is created. Fix any import path errors that arise.

- [ ] **Step 12: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add games/boxing/client
git commit -m "feat: add boxing client (merged mobile + overlay boxing components)"
```

---

## Task 6: Create games/dance/client/

**Files:**
- Create: `games/dance/client/` (dance-specific subset of mobile + overlay)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/src/components
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/src/hooks
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/src/lib
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/src/workers
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/src/test
mkdir -p /Users/sickle/Coding/spectre/games/dance/client/public
```

- [ ] **Step 2: Copy player-side files from mobile/ (same as boxing — all games use MediaPipe)**

```bash
DANCE=/Users/sickle/Coding/spectre/games/dance/client
MOBILE=/Users/sickle/Coding/spectre/mobile
OVERLAY=/Users/sickle/Coding/spectre/overlay

for f in AvatarCanvas.tsx AvatarCanvas.test.tsx CalibrationOverlay.tsx CameraView.tsx \
          ConnectionScreen.tsx GameScreen.tsx HitFlash.tsx MatchEndScreen.tsx \
          PoseOverlay.tsx StatusBar.tsx; do
  cp $MOBILE/src/components/$f $DANCE/src/components/
done

cp $MOBILE/src/hooks/useCalibration.test.ts $DANCE/src/hooks/
cp $MOBILE/src/hooks/useCamera.ts $DANCE/src/hooks/
cp $MOBILE/src/hooks/useGameSocket.test.ts $DANCE/src/hooks/
cp $MOBILE/src/hooks/useGameSocket.ts $DANCE/src/hooks/
cp $MOBILE/src/hooks/usePose.ts $DANCE/src/hooks/
cp $MOBILE/src/lib/skeleton.ts $DANCE/src/lib/
cp $MOBILE/src/lib/skeleton.test.ts $DANCE/src/lib/
cp $MOBILE/src/lib/velocity.test.ts $DANCE/src/lib/ 2>/dev/null || true
cp $MOBILE/src/workers/pose.worker.ts $DANCE/src/workers/
cp $MOBILE/src/test/setup.ts $DANCE/src/test/
cp $MOBILE/src/app.css $DANCE/src/
cp $MOBILE/src/index.css $DANCE/src/
cp $MOBILE/index.html $DANCE/
```

- [ ] **Step 3: Copy dance-specific overlay components**

```bash
cp $OVERLAY/src/components/DanceHud.tsx $DANCE/src/components/
cp $OVERLAY/src/components/DanceHud.test.tsx $DANCE/src/components/
cp $OVERLAY/src/components/HudLayer.tsx $DANCE/src/components/
cp $OVERLAY/src/components/ParallaxBackground.tsx $DANCE/src/components/
cp $OVERLAY/src/components/PixiCanvas.tsx $DANCE/src/components/
cp $OVERLAY/src/components/RoundOverlay.tsx $DANCE/src/components/
cp $OVERLAY/src/components/WaitingOverlay.tsx $DANCE/src/components/
cp $OVERLAY/src/hooks/useDanceState.ts $DANCE/src/hooks/
cp $OVERLAY/src/hooks/useSpectatorSocket.ts $DANCE/src/hooks/
cp $OVERLAY/src/hooks/useSpectatorSocket.dance.test.ts $DANCE/src/hooks/
cp $OVERLAY/src/lib/sfx.ts $DANCE/src/lib/
cp $OVERLAY/src/lib/interpolate.ts $DANCE/src/lib/
cp $OVERLAY/src/lib/sparks.ts $DANCE/src/lib/
```

Note: dance doesn't need `boxerDraw.ts`, `skeletonFade.ts` (boxing-specific rendering).

- [ ] **Step 4: Create combined App.tsx, PlayerApp.tsx, OverlayApp.tsx**

`games/dance/client/src/App.tsx`:

```tsx
import './app.css'
import { PlayerApp } from './PlayerApp'
import { OverlayApp } from './OverlayApp'

const isPlayer = new URLSearchParams(window.location.search).has('slot')

export default function App() {
  return isPlayer ? <PlayerApp /> : <OverlayApp />
}
```

`games/dance/client/src/PlayerApp.tsx`: Copy from `mobile/src/App.tsx`, rename export to `PlayerApp`, remove `readInitialGame` and `gameType` since dance server always plays dance.

`games/dance/client/src/OverlayApp.tsx`: Copy from `overlay/src/App.tsx`, rename export to `OverlayApp`, remove the `gameType === 'boxing' || gameType === 'fps_boxing'` HudLayer branch (dance overlay only shows DanceHud).

- [ ] **Step 5: Create package.json, vite.config.ts, tsconfig.json**

`games/dance/client/package.json` — same as boxing client but name is `"dance-client"` and no `three` dependency.

`games/dance/client/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command }) => ({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5174,
  },
}))
```

`tsconfig.json` — same as boxing client but paths point to `../../../shared`.

- [ ] **Step 6: Install deps and build**

```bash
cd /Users/sickle/Coding/spectre/games/dance/client
npm install
npm run build 2>&1 | tail -20
```

Expected: build succeeds. Fix any import errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add games/dance/client
git commit -m "feat: add dance client (merged mobile + overlay dance components)"
```

---

## Task 7: Move fps/ to games/fps-boxing/client/

**Files:**
- Move: `fps/` → `games/fps-boxing/client/`

This is the simplest frontend task — fps is already self-contained.

- [ ] **Step 1: Copy fps to games/fps-boxing/client/**

```bash
mkdir -p /Users/sickle/Coding/spectre/games/fps-boxing/client
cp -r /Users/sickle/Coding/spectre/fps/. /Users/sickle/Coding/spectre/games/fps-boxing/client/
```

- [ ] **Step 2: Update vite.config.ts**

In `games/fps-boxing/client/vite.config.ts`, change `base` and port:

```ts
export default defineConfig(({ command }) => ({
  base: '/',  // was: process.env.VERCEL ? '/' : command === 'build' ? '/fps/' : '/'
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../../../shared'),
      '@mediapipe/tasks-vision': path.resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5175,  // was: 5174
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-e2e/**'],
  },
}))
```

- [ ] **Step 3: Update @shared alias path**

`tsconfig.json` in `games/fps-boxing/client/` — update `paths` from `../shared/*` to `../../../shared/*`.

- [ ] **Step 4: Install deps and build**

```bash
cd /Users/sickle/Coding/spectre/games/fps-boxing/client
npm install
npm run build 2>&1 | tail -20
```

Expected: build succeeds with `dist/` created.

- [ ] **Step 5: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add games/fps-boxing/client
git commit -m "feat: move fps client to games/fps-boxing/client/"
```

---

## Task 8: Create per-game launch scripts

**Files:**
- Create: `scripts/boxing.sh`, `scripts/dance.sh`, `scripts/fps-boxing.sh`
- Modify: `scripts/dev.sh`

- [ ] **Step 1: Create scripts/boxing.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/boxing/client/node_modules" ] && (cd "$ROOT/games/boxing/client" && npm install)

for port in 8001 5173; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building boxing client..."
(cd "$ROOT/games/boxing/client" && npm run build > /tmp/spectre-boxing-client.log 2>&1) || {
  echo "Boxing client build FAILED."; tail -20 /tmp/spectre-boxing-client.log; exit 1
}

echo "Building boxing server..."
(cd "$ROOT/engine" && cargo build -p boxing-server --release > /tmp/spectre-boxing-server.log 2>&1) || {
  echo "Boxing server build FAILED."; tail -20 /tmp/spectre-boxing-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8001 "$ROOT/engine/target/release/boxing-server" &
server_pid=$!

cd "$ROOT/games/boxing/client"
npm run dev -- --port 5173 > /tmp/spectre-boxing-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
Boxing server running.
  Lobby:    http://localhost:8001/
  LAN:      http://${LAN_IP}:8001/
  Vite dev: http://localhost:5173/
Press Ctrl+C to stop.
============================================================
EOF

wait
```

```bash
chmod +x /Users/sickle/Coding/spectre/scripts/boxing.sh
```

- [ ] **Step 2: Create scripts/dance.sh**

Same pattern as `boxing.sh` with ports 8002/5174 and binary `dance-server`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/dance/client/node_modules" ] && (cd "$ROOT/games/dance/client" && npm install)

for port in 8002 5174; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building dance client..."
(cd "$ROOT/games/dance/client" && npm run build > /tmp/spectre-dance-client.log 2>&1) || {
  echo "Dance client build FAILED."; tail -20 /tmp/spectre-dance-client.log; exit 1
}

echo "Building dance server..."
(cd "$ROOT/engine" && cargo build -p dance-server --release > /tmp/spectre-dance-server.log 2>&1) || {
  echo "Dance server build FAILED."; tail -20 /tmp/spectre-dance-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8002 "$ROOT/engine/target/release/dance-server" &
server_pid=$!

cd "$ROOT/games/dance/client"
npm run dev -- --port 5174 > /tmp/spectre-dance-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
Dance server running.
  Lobby:    http://localhost:8002/
  LAN:      http://${LAN_IP}:8002/
  Vite dev: http://localhost:5174/
Press Ctrl+C to stop.
============================================================
EOF

wait
```

```bash
chmod +x /Users/sickle/Coding/spectre/scripts/dance.sh
```

- [ ] **Step 3: Create scripts/fps-boxing.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ ! -d "$ROOT/games/fps-boxing/client/node_modules" ] && (cd "$ROOT/games/fps-boxing/client" && npm install)

for port in 8003 5175; do
  pids=( $(lsof -ti :$port 2>/dev/null || true) )
  [ "${#pids[@]}" -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
done

echo "Building fps-boxing client..."
(cd "$ROOT/games/fps-boxing/client" && npm run build > /tmp/spectre-fps-client.log 2>&1) || {
  echo "FPS-Boxing client build FAILED."; tail -20 /tmp/spectre-fps-client.log; exit 1
}

echo "Building fps-boxing server..."
(cd "$ROOT/engine" && cargo build -p fps-boxing-server --release > /tmp/spectre-fps-server.log 2>&1) || {
  echo "FPS-Boxing server build FAILED."; tail -20 /tmp/spectre-fps-server.log; exit 1
}

cleanup() { kill "${server_pid:-}" "${vite_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8003 "$ROOT/engine/target/release/fps-boxing-server" &
server_pid=$!

cd "$ROOT/games/fps-boxing/client"
npm run dev -- --port 5175 > /tmp/spectre-fps-dev.log 2>&1 &
vite_pid=$!

sleep 1.5
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "<lan-ip>")

cat <<EOF

============================================================
FPS-Boxing server running.
  Lobby:    http://localhost:8003/
  LAN:      http://${LAN_IP}:8003/
  Vite dev: http://localhost:5175/
Press Ctrl+C to stop.
============================================================
EOF

wait
```

```bash
chmod +x /Users/sickle/Coding/spectre/scripts/fps-boxing.sh
```

- [ ] **Step 4: Update scripts/dev.sh**

Replace `scripts/dev.sh` content with:

```bash
#!/usr/bin/env bash
# Starts all three games in parallel. Each game can also be started independently:
#   bash scripts/boxing.sh
#   bash scripts/dance.sh
#   bash scripts/fps-boxing.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  echo "Stopping all games..."
  kill "${boxing_pid:-}" "${dance_pid:-}" "${fps_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

bash "$ROOT/scripts/boxing.sh" &
boxing_pid=$!

bash "$ROOT/scripts/dance.sh" &
dance_pid=$!

bash "$ROOT/scripts/fps-boxing.sh" &
fps_pid=$!

wait
```

- [ ] **Step 5: Commit**

```bash
cd /Users/sickle/Coding/spectre
git add scripts/boxing.sh scripts/dance.sh scripts/fps-boxing.sh scripts/dev.sh
git commit -m "feat: add per-game launch scripts, update dev.sh"
```

---

## Task 9: Smoke test each game independently

- [ ] **Step 1: Test boxing**

```bash
cd /Users/sickle/Coding/spectre
bash scripts/boxing.sh > /tmp/boxing-smoke.log 2>&1 &
BPID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/ 
# Expected: 200
curl -s -X POST http://localhost:8001/rooms | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK:', d['room_code'])"
# Expected: OK: <6 char code>
kill $BPID 2>/dev/null || true
```

- [ ] **Step 2: Test dance**

```bash
bash scripts/dance.sh > /tmp/dance-smoke.log 2>&1 &
DPID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:8002/
# Expected: 200
curl -s -X POST http://localhost:8002/rooms | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK:', d['room_code'])"
# Expected: OK: <6 char code>
kill $DPID 2>/dev/null || true
```

- [ ] **Step 3: Test fps-boxing**

```bash
bash scripts/fps-boxing.sh > /tmp/fps-smoke.log 2>&1 &
FPID=$!
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:8003/
# Expected: 200
curl -s -X POST http://localhost:8003/rooms | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK:', d['room_code'])"
# Expected: OK: <6 char code>
kill $FPID 2>/dev/null || true
```

- [ ] **Step 4: Run full Rust test suite**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo test 2>&1 | tail -20
```

Expected: all tests pass.

---

## Task 10: Delete old directories

Only do this after Task 9 passes with no failures.

- [ ] **Step 1: Delete old mobile/ and overlay/**

```bash
rm -rf /Users/sickle/Coding/spectre/mobile
rm -rf /Users/sickle/Coding/spectre/overlay
```

- [ ] **Step 2: Delete old engine plugin directories**

```bash
rm -rf /Users/sickle/Coding/spectre/engine/boxing-plugin
rm -rf /Users/sickle/Coding/spectre/engine/dance-plugin
rm -rf /Users/sickle/Coding/spectre/engine/fps-boxing-plugin
```

Note: do NOT delete `fps/` yet — keep it until you've verified `games/fps-boxing/client/` fully works. Delete it after confirmation.

- [ ] **Step 3: Verify workspace still builds after deletion**

```bash
cd /Users/sickle/Coding/spectre/engine
cargo build 2>&1 | tail -5
```

- [ ] **Step 4: Final commit**

```bash
cd /Users/sickle/Coding/spectre
git add -A
git commit -m "refactor: delete legacy mobile/, overlay/, engine/*-plugin dirs"
```

---

## Self-Review Notes

- The `engine-core` lib uses `ServeFile` from `tower-http` — already in deps via the `fs` feature.
- The room page HTML template (`web/room.html`) stays in `engine-core/web/` — it's embedded via `include_str!` and works unchanged since it uses `{{PLACEHOLDER}}` substitution.
- The `?game=` query param is removed from `POST /rooms` — any existing frontend code calling `/rooms?game=boxing` must be updated to just `POST /rooms`.
- `engine/boxing-plugin/`, `engine/dance-plugin/`, `engine/fps-boxing-plugin/` remain in the old location until Task 3; don't delete them before then.
- If `cargo build` fails on workspace path resolution, check that the relative paths in `engine/Cargo.toml` use `../games/` not `../../games/`.
- The combined client's `index.html` comes from `mobile/index.html` — update the `<title>` to be game-specific (e.g., "Boxing | Spectre").
