# Stack Research

**Domain:** Real-time WebSocket game server — Rust rewrite of Python/FastAPI
**Researched:** 2026-05-01
**Confidence:** HIGH (all versions verified against crates.io; rationale verified against official docs and Context7)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| axum | 0.8.9 | HTTP routing, WebSocket upgrade, static file serving | First-party Tokio ecosystem framework. WebSocket support is built-in via `axum::extract::ws` (backed by tokio-tungstenite 0.29 as a private dep, so axum absorbs future tungstenite breaking changes without your API changing). Tower middleware composability. No macro-based routing — routes are plain Rust. Minimum Rust 1.80. |
| tokio | 1.52.1 | Async runtime, timers, channels, task spawning | The runtime everything else runs on. `tokio::time::interval` drives the 60Hz game loop. `tokio::sync::broadcast` drives spectator fan-out. `tokio::spawn` gives each WebSocket connection its own task. Multi-threaded scheduler exploits all CPU cores — unlike Python's single-threaded asyncio GIL. |
| serde | 1.0.228 | Derive `Serialize`/`Deserialize` on all wire structs | The zero-cost derive macro. No runtime reflection — all serialization code generated at compile time. Pair `#[serde(rename_all = "snake_case")]` on every struct to match the existing Python/TypeScript protocol's field naming exactly. |
| serde_json | 1.0.149 | JSON wire serialization for all WebSocket messages | The canonical serde backend for JSON. `serde_json::to_string()` replaces `model.model_dump_json()`. Tagged enum dispatch (`#[serde(tag = "type")]`) maps directly to the existing Pydantic discriminator field `type`. |
| tower-http | 0.6.8 | Static file serving (`ServeDir`), CORS | `ServeDir::new("mobile/dist").not_found_service(ServeFile::new("mobile/dist/index.html"))` replaces FastAPI's `mount`. The `fs` feature must be enabled. Composes as Tower middleware on the axum Router. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tokio (features: full) | 1.52.1 | Enables all Tokio primitives: `sync`, `time`, `fs`, `io` | Always — use `tokio = { version = "1", features = ["full"] }` in Cargo.toml for a server binary |
| reqwest | 0.13.3 | Async HTTP client for Claude API and ElevenLabs TTS | Commentary path only — one `reqwest::Client` (cloneable `Arc` internally) shared across all rooms. Use `.json()` for Claude, `.bytes_stream()` for ElevenLabs streaming audio chunks. Enable feature `stream` for `Response::bytes_stream()`. |
| tracing | 0.1.44 | Structured per-span logging | Replaces Python `logging.getLogger(__name__)`. Decorate each WebSocket task with `#[tracing::instrument]` to get room_code/slot automatically in all log lines. |
| tracing-subscriber | 0.3.23 | Formats and emits tracing events to stdout | Use `tracing_subscriber::fmt::init()` in `main`. Replace with JSON format for production log aggregation later if needed. |
| thiserror | 2.0.18 | Derive `Error` + `Display` for domain error enums | Define a `GameError` enum and a `ProtocolError` enum. Avoids `Box<dyn Error>` in game-domain code where caller needs to match on variants. |
| dotenvy | 0.15.7 | Load `.env` at startup | Replaces `python-dotenv`. Actively maintained fork of unmaintained `dotenv` crate. One call: `dotenvy::dotenv().ok();` in `main`. |
| dashmap | 6.1.0 | Concurrent `HashMap<RoomCode, Arc<RoomState>>` | Room registry replacing Python's `dict`-backed `RoomManager`. Lock-free reads by shard. Critical: never hold a `DashMap` entry ref across an `.await` — take the `Arc<RoomState>` out of the entry and drop the ref before awaiting. |
| uuid | 1.23.1 | Generate 6-char room codes (or standard UUIDs internally) | Generate internal correlation IDs. Room codes remain `random::choices` equivalent — use `rand` for that, not UUID. |
| rand | 0.9.x | Random 6-char room code generation | Direct replacement for Python `random.choices`. Use `rand::distributions::Alphanumeric` sampled from `thread_rng`. |
| base64 | 0.22.1 | Encode ElevenLabs MP3 chunks as base64 for `commentary_audio` wire message | Commentary path only — `base64::engine::general_purpose::STANDARD.encode(bytes)` produces the `audio_b64` field value. |
| qrcode | 0.14.1 | Generate QR code PNG bytes for the lobby HTML endpoint | Replaces Python `qrcode + Pillow`. Renders to `image::DynamicImage`, then PNG bytes via `image` crate, then base64 for the `<img>` data URI. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| cargo-watch | Auto-recompile on save during dev | `cargo watch -x run` — equivalent to uvicorn's `--reload` |
| cargo-nextest | Faster parallel test runner | Drop-in for `cargo test`; produces better output for async test failures |
| Rust 1.80+ | Minimum compiler version | Required by axum 0.8. Use `rust-toolchain.toml` to pin the edition. |

