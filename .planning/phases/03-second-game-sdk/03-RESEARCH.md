# Phase 3: Second Game + SDK - Research

**Researched:** 2026-05-02
**Domain:** Rust game plugin trait — dance scoring game, HTTP plugin registry, static lobby UI, SDK documentation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Second game is rhythm/beat-gated dance scoring. Server cycles through target poses; players score on keypoint similarity within each beat window.

**D-02:** Beat interval = 60 ticks (1 second at 60Hz). One round = 16 beats. `RoundOver` fires after beat 16; `winner = Some(slot)` for higher cumulative score, or `None` for a draw.

**D-03:** Beat broadcast via `GameEvent::Broadcast { payload: Value }` at each beat transition. No new GameEvent variants or trait methods. Payload: `{ "type": "dance_beat", "target_pose": [...], "beat": N }`.

**D-04:** Solo mode: single player scores alone with no bot opponent. `RoundOver` fires after 16 beats with a single-player score. No bot logic in dance plugin.

**D-05:** Dance plugin's `on_calibration_complete` is a no-op (no reference velocity needed). `CalibrationDone` from mobile still serves as "ready to start" signal.

**D-06:** If implementing dance reveals any missing trait surface (GAME2-02), treat as interface bugs — fix trait and update boxing before closing phase.

**D-07:** Game selection per-room: `POST /rooms?game=boxing` or `POST /rooms?game=dance`. Returns room code JSON. Mobile client joins via existing WebSocket endpoint — no TypeScript changes.

**D-08:** Axum serves static HTML page at `/` — lobby UI with game picker buttons and room code display. No build step, no framework. Embedded in binary.

**D-09:** Room manager holds plugin registry: `HashMap<&str, Arc<dyn GamePlugin + Send + Sync>>`. Both plugins instantiated at startup. Room creation picks from registry based on `game` query param.

**D-10:** Developer guide at `docs/GAME-SDK.md`. Root `README.md` links to it.

**D-11:** `docs/GAME-SDK.md` structure: trait interface reference + boxing plugin walkthrough + quick-start boilerplate. Target length 500–800 lines.

**D-12:** Rustdoc (`///` comments) on `GamePlugin` trait and all context/event types refreshed and polished.

### Claude's Discretion

- Scoring algorithm for pose similarity (cosine similarity, joint angle distance, or per-keypoint Euclidean distance)
- Target pose library: number of poses (5–10), specific keypoint values, pose names
- When within a beat window to sample player's pose (best frame, average, or last frame before beat transition)
- URL shape for room creation response (`{ "room_code": "ABC123" }` or similar)
- Error handling for unknown `?game=` values (400 response with error JSON)
- CSS styling of the static lobby HTML (minimal)

### Deferred Ideas (OUT OF SCOPE)

- Audio cue integration for dance (requires new wire message type + client changes)
- Score history / match replay
- AI game generation (AI-01) — deferred until SDK proven
- Commentary for dance (COMM-01..04)
- Per-user high scores / persistent leaderboard
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAME2-01 | Second game plugin (dance scoring) implemented using GamePlugin trait | DancePlugin struct, DanceState, `on_tick` beat clock, cosine-similarity pose scoring, `GameEvent::Broadcast` for beat/score events |
| GAME2-02 | Second game requires zero changes to engine code; trait additions = interface bugs | Confirmed: existing trait surface (init_state, on_tick, on_calibration_complete, on_round_reset, on_player_join, GameEvent::Broadcast) is sufficient for dance; no new methods needed |
| SDK-01 | GamePlugin trait and all context/event types documented with Rustdoc | `plugin-trait/src/lib.rs` `///` comment refresh; all 7 methods + 8 types to cover |
| SDK-02 | Boxing plugin as annotated worked example | `docs/GAME-SDK.md` boxing walkthrough section with line-range cross-references |
| SDK-03 | README explains how to add a new game in concrete steps | `docs/GAME-SDK.md` quick-start boilerplate + README teaser paragraph with link |
</phase_requirements>

---

## Summary

Phase 3 delivers three loosely-coupled deliverables that share a single theme: proving and documenting the plugin abstraction. The primary concern is verifying that the `GamePlugin` trait established in Phase 2 is genuinely general-purpose — the dance scoring plugin is the proof-of-concept, and the SDK documentation is the packaging of that proof for future developers.

The dance plugin is structurally simpler than boxing. It needs no velocity calibration, no per-player health tracking, no bot logic, and no hit detection math. The core behavior is a modulo-60 beat clock using `tick_info.tick`, pose comparison math on `ctx.frames`, and `GameEvent::Broadcast` for beat/score events. All the necessary trait surface already exists.

The HTTP endpoint change (`POST /rooms?game=X`) and plugin registry in `AppState` are small surgical edits to `main.rs` and `room_manager.rs`. The existing `RoomManager::create_room(plugin: Arc<dyn GamePlugin + Send + Sync>)` signature already accepts a plugin argument — the change is just picking which plugin to pass from a registry based on the query param.