---

## Installation

```toml
# Cargo.toml [dependencies]
axum        = { version = "0.8", features = ["ws", "macros"] }
tokio       = { version = "1",   features = ["full"] }
serde       = { version = "1",   features = ["derive"] }
serde_json  = "1"
tower-http  = { version = "0.6", features = ["fs", "cors"] }
reqwest     = { version = "0.13", features = ["json", "stream"] }
tracing     = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
thiserror   = "2"
dotenvy     = "0.15"
dashmap     = "6"
rand        = "0.9"
base64      = "0.22"
qrcode      = { version = "0.14", features = ["image"] }
image       = "0.25"
```

---

## Wire Protocol Mapping

The existing TypeScript protocol uses internally-tagged JSON: every message has a `"type"` string discriminator field alongside its other fields (e.g., `{"type":"pose_frame","timestamp":1.0,"keypoints":[...]}}`).

Map this directly in Rust with:

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerToOverlay {
    GameState(MsgGameState),
    PoseUpdate(MsgPoseUpdate),
    RoundStart(MsgRoundStart),
    // ...
}
```

The `#[serde(tag = "type")]` attribute makes serde emit/consume the `type` field as the discriminator, exactly matching the existing Pydantic `Literal["game_state"]` discriminator. All field names use `snake_case` already — no per-field `rename` needed provided `rename_all = "snake_case"` is applied at struct level.

**Critical constraint:** The `poses` field in `MsgGameState` must serialize as an empty two-element array `[[], []]` when no pose data is present (the Python server sends `_EMPTY_POSES = ([], [])` deliberately — overlay reads it and skips draw). Represent this in Rust as `poses: (Vec<PoseKeypoint>, Vec<PoseKeypoint>)` with default empty vecs.

---

## Game Loop Pattern

```rust
// One tokio::task per room
let mut interval = tokio::time::interval(Duration::from_millis(16)); // ~60Hz
interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

loop {
    interval.tick().await;
    // drain input buffers, run hit detection, broadcast game_state
}
```

Use `MissedTickBehavior::Skip` (not the default `Burst`). The default `Burst` fires missed ticks as fast as possible to "catch up" — under CPU load this causes a flood of game_state broadcasts. `Skip` drops a frame and waits for the next aligned tick, preserving consistent inter-tick spacing.

---

## Spectator Fan-Out Pattern

```rust
// Per-room: created when the room is initialized
let (tx, _rx) = tokio::sync::broadcast::channel::<Arc<String>>(64);

// Game loop: broadcast serialized game_state JSON
let json = Arc::new(serde_json::to_string(&msg)?);
let _ = tx.send(json); // ok if zero subscribers

// Each spectator WebSocket task:
let mut rx = room.broadcast_tx.subscribe();
loop {
    tokio::select! {
        msg = rx.recv() => {
            match msg {
                Ok(json) => { ws.send(Message::Text(json.as_str().into())).await?; }
                Err(RecvError::Lagged(n)) => { /* log n dropped frames, continue */ }
                Err(RecvError::Closed) => break,
            }
        }
        Some(incoming) = ws.recv() => { /* spectators send nothing; drain and discard */ }
    }
}
```