**Primary recommendation:** Implement the dance plugin first to validate the trait is sufficient (GAME2-02 gate), then write the SDK docs with the dance plugin as confirmation that the interface works for two orthogonal game types.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Beat clock + pose scoring | Plugin (dance-plugin crate) | — | All game logic stays in the plugin per the core architecture contract |
| Beat/score broadcasts | Plugin via GameEvent::Broadcast | Engine (dispatch) | Plugin emits events; engine dispatches — existing pattern |
| Plugin registry | API/Backend (main.rs AppState) | — | Registry lives with AppState at startup; room creation picks from it |
| POST /rooms endpoint | API/Backend (main.rs Axum router) | — | New HTTP route alongside existing WS routes |
| Static lobby HTML | API/Backend (main.rs inline response) | — | Embedded `const &str`, served by Axum GET / handler |
| Rustdoc on trait | Plugin-trait crate | — | Documentation lives co-located with the source it describes |
| Developer guide | docs/ | README teaser | Markdown file at docs/GAME-SDK.md, README links to it |

---

## Standard Stack

### Core (already in workspace — no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| plugin-trait | workspace | GamePlugin trait, TickContext, GameEvent, PoseKeypoint | All game plugins import this crate |
| serde_json | 1.0.149 | `json!()` macro for Broadcast payloads | Already in workspace |
| axum | 0.8.9 | `Query` extractor for `?game=` param, `Json` response for POST /rooms, GET / handler | Already in engine-core |
| tokio | 1.52.1 | Async runtime | Already in engine-core |

`[VERIFIED: Cargo.lock in codebase — all versions confirmed]`

### New Crate: dance-plugin

The dance-plugin is a new Cargo workspace member mirroring boxing-plugin's structure.

**Cargo.toml additions:**
```toml
# engine/Cargo.toml — add to members
members = ["engine-core", "plugin-trait", "boxing-plugin", "dance-plugin"]

# engine/dance-plugin/Cargo.toml
[package]
name = "dance-plugin"
version = "0.1.0"
edition = "2021"

[lib]
name = "dance_plugin"
path = "src/lib.rs"

[dependencies]
plugin-trait = { path = "../plugin-trait" }
serde_json = "1.0.149"
```

No new external dependencies. Dance plugin needs no `rand` (no randomized bot) and no `tracing` beyond what is already available.

`[VERIFIED: boxing-plugin/Cargo.toml — mirroring its minimal dependency set]`

**engine-core/Cargo.toml addition:**
```toml
dance-plugin = { path = "../dance-plugin" }
```

---

## Architecture Patterns

### System Architecture Diagram

```
Mobile Client                        Server (engine-core)
POST /rooms?game=dance  ─────────►  Axum router
                                      │ Query<GameParam> extracts "dance"
                                      │ registry.get("dance") → Arc<DancePlugin>
                                      │ room_manager.create_room(code, plugin)
                        ◄─────────   JSON { "room_code": "XYZ123" }

GET /                   ─────────►  Axum router
                        ◄─────────  HTML lobby page (embedded const &str)

WS /ws/player/{code}   ─────────►  Existing WebSocket handler (UNCHANGED)
  pose_frame @60Hz                   │
                                     ▼
                                  room_actor (select! loop)
                                     │
                                     ▼ 60Hz tick
                                  game_loop::game_tick
                                     │ TickContext{frames, tick_info, room}
                                     ▼
                                  DancePlugin::on_tick
                                     │ beat clock: tick % 60 == 0
                                     │ score_pose(player_frame, target_pose)
                                     │ returns Vec<GameEvent>:
                                     │   Broadcast { dance_beat }
                                     │   Broadcast { dance_score }
                                     │   RoundOver { winner } (after beat 16)
                                     ▼
                                  dispatch_events (UNCHANGED)
                                     │ Broadcast → game_tx (spectators + players)
                                     │ RoundOver → handle_round_over (UNCHANGED)
```

### Recommended Project Structure

```
engine/
├── dance-plugin/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs       # DancePlugin impl + DanceState + GamePlugin trait impl
│       └── poses.rs     # POSE_LIBRARY: const [TargetPose; N] with PoseKeypoint arrays
├── plugin-trait/
│   └── src/lib.rs       # Rustdoc refresh (SDK-01)
└── engine-core/
    └── src/
        └── main.rs      # AppState → plugin registry, POST /rooms, GET / lobby

docs/
└── GAME-SDK.md          # Developer guide (SDK-02, SDK-03)

README.md                # One-paragraph "How to add a game" teaser + link to GAME-SDK.md
```

### Pattern 1: Beat Clock Using tick_info.tick

**What:** Mod-60 arithmetic on the monotonic tick counter to detect beat boundaries.
**When to use:** Any rhythm-gated behavior in a 60Hz plugin.

```rust
// Source: CONTEXT.md D-02; tick_info.tick from plugin-trait/src/lib.rs TickInfo
const BEAT_INTERVAL: u64 = 60;    // 1 beat per second at 60 Hz
const TOTAL_BEATS: u64 = 16;      // one round = 16 beats

fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
    let s = state.downcast_mut::<DanceState>()
        .expect("dance plugin: state type mismatch");
    let mut events = Vec::new();

    let elapsed_ticks = ctx.tick_info.tick - s.round_start_tick;
    let beat_number = elapsed_ticks / BEAT_INTERVAL;

    // Beat boundary detection
    if elapsed_ticks > 0 && elapsed_ticks % BEAT_INTERVAL == 0 {
        let beat_idx = beat_number as usize;  // 1-based beat that just completed
        // ... score and broadcast
    }

    // Round end
    if beat_number >= TOTAL_BEATS {
        let winner = determine_winner(&s.scores, ctx.room.solo_mode);
        events.push(GameEvent::RoundOver { winner });
    }

    events
}
```

`[VERIFIED: plugin-trait/src/lib.rs TickInfo.tick — confirmed monotonically incremented per game_loop.rs tick += 1]`

### Pattern 2: Pose Similarity Scoring

**What:** Dot-product cosine similarity between normalized player landmark vectors and target pose landmark vectors.
**When to use:** Any game requiring pose matching. Chosen over per-keypoint Euclidean distance because it is scale-invariant — a tall player and a short player produce the same score for the same pose shape.

The scoring compares only high-visibility landmarks to avoid penalizing partially-occluded body parts. Visibility threshold 0.5 filters unreliable keypoints.

```rust
// Source: plugin-trait/src/lib.rs PoseKeypoint {x, y, z, visibility: f64}
// Algorithm: cosine similarity on flattened [x,y,z] vectors (z=0 for MediaPipe 2D)

fn score_pose(player_frame: &PoseFrame, target: &[PoseKeypoint]) -> f64 {
    if player_frame.keypoints.len() < target.len() {
        return 0.0;
    }
    let mut dot = 0.0_f64;
    let mut player_mag = 0.0_f64;
    let mut target_mag = 0.0_f64;
    let mut valid_count = 0usize;

    for (p, t) in player_frame.keypoints.iter().zip(target.iter()) {
        if p.visibility < 0.5 { continue; }  // skip low-confidence landmarks
        dot        += p.x*t.x + p.y*t.y + p.z*t.z;
        player_mag += p.x*p.x + p.y*p.y + p.z*p.z;
        target_mag += t.x*t.x + t.y*t.y + t.z*t.z;
        valid_count += 1;
    }

    if valid_count < 5 || player_mag < 1e-9 || target_mag < 1e-9 {
        return 0.0;  // not enough visible landmarks for a meaningful score
    }
    (dot / (player_mag.sqrt() * target_mag.sqrt())).clamp(0.0, 1.0)
}
```

`[ASSUMED: cosine similarity as the chosen metric — CONTEXT.md leaves this to Claude's discretion]`

### Pattern 3: Plugin Registry in AppState

**What:** Replace `AppState.plugin: Arc<dyn GamePlugin + Send + Sync>` with `AppState.plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>>`. Both plugins instantiated at startup in `main()`.

**Why:** `RoomManager::create_room` already accepts `plugin: Arc<dyn GamePlugin + Send + Sync>` as a parameter — no change needed to room_manager.rs. Only `AppState` and the HTTP handler need updating.

```rust
// Source: engine-core/src/main.rs — current AppState
// BEFORE (Phase 2):
pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugin: Arc<dyn GamePlugin + Send + Sync>,
}

// AFTER (Phase 3):
use std::collections::HashMap;

pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>>,
}

// In main():
let mut plugins: HashMap<String, Arc<dyn GamePlugin + Send + Sync>> = HashMap::new();
plugins.insert("boxing".to_string(), Arc::new(BoxingPlugin::new(boxing_config)));
plugins.insert("dance".to_string(), Arc::new(DancePlugin::new(dance_config)));
let state = Arc::new(AppState {
    rooms: Arc::new(room_manager::RoomManager::new()),
    plugins,
});
```

`[VERIFIED: engine-core/src/main.rs AppState struct — confirmed current shape; engine-core/src/room_manager.rs create_room signature already takes plugin arg]`

### Pattern 4: POST /rooms with Axum Query Extractor

**What:** Axum 0.8.x Query extractor for `?game=` parameter, returning JSON room code.

```rust
// Source: axum 0.8.9 — Query extractor pattern [VERIFIED: Cargo.lock]
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::post,
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CreateRoomParams {
    pub game: Option<String>,
}

#[derive(Serialize)]
pub struct CreateRoomResponse {
    pub room_code: String,
}

async fn create_room(
    Query(params): Query<CreateRoomParams>,
    State(app): State<Arc<AppState>>,
) -> impl IntoResponse {
    let game = params.game.as_deref().unwrap_or("boxing");
    match app.plugins.get(game) {
        Some(plugin) => {
            // Generate a new random 6-char code for this room
            let code: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(6)
                .map(|c| char::from(c).to_ascii_uppercase())
                .collect();
            let actual_code = app.rooms.create_room(code, Arc::clone(plugin));
            (
                axum::http::StatusCode::CREATED,
                Json(CreateRoomResponse { room_code: actual_code }),
            ).into_response()
        }
        None => (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("unknown game: {}", game) })),
        ).into_response(),
    }
}

// Router addition:
let app = Router::new()
    .route("/rooms", post(create_room))
    .route("/", get(lobby_html))
    // ... existing routes
```

`[VERIFIED: axum 0.8.9 — Query extractor is axum::extract::Query; pattern confirmed from axum docs]`

**Note:** `serde` with `Deserialize` must be added to engine-core's `Cargo.toml` imports or confirmed present — it is already present as `serde = { version = "1.0.228", features = ["derive"] }`.

### Pattern 5: Static HTML Embedded in Binary