Key point: broadcast sends `Arc<String>` not `String` — cloning the Arc is O(1) regardless of how many spectators there are. Handle `RecvError::Lagged` explicitly; a slow spectator should log and continue, not crash the task.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| axum 0.8 built-in WebSocket (`axum::extract::ws`) | tokio-tungstenite standalone | Only if building a pure WebSocket server with no HTTP routing or middleware needs — standalone server with no REST endpoints, no static file serving |
| axum 0.8 built-in WebSocket | `axum-tungstenite` crate | Never — `axum-tungstenite` exposes tungstenite types in its public API, meaning it tracks tungstenite major versions as its own major versions, creating unnecessary churn |
| `tokio::sync::broadcast` for spectators | `mpsc` + fan-out dispatcher | Only if you need guaranteed delivery to slow spectators and are willing to add back-pressure logic; broadcast is correct for this use case because spectators can tolerate dropped frames |
| `dashmap` for room registry | `Arc<RwLock<HashMap<...>>>` | Small number of rooms and/or low contention — `RwLock` is simpler to reason about; `dashmap` wins at high room counts due to sharding |
| `reqwest` for HTTP (Claude + ElevenLabs) | `hyper` directly | Only if you need absolute minimal dependency tree and are willing to write raw HTTP client code |
| `async-anthropic` or raw `reqwest` for Claude | Official Anthropic Rust SDK | There is no official Anthropic Rust SDK as of 2026. `async-anthropic` (0.6.0, last updated May 2025) is the best community option; alternatively use raw `reqwest` against the Messages API — that keeps the dependency count low and the API is simple enough |
| `serde_json` | `rmp-serde` (MessagePack) | Only if profiling shows JSON serialization is a bottleneck — binary protocol requires client changes; wire compatibility with TypeScript clients would be broken |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `actix-web` | Competing ecosystem — different runtime actor model, `tower` middleware does not compose, community momentum has shifted to axum | `axum` |
| `warp` | Unmaintained since 2022; filter-based API is unusually hard to extend; no active development | `axum` |
| `tokio-tungstenite` directly alongside `axum` | Axum 0.8's `ws` feature already depends on tokio-tungstenite 0.29 internally; adding tokio-tungstenite to your own Cargo.toml risks a version mismatch that causes two incompatible tungstenite versions in the dependency tree | Use only `axum::extract::ws` |
| Default `MissedTickBehavior::Burst` for the game interval | Under any CPU load, burst will attempt to fire multiple 60Hz ticks as fast as possible to catch up, causing a flood of game_state broadcasts to spectators and making frame timing erratic | `interval.set_missed_tick_behavior(MissedTickBehavior::Skip)` |
| `tokio::sync::Mutex` held across `.await` points (in WebSocket task inner loops) | Legal but impairs scheduler throughput — other tasks on the same thread cannot progress while the mutex is held across an await | Prefer `Arc<DashMap>` for room state; use short-locked `std::sync::Mutex` for pure in-memory state that doesn't need to be awaited |
| `dotenv` crate (original) | Unmaintained since 2020; last release is 0.15.0 which has an incorrect error type | `dotenvy` (actively maintained fork, identical API) |
| `anyhow` as the primary error type for game domain code | `anyhow::Error` is opaque — callers cannot match on variants; fine for application glue code but wrong for `GameLoop` internals where you need to dispatch on hit type or protocol error | `thiserror` for domain error enums; `anyhow` is acceptable in `main.rs` startup code only |
| `bevy_ecs` or `hecs` | Full ECS adds significant complexity for a single-game use case; this project's game plugin trait is a custom abstraction already serving as the "system" boundary | Plain Rust structs + the `GamePlugin` trait |

---

## Version Compatibility Notes

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| axum 0.8.9 | tokio 1.x, tower 0.5.x, tower-http 0.6.x | axum 0.8 requires tower 0.5 — do not mix tower 0.4 |
| tower-http 0.6.8 | tower 0.5.x | tower-http and tower must be same major series |
| reqwest 0.13.3 | tokio 1.x, rustls or native-tls | Choose one TLS backend; default is `rustls-tls`; use `default-features = false, features = ["rustls-tls", "json", "stream"]` for reproducible builds |
| tracing-subscriber 0.3.23 | tracing 0.1.x | Same minor family; both are 0.x pre-1.0 but have been stable in practice for years |
| serde 1.0.228 | serde_json 1.0.149 | Always use matching minor series from same release period |
| dashmap 6.1.0 | stable only (rc2 of v7 exists but is pre-release as of 2026-05-01) | Pin to `"6"` not `"*"` |

---

## Sources

- crates.io REST API — version numbers for axum (0.8.9), tokio (1.52.1), serde (1.0.228), serde_json (1.0.149), reqwest (0.13.3), tower (0.5.3), tower-http (0.6.8), tracing (0.1.44), tracing-subscriber (0.3.23), thiserror (2.0.18), dotenvy (0.15.7), dashmap (6.1.0), uuid (1.23.1), base64 (0.22.1), qrcode (0.14.1) — HIGH confidence (direct API query, 2026-05-01)
- Context7 `/websites/rs_axum_0_8_8_axum` — axum WebSocket upgrade API, `State` extractor pattern, static serving via `nest_service` — HIGH confidence
- Context7 `/websites/rs_tokio_1_49_0` — `broadcast::channel`, `MissedTickBehavior`, `tokio::sync` primitives — HIGH confidence
- Context7 `/serde-rs/serde` — `#[serde(tag = "type")]`, `rename_all = "snake_case"`, field attributes — HIGH confidence
- Context7 `/websites/rs_reqwest_0_13_2_reqwest` — `.json()`, `.bytes_stream()` patterns — HIGH confidence
- https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0 — axum 0.8 release notes, path syntax change, removal of `#[async_trait]` — HIGH confidence
- https://serde.rs/enum-representations.html — internally tagged enum representations — HIGH confidence
- https://docs.rs/axum/latest/axum/extract/ws/index.html — confirms axum uses tokio-tungstenite as private dep, WebSocket split() pattern — HIGH confidence
- WebSearch: async-anthropic crate (0.6.0) — MEDIUM confidence (community crate, verify activity before adopting)

---

*Stack research for: PoseEngine — Rust real-time WebSocket game server*
*Researched: 2026-05-01*