**What:** `const` string literal served from Axum `GET /` handler. No filesystem dependency; no build step.

```rust
// Source: CONTEXT.md D-08 decision
const LOBBY_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PoseEngine Lobby</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; }
    button { padding: 12px 24px; margin: 8px; font-size: 1rem; cursor: pointer; }
    #room-code { font-size: 2rem; font-weight: bold; letter-spacing: 0.2em; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>Choose a Game</h1>
  <button onclick="createRoom('boxing')">Boxing</button>
  <button onclick="createRoom('dance')">Dance</button>
  <div id="room-code"></div>
  <script>
    async function createRoom(game) {
      const res = await fetch('/rooms?game=' + game, { method: 'POST' });
      const data = await res.json();
      document.getElementById('room-code').textContent = data.room_code ?? data.error;
    }
  </script>
</body>
</html>"#;

async fn lobby_html() -> impl IntoResponse {
    axum::response::Html(LOBBY_HTML)
}
```

`[VERIFIED: axum 0.8.9 has axum::response::Html — a newtype around String that sets Content-Type: text/html]`

### Pattern 6: DanceState Structure

**What:** Per-room state struct for dance plugin, following the boxing `BoxingState` pattern.

```rust
// Source: engine/boxing-plugin/src/lib.rs BoxingState — mirroring structure
pub struct DanceState {
    /// Cumulative score per player slot (index 0 = slot 1, index 1 = slot 2).
    pub scores: [f64; 2],
    /// Which target pose index to show next (cycles through POSE_LIBRARY).
    pub target_index: usize,
    /// Tick number when the round started (set in init_state from tick=0 convention;
    /// real round start captured on first on_tick call if tick==1 or via a flag).
    pub round_start_tick: u64,
    /// Set to true once round_start_tick is locked in (first tick received).
    pub round_started: bool,
    /// How many beats have been scored so far (0..=16).
    pub beats_scored: u64,
}
```

`[VERIFIED: plugin-trait/src/lib.rs — Box<dyn Any + Send> requirement; DanceState has no references, all owned data]`

### Pattern 7: Target Pose Library

**What:** A module `dance-plugin/src/poses.rs` defining static target poses as `const` arrays.

```rust
// Source: engine/boxing-plugin/src/bot.rs BOT_KPS pattern — 33 PoseKeypoint array
use plugin_trait::PoseKeypoint;

pub const KP: fn(f64, f64) -> PoseKeypoint = |x, y| PoseKeypoint { x, y, z: 0.0, visibility: 1.0 };

pub struct TargetPose {
    pub name: &'static str,
    pub keypoints: [PoseKeypoint; 33],
}

// Example: arms_up pose
pub const ARMS_UP: TargetPose = TargetPose {
    name: "ARMS_UP",
    keypoints: [
        KP(0.50, 0.10),  // 0  nose
        // ... all 33 landmarks
    ],
};

pub const POSE_LIBRARY: [&TargetPose; 6] = [
    &ARMS_UP, &ARMS_OUT, &SQUAT, &LEFT_LEAN, &RIGHT_LEAN, &STAR_JUMP,
];
```

**Keypoint index reference (MediaPipe 33 landmarks, hip-centred Y-up after engine normalization):**
- 0: nose (upper face, Y ~ +0.8..+1.0 scaled by body_scale)
- 11/12: left/right shoulder (Y ~ +0.3..+0.4 scaled)
- 13/14: left/right elbow
- 15/16: left/right wrist (arms-up = Y ~ +0.8..+1.0; arms-down = Y ~ -0.1..0)
- 23/24: left/right hip (Y ~ 0.0 — this is the origin after normalization)
- 25/26: left/right knee
- 27/28: left/right ankle

`[VERIFIED: engine/boxing-plugin/src/bot.rs BOT_KPS array — 33 landmarks with correct index comments; engine/boxing-plugin/src/hit_detection.rs landmark constants; engine/game_loop.rs normalize_to_y_up — hip at Y=0, upward positive]`

### Pattern 8: SDK Rustdoc on GamePlugin Trait

**What:** `///` doc comments on every method and type in `plugin-trait/src/lib.rs` covering: intent, when called, what to return, what NOT to do, lifetime/ordering guarantees.

**Template for each method:**
```rust
/// [One-line summary: what this method does]
///
/// **Called when:** [engine lifecycle event]
///
/// **Contract:**
/// - [Constraint 1: e.g., must not block, must not call network]
/// - [Constraint 2: e.g., returned events dispatched after this returns]
///
/// **Return:** [what the return value means and when each variant is appropriate]
///
/// **Do NOT:** [anti-patterns — e.g., don't store references in state, don't panic]
fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;
```

`[VERIFIED: plugin-trait/src/lib.rs — current doc comments exist but are terse; Phase 3 expands them per D-12]`

### Anti-Patterns to Avoid

- **Re-deriving solo_mode per tick:** Read `ctx.room.solo_mode`, never re-derive from `ctx.room.slots[1].connected`. The engine sets `solo_mode` once at match start. Using `slots[1].connected` would activate "solo mode" scoring if P2 disconnects mid-match. `[VERIFIED: game_loop.rs WR-01 comment; room.rs solo_mode field]`

- **Emitting RoundOver before beat 16:** The beat clock must count exactly 16 beats before firing `RoundOver`. Off-by-one bugs arise if using `>= TOTAL_BEATS` vs `== TOTAL_BEATS` on the beat counter — use `beats_scored == TOTAL_BEATS` after incrementing.

- **Clearing scores in `on_calibration_complete`:** Dance plugin's `on_calibration_complete` is a no-op. Do not initialize state there — `init_state` handles all initial state.

- **Using `ctx.tick_info.elapsed_secs` as the beat clock instead of `ctx.tick_info.tick`:** `elapsed_secs` is a float with potential drift. The integer tick counter is the correct clock for beat counting. `[VERIFIED: game_loop.rs tick += 1 — monotonic integer]`

- **Sending `you_were_hit`-style messages to individual players for dance:** Dance scores are cooperative/display-only; use `Broadcast` (not `SendToPlayer`) for score updates so the overlay can display them.

- **Storing `Arc<>` or anything non-`'static` in plugin state:** `Box<dyn Any + Send>` requires `'static`. All state fields must be owned data with no lifetime parameters. `[VERIFIED: plugin-trait/src/lib.rs init_state signature]`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP query param parsing | Manual string split on URL | `axum::extract::Query<T>` with `#[derive(Deserialize)]` | Type-safe, handles encoding, already in dep tree |
| JSON response body | Manual `serde_json::to_string` + status code | `axum::Json(T)` with `impl Serialize` | Axum sets Content-Type header automatically |
| Plugin type registry | Match on string every call site | `HashMap<String, Arc<dyn GamePlugin>>` | O(1) lookup; extensible without match arm additions |
| HTML content-type header | Manual `Response` with header builder | `axum::response::Html(&str)` | One-liner; sets `text/html; charset=utf-8` |
| Pose coordinate normalization | Normalize in dance plugin | Engine already calls `normalize_to_y_up` in `game_loop.rs` | Frames arrive at plugin already in hip-centred Y-up; re-normalizing corrupts values |

**Key insight:** The engine already handles all coordinate normalization, RTT fairness, calibration flow, and round lifecycle. The dance plugin's entire surface is: beat clock arithmetic, pose similarity math, and event emission. Anything else in the plugin is overstepping the engine/game boundary.

---

## Runtime State Inventory

Phase 3 is a code-only addition (new crate + documentation). No renames, no data migrations.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — server is stateless; no external DB | None |
| Live service config | None — no external service config to update | None |
| OS-registered state | None | None |
| Secrets/env vars | None — dance plugin needs no API keys | None |
| Build artifacts | dance-plugin will produce a new `.rlib` in `engine/target/` | None — built on `cargo build` |

---

## Common Pitfalls

### Pitfall 1: round_start_tick Initialization Race

**What goes wrong:** `DanceState.round_start_tick` is initialized in `init_state()` to 0, but `ctx.tick_info.tick` is already > 0 when the first tick arrives (engine increments tick before calling `on_tick`). If the beat clock uses `tick - round_start_tick` and round_start_tick is 0, the beat count will be off by whatever tick count had elapsed before the room started receiving frames.

**Why it happens:** `init_state` is called at room creation, but the game loop only starts after calibration. By then, `state.tick` may be in the hundreds.

**How to avoid:** Capture the actual round start tick on the first `on_tick` call using a flag:
```rust
if !s.round_started {
    s.round_start_tick = ctx.tick_info.tick;
    s.round_started = true;
}
```
`[VERIFIED: game_loop.rs — tick is incremented every 60Hz tick from match start; not from room creation]`

**Warning signs:** Beat 1 fires immediately on round start; all 16 beats fire within the first second.

---

### Pitfall 2: Plugin Registry and AppState Mutation

**What goes wrong:** `AppState.plugins` is a `HashMap<String, Arc<dyn GamePlugin + Send + Sync>>`. The `Arc<AppState>` is cloned into every request handler. If `plugins` is `HashMap` (not wrapped), any future attempt to add plugins at runtime would require a `Mutex`. Phase 3 only needs startup-time registration so a plain `HashMap` is fine — but it must be populated before `Arc::new(AppState {...})` is called.

**Why it happens:** Inserting into a `HashMap` after wrapping in `Arc` requires a `&mut self` access, which `Arc` does not provide without interior mutability.

**How to avoid:** Build the complete `HashMap` before wrapping in `Arc`. All Phase 3 plugins are known at compile time.

`[VERIFIED: engine-core/src/main.rs — AppState is Arc<AppState> cloned into handlers; existing plugin field is not mutated after startup]`

---

### Pitfall 3: RoundOver Emitted Every Tick After Beat 16

**What goes wrong:** If the round-over condition check runs on every tick after beat 16 is passed, `RoundOver` will be emitted on every tick. The engine's `dispatch_events` calls `handle_round_over` for each `RoundOver` event, incrementing win counters multiple times.

**Why it happens:** `beat_number >= TOTAL_BEATS` is true for all subsequent ticks after the round ends. The engine does not automatically stop calling `on_tick` until the next round starts (which takes one engine cycle through `handle_round_over`).

**How to avoid:** Track a `round_ended: bool` flag in `DanceState`. Set it to `true` after emitting `RoundOver`. Check it at the top of `on_tick` and return an empty vec immediately.

`[VERIFIED: game_loop.rs dispatch_events — RoundOver is processed; boxing handles this implicitly because KO/time conditions are naturally one-shot; dance needs an explicit flag]`

---

### Pitfall 4: Workspace Cargo.toml Not Updated

**What goes wrong:** Adding `dance-plugin/Cargo.toml` without adding `"dance-plugin"` to the workspace members in `engine/Cargo.toml` causes `cargo build --workspace` to silently skip the crate; `engine-core` gets a compile error on `use dance_plugin::DancePlugin`.

**How to avoid:** Update `engine/Cargo.toml` `members` array AND `engine/engine-core/Cargo.toml` dependencies in the same wave.

`[VERIFIED: engine/Cargo.toml — members currently ["engine-core", "plugin-trait", "boxing-plugin"]]`

---

### Pitfall 5: Pose Library Uses Raw MediaPipe Coordinates Instead of Y-Up

**What goes wrong:** The bot's `BOT_KPS` in `boxing-plugin/src/bot.rs` uses raw MediaPipe Y-down coordinates (y: 0.10 for nose = near top of frame). If `poses.rs` copies this pattern, the target poses will be in a different coordinate system than the normalized frames arriving in `TickContext` (which are Y-up, hip-centred). Cosine similarity will fail silently — near-zero scores for all poses.

**Why it happens:** `BOT_KPS` is used for the bot's static frame injected before normalization. Player frames are normalized by the engine before delivery to the plugin. These are different coordinate systems.

**How to avoid:** Define target poses in **hip-centred Y-up coordinates** — same system as `TickContext.frames`. In Y-up: nose is at positive Y (~+0.8 body scale), ankles are at negative Y (~-1.2 body scale), hips are at Y=0.

```
Y-up coordinate reference for target poses:
  nose:       y ≈ +0.80  (above hip)
  shoulders:  y ≈ +0.35
  elbows:     y ≈ +0.15 (hanging) to +0.50 (raised)
  wrists:     y ≈ -0.05 (hanging) to +0.80 (arms up)
  hips:       y ≈  0.00  (origin)
  knees:      y ≈ -0.45
  ankles:     y ≈ -0.90
```

`[VERIFIED: game_loop.rs normalize_to_y_up — hip_mid_y becomes 0.0; upward direction is positive Y after flip; bot.rs BOT_KPS uses raw MediaPipe coords — different system]`

---

### Pitfall 6: GAME2-02 Trait Gap Discovery Protocol

**What goes wrong:** Implementation reveals a missing trait method or GameEvent variant partway through. If the developer just adds it to the trait without updating `BoxingPlugin`, `engine-core` will fail to compile with "method not provided" or "pattern not covered" errors.

**How to avoid:** The CONTEXT.md D-06 decision mandates treating any trait gap as an interface bug. The correct procedure:
1. Identify the missing capability
2. Add to `plugin-trait/src/lib.rs` with a default no-op implementation (so existing plugin impls still compile)
3. Update `boxing-plugin` implementation if the new method affects boxing semantics
4. Continue dance implementation

The existing `GameEvent::Broadcast { payload: Value }` covers the dance beat broadcast. No new variants are anticipated. The `on_calibration_complete` no-op default covers the dance plugin's indifference to calibration. **GAME2-02 should pass without trait changes.** `[VERIFIED: all existing GamePlugin methods have default no-op implementations except init_state and on_tick]`

---

## Code Examples

### DancePlugin Full Skeleton

```rust
// Source: engine/boxing-plugin/src/lib.rs — pattern mirrored
use std::any::Any;
use plugin_trait::{GamePlugin, GameEvent, TickContext, PoseFrame, PoseKeypoint};
use serde_json::json;

mod poses;

const BEAT_INTERVAL: u64 = 60;
const TOTAL_BEATS: u64 = 16;

pub struct DanceConfig {
    pub max_wins: u32,
}

pub struct DanceState {
    pub scores: [f64; 2],
    pub target_index: usize,
    pub round_start_tick: u64,
    pub round_started: bool,
    pub beats_scored: u64,
    pub round_ended: bool,
}

pub struct DancePlugin {
    config: DanceConfig,
}

impl DancePlugin {
    pub fn new(config: DanceConfig) -> Self { Self { config } }
}

impl GamePlugin for DancePlugin {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(DanceState {
            scores: [0.0; 2],
            target_index: 0,
            round_start_tick: 0,
            round_started: false,
            beats_scored: 0,
            round_ended: false,
        })
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<DanceState>()
            .expect("dance plugin: state type mismatch");

        if s.round_ended { return vec![]; }

        let mut events = Vec::new();

        // Lock round_start_tick on first tick
        if !s.round_started {
            s.round_start_tick = ctx.tick_info.tick;
            s.round_started = true;
        }

        let elapsed_ticks = ctx.tick_info.tick.saturating_sub(s.round_start_tick);
        let beat_number = elapsed_ticks / BEAT_INTERVAL;

        if elapsed_ticks > 0 && elapsed_ticks % BEAT_INTERVAL == 0
            && s.beats_scored < TOTAL_BEATS
        {
            // Score player poses at beat boundary
            let target = &poses::POSE_LIBRARY[s.target_index % poses::POSE_LIBRARY.len()];

            for slot_idx in 0..2usize {
                if ctx.room.solo_mode && slot_idx == 1 { continue; }
                if let Some(frame) = ctx.frames[slot_idx].back() {
                    s.scores[slot_idx] += score_pose(frame, &target.keypoints);
                }
            }

            s.beats_scored += 1;
            s.target_index = (s.target_index + 1) % poses::POSE_LIBRARY.len();

            // Broadcast beat event
            events.push(GameEvent::Broadcast {
                payload: json!({
                    "type": "dance_beat",
                    "beat": s.beats_scored,
                    "total_beats": TOTAL_BEATS,
                    "target_pose": target.keypoints.iter().map(|kp| [kp.x, kp.y, kp.z, kp.visibility]).collect::<Vec<_>>(),
                }),
            });

            // Broadcast live scores
            events.push(GameEvent::Broadcast {
                payload: json!({
                    "type": "dance_score",
                    "beat": s.beats_scored,
                    "scores": [s.scores[0], s.scores[1]],
                }),
            });
        }

        // Round end after 16 beats
        if s.beats_scored >= TOTAL_BEATS {
            s.round_ended = true;
            let winner = if ctx.room.solo_mode {
                Some(1u8)  // solo: player 1 always "wins" (scores alone)
            } else if s.scores[0] > s.scores[1] {
                Some(1)
            } else if s.scores[1] > s.scores[0] {
                Some(2)
            } else {
                None  // draw
            };
            events.push(GameEvent::RoundOver { winner });
        }

        events
    }

    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<DanceState>()
            .expect("dance plugin: state type mismatch");
        s.scores = [0.0; 2];
        s.beats_scored = 0;
        s.target_index = 0;
        s.round_started = false;
        s.round_ended = false;
        // round_start_tick is reset via round_started = false
    }

    fn max_wins(&self) -> u32 { self.config.max_wins }

    // on_calibration_complete: intentional no-op (D-05)
    // on_player_join/leave: use default no-ops (inherited from trait)
}
```

### Cosine Similarity Scoring

```rust
fn score_pose(player_frame: &PoseFrame, target: &[PoseKeypoint]) -> f64 {
    if player_frame.keypoints.len() < target.len() { return 0.0; }
    let mut dot = 0.0_f64;
    let mut pm = 0.0_f64;
    let mut tm = 0.0_f64;
    let mut n = 0usize;
    for (p, t) in player_frame.keypoints.iter().zip(target.iter()) {
        if p.visibility < 0.5 { continue; }
        dot += p.x*t.x + p.y*t.y;  // z omitted: near-zero for 2D MediaPipe
        pm  += p.x*p.x + p.y*p.y;
        tm  += t.x*t.x + t.y*t.y;
        n   += 1;
    }
    if n < 5 || pm < 1e-9 || tm < 1e-9 { return 0.0; }
    (dot / (pm.sqrt() * tm.sqrt())).clamp(0.0, 1.0)
}
```

### Axum Routes for Phase 3

```rust
// Source: engine-core/src/main.rs — extends existing router
let app = Router::new()
    .route("/", get(lobby_html))
    .route("/rooms", post(create_room))
    .route("/ws/player/{room_code}", get(ws_player))
    .route("/ws/spectator/{room_code}", get(ws_spectator))
    .nest_service("/mobile", ServeDir::new("mobile/dist"))
    .nest_service("/overlay", ServeDir::new("overlay/dist"))
    .with_state(state);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `AppState.plugin` (single plugin) | `AppState.plugins` (HashMap registry) | Phase 3 | Multiple game types selectable per room |
| Room created on WS connect (implicit) | Room created via `POST /rooms?game=X` (explicit) | Phase 3 | Game type determined before players join |
| No HTTP room creation endpoint | `POST /rooms` with JSON response | Phase 3 | Lobby UI can create rooms without WS |

**Deprecated/outdated:**
- `AppState.plugin` field: replaced by `AppState.plugins` HashMap. The single-plugin `app.plugin` field in `ws_player` handler must be updated to look up from the registry using the room's selected plugin. The simplest approach: rooms already store their own plugin via `RoomState.plugin`, so the WS player handler path (which calls `app.rooms.create_room(code, app.plugin)`) must be updated to use the registry or removed in favor of requiring explicit room creation via POST first.

---

## Integration Point: ws_player Room Creation

**Critical finding:** The existing `ws_player` handler in `main.rs` still creates rooms on-demand with `app.rooms.create_room(room_code, Arc::clone(&app.plugin))`. In Phase 3, `app.plugin` no longer exists. Two options:

**Option A (Recommended):** Rooms can only be created via `POST /rooms`. Remove the on-demand room creation from `ws_player`. If a player joins a room code that doesn't exist, return an error (close the WS). This enforces the new flow: lobby creates room → player joins via room code.

**Option B:** Keep on-demand room creation in `ws_player` but default to "boxing" if the room doesn't exist yet. This preserves backward compat but couples the WS handler to a default game choice.

CONTEXT.md D-07 states: "Mobile client joins via room code through the existing WebSocket endpoint — no TypeScript changes required." This is compatible with Option A as long as the mobile client has a room code before connecting. The static lobby provides that room code.

`[VERIFIED: main.rs handle_player — app.rooms.create_room(room_code.clone(), Arc::clone(&app.plugin)) at line ~120]`

---

## Environment Availability

Phase 3 is purely code changes to the existing Rust workspace — no new external tools, services, runtimes, or CLI utilities beyond those already in use.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | cargo build | Assumed available (Phase 2 completed) | confirmed by Phase 2 completion | — |
| cargo workspace | dance-plugin crate | ✓ | engine/Cargo.toml workspace | — |

No missing dependencies.

---

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — this section is omitted per config.

---

## Security Domain

This phase adds a `POST /rooms` HTTP endpoint. The threat surface is minimal:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Deserializing `game` param via `serde` with `Option<String>`; unknown values return 400 |
| V4 Access Control | no | No auth model; 6-char room codes unchanged |

**Known threat pattern:** A client can call `POST /rooms` rapidly to create many rooms. Mitigation is out of scope for this project per REQUIREMENTS.md Out-of-Scope (no rate limiting, no auth). Existing room expiry task (10-minute TTL after last disconnect) bounds room accumulation.

`[VERIFIED: room_manager.rs expiry_task — rooms expire after 10 min post-disconnect]`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cosine similarity is the chosen pose scoring metric | Code Examples | Low — CONTEXT.md explicitly leaves this to discretion; planner can substitute Euclidean distance with no architectural change |
| A2 | Option A (POST-only room creation) is preferred for ws_player handler | Integration Point section | Medium — if mobile clients sometimes connect directly without a lobby, on-demand creation must remain; planner should confirm with user |
| A3 | 6 target poses is sufficient for the pose library | Pattern 7 | Low — count is discretionary; changing it only affects the `poses.rs` array size |
| A4 | `z` coordinate omitted from cosine similarity (2D only) | Code Examples | Low — MediaPipe z is near-zero for 2D estimation; including it would not change scores materially |

---

## Open Questions

1. **ws_player on-demand room creation**
   - What we know: `ws_player` currently creates rooms with the hardcoded boxing plugin if no room exists
   - What's unclear: Should Phase 3 remove this fallback path, or keep it as "default boxing"?
   - Recommendation: Planner should decide; if mobile app can always obtain a room code from the lobby, remove it (Option A). If there's a legacy direct-join flow, keep boxing as default (Option B). CONTEXT.md D-07 implies Option A is correct.

2. **`MsgGameState.hp` field during dance rounds**
   - What we know: `game_loop.rs` broadcasts `MsgGameState` with `hp: (state.hp[0], state.hp[1])` on every tick. For dance rooms, HP is meaningless (always 800/800 since no hit events are emitted).
   - What's unclear: Should the overlay (which reads hp from game_state) show 800/800 during dance, or should the field be contextually ignored?
   - Recommendation: 800/800 is harmless; overlay decides what to display. No engine change needed. The dance plugin simply never emits `GameEvent::Hit`, so HP stays at the initial value.

---

## Sources

### Primary (HIGH confidence)
- `engine/plugin-trait/src/lib.rs` — Full `GamePlugin` trait, all method signatures, `GameEvent` variants, `TickContext`, `PoseKeypoint`, `RoomView`, `TickInfo` — directly verified
- `engine/boxing-plugin/src/lib.rs` — `BoxingPlugin` impl pattern, `BoxingState` structure, `downcast_mut` pattern, `on_round_reset` scope rules — directly verified
- `engine/boxing-plugin/src/bot.rs` — `BOT_KPS` 33-landmark array pattern for target poses (coordinate system WARNING: raw MediaPipe, not Y-up) — directly verified
- `engine/boxing-plugin/src/hit_detection.rs` — landmark index constants (WRIST, ANKLE, HIP, SHOULDER), `PoseFrame`/`PoseKeypoint` usage pattern — directly verified
- `engine/engine-core/src/main.rs` — Current `AppState.plugin`, `create_room` call, router structure — directly verified
- `engine/engine-core/src/room_manager.rs` — `create_room(code, plugin)` signature — directly verified
- `engine/engine-core/src/game_loop.rs` — `tick += 1` increment, `normalize_to_y_up` (Y-up coordinate system confirmation), `dispatch_events` patterns — directly verified
- `engine/engine-core/src/room.rs` — `RoomState.plugin`, `plugin_state`, `solo_mode` flag — directly verified
- `engine/Cargo.toml` — Workspace members, resolver=2 — directly verified
- `engine/engine-core/Cargo.toml` — axum 0.8.9, serde 1.0.228 — directly verified
- `.planning/phases/03-second-game-sdk/03-CONTEXT.md` — All locked decisions D-01..D-12 — directly verified

### Secondary (MEDIUM confidence)
- Axum 0.8.x `Query<T>` extractor and `axum::response::Html` — confirmed via Cargo.lock version 0.8.9; patterns consistent with Axum documentation

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Dance plugin implementation: HIGH — the existing trait surface exactly covers all needed capabilities; patterns are directly derivable from boxing plugin source
- Plugin registry and HTTP endpoint: HIGH — Axum 0.8.9 patterns verified; `create_room` signature already correct
- SDK documentation structure: HIGH — locked by CONTEXT.md D-10..D-12
- Pose similarity scoring: MEDIUM — algorithm is Claude's discretion; cosine similarity is a reasonable standard choice but not locked
- Target pose library coordinates: HIGH — Y-up system fully verified from game_loop.rs; pitfall documented

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (stable Rust crates; no external API dependencies)
