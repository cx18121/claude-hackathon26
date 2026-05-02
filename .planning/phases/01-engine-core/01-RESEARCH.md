# Phase 1: Engine Core - Research

**Researched:** 2026-05-02
**Domain:** Rust / Axum + Tokio WebSocket server — port of Python FastAPI game server
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Cargo workspace at `engine/` (repo root). Root `Cargo.toml` declares `[workspace]` with `engine-core` as the first member. Phase 2 will add `plugin-trait` and `boxing-plugin` as additional workspace members.
- **D-02:** Python server stays at `server/` until Phase 1 cutover is complete — both can run independently during development. Dockerfile switches to the Rust binary at end of Phase 1.
- **D-03:** `engine/engine-core/src/` uses responsibility-mapped modules: `main.rs`, `protocol.rs`, `room.rs`, `room_manager.rs`, `input_delay.rs`, `broadcast.rs`, `game_loop.rs`.
- **D-04:** Rust serde models are the new source of truth for the wire protocol. `shared/protocol.ts` is generated from Rust using **ts-rs** (`#[derive(TS)]` macro). `gen_protocol.py` is replaced. Running `cargo test` exports TypeScript bindings.
- **D-05:** Golden-file JSON fixtures for PROTO-02 roundtrip tests are captured by running the Python server and recording real message instances via `scripts/capture_fixtures.py`. Fixtures stored at `engine/engine-core/tests/fixtures/*.json`.
- **D-06:** Commentary (COMM-01..04) is Phase 2 scope. The Phase 1 Rust server never sends `commentary_text` or `commentary_audio` messages.
- **D-07:** `GameEvent` enum defined in Phase 1 for all internal game loop events; commentary-related variants deferred to Phase 2.
- **D-08:** Room expiry: background Tokio task scans DashMap every 60 seconds; removes rooms where `match_over == true` AND all player WebSocket handles have been `None` for more than 10 minutes.

### Claude's Discretion

- Internal error handling strategy within the WebSocket path (log-and-continue pattern from Python is a reasonable default to port)
- Exact Cargo dependency versions (axum, tokio, dashmap, serde, ts-rs, etc.)
- Whether `game_loop.rs` placeholder runs a trivial no-op tick or a minimal warmup counter

### Deferred Ideas (OUT OF SCOPE)

- Commentary path (COMM-01..04) — Claude API + ElevenLabs TTS
- `CommentaryHint` GameEvent variant
- Horizontal scaling / room sharding
- Reference velocity validation / clamping (security concern from CONCERNS.md)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENG-01 | WebSocket server exposes `/ws/player/{room_code}` and `/ws/spectator/{room_code}` endpoints using Axum + Tokio | Axum `WebSocketUpgrade` extractor; `ws` feature flag required |
| ENG-02 | Room registry uses DashMap with 6-char alphanumeric code generation; rooms created on demand | DashMap 6.1.0; thread-safe concurrent map; rand for code gen |
| ENG-03 | Each room runs as an independent Tokio task (actor model) exclusively owning all per-room state; no cross-room shared mutexes | `tokio::spawn` + `mpsc` channel into room actor; actor owns all state |
| ENG-04 | 60Hz game loop driven by `tokio::time::interval` with `MissedTickBehavior::Skip` inside the room actor's `select!` loop | Tokio `interval` + `MissedTickBehavior::Skip` verified in docs |
| ENG-05 | Each player connection has a dedicated outbound Tokio task with a bounded `mpsc` channel; game loop never calls `ws.send().await` directly | `tokio::sync::mpsc::channel(32)` pattern; split WebSocket into sink/stream |
| ENG-06 | RTT input delay buffer ported from Python `input_delay.py` | Straight port: median RTT, `compute_cutoff`, 60ms max cap |
| ENG-07 | Pose data fan-out: `MsgPoseUpdate` broadcast to spectators immediately on frame arrival, independent of game loop tick rate | Axum WS handler sends directly to spectator broadcast channel on pose_frame receipt |
| ENG-08 | Two broadcast channels per room — fast path for pose updates, slow path for game state and lifecycle events | `tokio::sync::broadcast::channel` — one per path |
| ENG-09 | 3.8-second warmup window zeroes input buffer; plugin receives empty frame slices during warmup | Timer + warmup gate in room actor `select!`; clears buffers |
| ENG-10 | Round lifecycle managed by engine: on `RoundOver` event from plugin, engine broadcasts `MsgRoundEnd`, increments win counter, calls `on_round_reset` | Port of Python `game_loop.py` round transition logic; Phase 1 has no plugin yet |
| ENG-11 | Calibration handshake: engine calls `on_calibration_complete` after both players submit; game loop starts once both are calibrated | Port of Python calibration flow in main.py |
| ENG-12 | Static file serving of `mobile/dist` at `/mobile` and `overlay/dist` at `/overlay` | `tower_http::services::ServeDir` via `nest_service` |
| ENG-13 | Joinable Tokio task handles tracked with abort-on-drop guarantee; no zombie game loop tasks after room teardown | Store `JoinHandle` on `RoomState`; call `.abort()` on teardown |
| PROTO-01 | All wire message types modelled in Rust with `serde_json` using `#[serde(tag = "type")]`; field names match `shared/protocol.ts` exactly | `serde` + `serde_json`; `#[serde(tag = "type")]` for internally-tagged enums |
| PROTO-02 | Golden-file roundtrip tests: each message type serialized in Rust and compared to reference JSON fixtures | Standard Rust `#[test]`; `serde_json::from_str` against fixture files |
| PROTO-03 | `shared/protocol.ts` kept in sync with Rust models; generation script updated or replaced | `ts-rs` 12.0.1 with `#[derive(TS)] #[ts(export)]`; `TS_RS_EXPORT_DIR` env var |
| FIX-02 | Spectator reconnect state restoration — send snapshot of current HP, wins, round number, and elapsed time before entering live broadcast stream | New snapshot message sent in `/ws/spectator/{room_code}` handler after `add_spectator` |
</phase_requirements>

---

## Summary

Phase 1 is a faithful port of the Python FastAPI game server to Rust using Axum + Tokio. The Rust implementation must preserve byte-for-byte JSON wire compatibility with `shared/protocol.ts` so that existing TypeScript clients (mobile, overlay) are completely untouched. The room-actor concurrency model replaces Python's asyncio single-threaded loop: each room becomes an independent Tokio task that exclusively owns all per-room mutable state, eliminating the need for any mutexes across rooms.

The spectator snapshot bug (FIX-02) is the primary correctness fix. The Python server sends no state on spectator join, causing the overlay's local win counter to desync after any reconnect. The Rust implementation adds a snapshot send immediately on spectator WebSocket accept, before subscribing to the broadcast stream. This requires either a new protocol message or enriching the existing join flow — since `shared/protocol.ts` must remain unchanged on the client side, the most compatible approach is a `MsgLobbyUpdate`-style initial message with full state, or composing the existing messages (`round_start`, `game_state`) in the correct order on connect.

The primary complexity risks in this phase are: (1) the actor message routing design — getting the `select!` loop, `mpsc` sender clones, and `broadcast` subscriber lifetime all correct; (2) `ts-rs` enum handling for internally-tagged serde variants; and (3) the Dockerfile multi-stage Rust build stage integration without breaking the existing overlay/mobile build stages.

**Primary recommendation:** Follow the room-actor pattern strictly: one `tokio::spawn` per room, a command `mpsc` channel into the actor for all external messages (pose frames, calibration, disconnect), and a `broadcast` channel out for game state. The WebSocket handlers are thin — they extract messages, send to the actor channel, and forward from the player-specific `mpsc` sender back over the WebSocket. Never let a WebSocket handler touch room state directly.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebSocket accept / upgrade | API / Backend (Axum handler) | — | Axum `WebSocketUpgrade` is the Rust-idiomatic entry point |
| Room state ownership | Room Actor (Tokio task) | — | Actor model: all per-room state lives exclusively in the actor |
| Pose fan-out to spectators | API / Backend (WS handler) | Room Actor (for game_state) | pose_update bypasses the game loop for low latency (ENG-07) |
| 60Hz game tick | Room Actor (Tokio task) | — | Loop runs inside the actor's `select!` on the interval arm |
| RTT fairness cutoff | Room Actor (input_delay.rs) | — | Computed inside the actor tick from stored RTT samples |
| Static file serving | CDN / Static (tower-http) | — | `ServeDir` at `/mobile` and `/overlay` — no business logic |
| Protocol serialization | API / Backend (protocol.rs) | — | All serde models live in protocol.rs; no client-side logic |
| TypeScript binding gen | Build (ts-rs, cargo test) | — | Runs at build time, not runtime |
| Room registry | API / Backend (room_manager.rs) | — | DashMap accessed from handler threads; actor owns deep state |
| Spectator snapshot (FIX-02) | API / Backend (WS handler) | Room Actor (read) | Handler reads current state snapshot from actor via one-shot channel |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axum | 0.8.9 | HTTP + WebSocket server framework | Tokio-native, tower middleware composability, explicit project choice |
| tokio | 1.52.1 | Async runtime, timers, channels, tasks | Axum requires Tokio; full features needed (time, sync, rt-multi-thread) |
| serde | 1.0.228 | Serialization framework | Universal Rust serde ecosystem standard |
| serde_json | 1.0.149 | JSON encode/decode | Wire format is JSON per protocol.ts |
| dashmap | 6.1.0 | Concurrent hashmap for room registry | Lock-free reads under concurrent WS handlers; documented project choice |
| tower-http | 0.6.8 | Static file serving, middleware | ServeDir for `/mobile` and `/overlay`; part of axum's tower ecosystem |
| ts-rs | 12.0.1 | Generate TypeScript bindings from Rust types | Replaces gen_protocol.py per D-04; `serde-compat` feature respects serde attrs |
| tracing | 0.1.44 | Structured logging | Rust async logging standard; replaces Python's `logging` module |
| tracing-subscriber | 0.3.23 | Log output formatting | Required to configure tracing output |

**Note on ts-rs version:** Context7 listed 12.0.1 as current (crates.io verified). The CONTEXT.md `specifics` section mentions ts-rs version 10, but the current stable release is 12.0.1. The API (derive macro, `#[ts(export)]`) is unchanged between 10 and 12. Use 12.0.1. [VERIFIED: crates.io API]

**Note on dashmap version:** The crates.io API returned 7.0.0-rc2 as the newest version, but 6.1.0 is the current stable release (not yanked, confirmed). Use 6.1.0. [VERIFIED: crates.io API]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| rand | 0.8.6 | Room code generation | 6-char alphanumeric code via `rand::distributions::Alphanumeric` |
| futures-util | (workspace dep via axum) | SinkExt/StreamExt for WebSocket split | Required when splitting WebSocket into separate send/recv halves |
| tokio-tungstenite | 0.29.0 | (Optional) lower-level WS | Not needed — axum's built-in `axum::extract::ws` is sufficient |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| axum | actix-web | Actix has higher raw throughput but different concurrency model; Axum is the explicit project choice per PROJECT.md |
| dashmap | `Arc<RwLock<HashMap>>` | RwLock contention under many concurrent rooms; DashMap avoids this |
| ts-rs | Hand-maintain protocol.ts | ts-rs makes Rust the source of truth (D-04); eliminates drift |
| tokio broadcast | Custom Arc<Vec<Sender>> | Tokio broadcast handles backpressure and subscriber tracking natively |

**Installation:**
```bash
# From engine/ directory after creating workspace
cargo add axum --features ws
cargo add tokio --features full
cargo add serde --features derive
cargo add serde_json
cargo add dashmap
cargo add tower-http --features fs
cargo add ts-rs --features serde-compat
cargo add tracing
cargo add tracing-subscriber --features env-filter
cargo add rand
```

**Version verification:** Versions above were confirmed against the crates.io REST API (`/api/v1/crates/{name}`) on 2026-05-02. [VERIFIED: crates.io API]

---

## Architecture Patterns

### System Architecture Diagram

```
Mobile Client                      Overlay Client
   |  pose_frame, calibration_done    |  read-only
   |  ping/pong                       |
   v                                  v
[Axum WS Handler: /ws/player/{room}] [Axum WS Handler: /ws/spectator/{room}]
   |                                  |
   | RoomCmd::PoseFrame               | subscribe to broadcast_tx (slow path)
   | RoomCmd::CalibrationDone         | subscribe to pose_tx (fast path)
   | RoomCmd::Disconnect              |
   v                                  |
[Room Actor Task (tokio::spawn)]      |
   |  owns: RoomState, buffers,       |
   |  game loop interval,             |
   |  hp, round_number, wins          |
   |                                  |
   |--pose_tx (broadcast) ----------->|  (immediate, on each pose_frame)
   |--broadcast_tx (broadcast) ------>|  (game_state, round_start, round_end, etc.)
   |
   |--player_1_tx (mpsc) -----------> [PlayerOutbound Task 1]
   |--player_2_tx (mpsc) -----------> [PlayerOutbound Task 2]
                                          |
                                          v
                                       WebSocket.send()

[Room Manager: DashMap<code, RoomHandle>]
   room_handle = { cmd_tx, join_handle }
   Accessed from WS handlers via Arc<RoomManager>

[Room Expiry Task (tokio::spawn)]
   Scans DashMap every 60s, removes expired rooms
```

**Data flow — pose frame:**
1. Mobile WS handler receives `pose_frame` text message
2. Handler deserializes to `MsgPoseFrame`
3. Handler calls `pose_tx.send(MsgPoseUpdate{...})` — spectators receive immediately
4. Handler sends `RoomCmd::PoseFrame(slot, frame, timestamp)` to room actor via `cmd_tx`
5. Room actor buffers frame in `VecDeque` with arrival timestamp
6. On 60Hz tick: actor drains frames past RTT cutoff into processed deque, runs game logic

**Data flow — spectator connect:**
1. WS handler accepts connection
2. Handler reads current snapshot from room actor via one-shot channel (FIX-02)
3. Handler sends snapshot messages over WebSocket before subscribing to broadcast
4. Handler subscribes to both `broadcast_tx` and `pose_tx`
5. Handler forwards all received broadcast messages to WebSocket

### Recommended Project Structure

```
engine/
├── Cargo.toml              # [workspace] members = ["engine-core"]
└── engine-core/
    ├── Cargo.toml          # package + dependencies
    ├── src/
    │   ├── main.rs         # Axum router setup, server startup, static file serving
    │   ├── protocol.rs     # All serde models + ts-rs derives; wire contract
    │   ├── room.rs         # RoomState, PlayerSlot, room actor task, select! loop
    │   ├── room_manager.rs # DashMap registry, RoomHandle, room expiry background task
    │   ├── input_delay.rs  # RTT fairness: record_pong, median_rtt, compute_cutoff
    │   ├── broadcast.rs    # Fan-out helpers; spectator snapshot builder (FIX-02)
    │   └── game_loop.rs    # 60Hz tick logic, round lifecycle, warmup gate
    └── tests/
        ├── fixtures/       # Golden JSON files captured from Python server
        │   ├── msg_pose_frame.json
        │   ├── msg_game_state.json
        │   └── ...
        └── protocol_roundtrip.rs  # PROTO-02 golden-file tests
```

### Pattern 1: Room Actor via mpsc Command Channel

**What:** Each room is a Tokio task. External code (WS handlers) sends typed commands to the actor; the actor processes them sequentially inside a `select!` loop.

**When to use:** All per-room state mutations — pose frame arrival, calibration, disconnect, game tick.

**Example:**
```rust
// Source: https://docs.rs/tokio/latest/tokio/sync/mpsc/ (pattern)
enum RoomCmd {
    PoseFrame { slot: u8, frame: MsgPoseFrame, arrived_at: Instant },
    CalibrationDone { slot: u8, reference_velocity: f64 },
    PlayerDisconnect { slot: u8 },
    GetSnapshot { reply: oneshot::Sender<RoomSnapshot> },
}

async fn room_actor(mut cmd_rx: mpsc::Receiver<RoomCmd>, mut state: RoomState) {
    let mut tick = tokio::time::interval(Duration::from_millis(1000 / 60));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            Some(cmd) = cmd_rx.recv() => { handle_cmd(&mut state, cmd).await; }
            _ = tick.tick() => { game_tick(&mut state).await; }
        }
    }
}
```

### Pattern 2: Player Outbound via Bounded mpsc

**What:** Each connected player has a dedicated Tokio task that drains an `mpsc::Receiver` and calls `ws_sink.send()`. The game loop sends to the player's `mpsc::Sender` — it never awaits a WebSocket send directly.

**When to use:** All server-to-player message sends from the game loop or room actor.

**Example:**
```rust
// Source: pattern from ENG-05 requirement
let (player_tx, mut player_rx) = mpsc::channel::<String>(32);

tokio::spawn(async move {
    while let Some(msg) = player_rx.recv().await {
        if ws_sink.send(Message::Text(msg.into())).await.is_err() {
            break;
        }
    }
});
// game loop uses: player_tx.send(json_string).await
```

### Pattern 3: Two Broadcast Channels Per Room

**What:** Two `tokio::sync::broadcast` channels per room — one fast path for `MsgPoseUpdate`, one slow path for `MsgGameState` and lifecycle events. Spectator WS handler subscribes to both.

**When to use:** Spectator fan-out; keeps pose latency independent of game state tick rate.

**Example:**
```rust
// Source: https://docs.rs/tokio/latest/tokio/sync/broadcast/
use tokio::sync::broadcast;

let (pose_tx, _) = broadcast::channel::<String>(64);    // fast path
let (game_tx, _) = broadcast::channel::<String>(128);   // slow path

// In WS pose handler (not in game loop):
pose_tx.send(serde_json::to_string(&pose_update_msg)?)?;

// In game loop tick:
game_tx.send(serde_json::to_string(&game_state_msg)?)?;
```

### Pattern 4: Protocol Serde with ts-rs (PROTO-01, PROTO-03)

**What:** All wire messages are Rust structs/enums with `#[serde(tag = "type")]` for the discriminator. `#[derive(TS)]` + `#[ts(export)]` generates TypeScript during `cargo test`.

**When to use:** Every message type in `protocol.rs`.

**Example:**
```rust
// Source: https://context7.com/aleph-alpha/ts-rs/llms.txt + https://docs.rs/serde
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone)]
#[serde(tag = "type", rename = "joined")]
#[ts(export)]
pub struct MsgJoined {
    pub room_code: String,
    pub player_slot: u8,
    pub opponent_connected: bool,
}

// ts-rs with serde-compat feature reads #[serde(...)] attributes automatically
// TS_RS_EXPORT_DIR env var (default: ./bindings) controls output path
// cargo test writes: bindings/MsgJoined.ts
```

**Critical:** Use `serde-compat` feature on ts-rs so that `#[serde(rename = "type")]` field names propagate into TypeScript output. Without this, the discriminator field in TypeScript will not match `shared/protocol.ts`. [VERIFIED: https://context7.com/aleph-alpha/ts-rs/llms.txt]

### Pattern 5: FIX-02 Spectator Snapshot on Connect

**What:** On spectator WebSocket accept, before subscribing to the broadcast stream, send a point-in-time snapshot of the current room state. Uses a `oneshot::channel` to request the snapshot from the room actor.

**When to use:** `/ws/spectator/{room_code}` handler, immediately after accept.

**Example:**
```rust
// Request snapshot from room actor
let (reply_tx, reply_rx) = oneshot::channel();
cmd_tx.send(RoomCmd::GetSnapshot { reply: reply_tx }).await?;
let snapshot = reply_rx.await?;

// Send snapshot messages before subscribing to broadcast
ws.send(Message::Text(
    serde_json::to_string(&snapshot.lobby_update)?
)).await?;
if let Some(game_state) = snapshot.game_state {
    ws.send(Message::Text(serde_json::to_string(&game_state)?)).await?;
}

// Now subscribe to live broadcast
let mut game_rx = state.game_tx.subscribe();
```

### Anti-Patterns to Avoid

- **Shared mutable RoomState behind an `Arc<Mutex>`:** Puts per-room state under a single lock that all WS handlers and the game loop contend on. Use the actor model instead — state lives inside the actor task exclusively.
- **Calling `ws.send().await` from the game loop:** The game loop must not block on WebSocket backpressure. Send to the player's bounded `mpsc` channel instead (ENG-05). If the channel is full, the message is dropped (acceptable) and the player's task handles the actual write.
- **`MissedTickBehavior::Burst` (the default):** If the game loop falls behind, Burst fires catch-up ticks immediately, potentially flooding 10 ticks at once. `Skip` is the correct behavior for a real-time game loop (ENG-04).
- **Poses in `MsgGameState`:** The `poses` field in `MsgGameState` must always be sent as empty arrays (matching the Python server's `_EMPTY_POSES` pattern). Pose data travels via the fast-path `MsgPoseUpdate` channel. Including poses in `game_state` at 60Hz doubles spectator bandwidth needlessly.
- **Direct DashMap mutation from WS handlers:** After the room actor is spawned, all per-room state mutation goes through the command channel. WS handlers only read from the DashMap to find the room's `cmd_tx` handle.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrent hashmap for room registry | `Arc<RwLock<HashMap>>` | `dashmap::DashMap` | DashMap uses shard-level locking; RwLock has write-starvation under many readers |
| Spectator fan-out | Manual `Vec<Sender>` + lock | `tokio::sync::broadcast::channel` | Broadcast handles subscriber lifecycle, lag detection, and unsubscribe cleanly |
| JSON serialization | Manual string formatting | `serde_json` | Edge cases in float/null/unicode serialization will break wire compat |
| TypeScript type generation | Hand-maintained protocol.ts | `ts-rs` | ts-rs makes Rust the source of truth; generation is the only way to guarantee sync |
| 60Hz timer with skip | `tokio::time::sleep` in loop | `tokio::time::interval` + `MissedTickBehavior::Skip` | Sleep accumulates drift; interval tracks absolute time |
| WebSocket task lifecycle | Manual boolean flags + channels | `JoinHandle::abort()` | Abort is the canonical Tokio way to cancel a task on teardown (ENG-13) |
| Static file serving | Custom HTTP handler | `tower_http::services::ServeDir` | Handles mime types, ETags, range requests, and 404s correctly |

**Key insight:** The actor model eliminates the need for mutexes across rooms entirely. The hardest concurrency problem (shared mutable state) is solved by design — not by careful locking.

---

## Common Pitfalls

### Pitfall 1: ts-rs Internally Tagged Enum Mismatch

**What goes wrong:** The wire protocol uses `"type"` as the discriminator field on all messages (matching Python's `Literal["pose_frame"]` etc.). Using `#[ts(tag = "type")]` on a Rust *enum* generates externally-tagged TypeScript. Using `#[serde(tag = "type")]` on individual *structs* (one struct per message type, not a union enum) is what the protocol requires.

**Why it happens:** Developers assume a Rust enum maps naturally to a TypeScript discriminated union, but the Python protocol uses separate classes — each with a `type` literal field. The Rust equivalent is separate structs with a `"type"` literal field baked in via `#[serde(rename = "type")]` or `rename_all`.

**How to avoid:** Model each message as its own `struct` in `protocol.rs`. The union is only relevant for the inbound message parser (`InboundMobileMsg`), which can be an enum with `#[serde(tag = "type")]` at the enum level. For outbound messages, serialize each struct directly — no union enum needed.

**Warning signs:** TypeScript generated by ts-rs has a nested `{ type: { pose_frame: { ... } } }` shape instead of `{ type: "pose_frame", ... }`.

### Pitfall 2: Broadcast Channel Lag Error

**What goes wrong:** A slow spectator causes `broadcast::Receiver::recv()` to return `Err(RecvError::Lagged(n))`. If the handler panics or drops the connection silently, the symptom is a spectator that stops receiving updates with no error log.

**Why it happens:** Tokio broadcast channels are bounded; if a receiver doesn't keep up, it falls behind. `recv()` returns `Lagged` when the receiver has missed messages.

**How to avoid:** Handle `Err(RecvError::Lagged(_))` explicitly in the spectator WS handler loop — log the lag count, continue receiving (the receiver is automatically re-positioned at the oldest available message). Do not treat `Lagged` as fatal.

**Warning signs:** Spectator overlay freezes intermittently; no disconnect logged.

### Pitfall 3: WebSocket Sender Sent Across Select! Arms

**What goes wrong:** Axum's `WebSocket` cannot be split directly into `sink + stream` without `futures_util::StreamExt::split`. Attempting to hold a `&mut WebSocket` across an `await` in a `select!` arm while another arm also borrows it causes a borrow-checker error.

**Why it happens:** Both the recv arm and the send arm of `select!` need access to the socket simultaneously.

**How to avoid:** Use `futures_util::StreamExt::split(socket)` to get `(sink, stream)` before entering the `select!` loop. Or use the player outbound `mpsc` pattern (ENG-05) where a separate task owns the sink.

**Warning signs:** Borrow checker error: "cannot borrow `socket` as mutable more than once at a time".

### Pitfall 4: DashMap Deadlock via Entry API Inside Async

**What goes wrong:** Holding a DashMap entry guard across an `.await` point causes a deadlock because the guard holds a shard lock, but async tasks are not guaranteed to execute on the same thread.

**Why it happens:** DashMap entry guards implement `Deref` but are not `Send` across await points in Tokio's multi-threaded runtime.

**How to avoid:** Never hold a DashMap guard across `.await`. Clone the value out first, then drop the guard, then do the async work. For room creation: insert synchronously, return the code, then spawn the actor task after releasing the guard.

**Warning signs:** Server deadlocks under load; test that exercises concurrent room creates hangs.

### Pitfall 5: Dockerfile Rust Build Stage Linking on musl

**What goes wrong:** Adding a `cargo build --release` stage to the existing Dockerfile that uses `python:3.11-slim` (Debian glibc) as the final image compiles fine if the Rust binary is linked against glibc. But if the builder uses `rust:alpine` or cross-compiles to `x86_64-unknown-linux-musl`, the binary won't run in the glibc image.

**Why it happens:** Mismatch between libc used at compile time and runtime.

**How to avoid:** Use `rust:1.94-slim` (Debian-based) as the Rust build stage. Final image stays `python:3.11-slim` or switches to `debian:bookworm-slim` — both use glibc. Alternatively: use static linking with musl and `FROM scratch` or `FROM alpine` as final image. The simplest approach for this project is Debian-based Rust builder + Debian-based final image.

**Warning signs:** `exec format error` or `cannot execute binary file` when starting the container.

### Pitfall 6: FIX-02 Race Between Snapshot and Broadcast

**What goes wrong:** A spectator joins during the brief window between the actor sending the snapshot and the spectator subscribing to the broadcast channel. A `round_end` event can be broadcast during this window and the spectator misses it.

**Why it happens:** The snapshot read and the broadcast subscription are two separate steps.

**How to avoid:** Subscribe to the broadcast channel *before* requesting the snapshot. The snapshot arrives after the subscription is active, so any new events broadcast after the snapshot is sent will be received. The spectator may receive a duplicate `round_start` or `game_state` — this is acceptable and idempotent on the client.

**Warning signs:** Spectator occasionally shows stale win count even after FIX-02 is implemented.

---

## Code Examples

Verified patterns from official sources:

### Axum WebSocket Handler with Route Params

```rust
// Source: https://context7.com/tokio-rs/axum/llms.txt
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
};
use std::sync::Arc;

async fn ws_player(
    Path(room_code): Path<String>,
    State(app): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_player(socket, room_code, app))
}
```

### Tokio 60Hz Interval with MissedTickBehavior::Skip

```rust
// Source: https://docs.rs/tokio/latest/tokio/time/enum.MissedTickBehavior.html
use tokio::time::{interval, Duration, MissedTickBehavior};

let mut tick = interval(Duration::from_millis(1000 / 60));
tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

loop {
    tokio::select! {
        _ = tick.tick() => { /* game tick */ }
        Some(cmd) = cmd_rx.recv() => { /* handle command */ }
        else => break,
    }
}
```

### ts-rs Internally Tagged Struct

```rust
// Source: https://context7.com/aleph-alpha/ts-rs/llms.txt
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export, export_to = "../../shared/")]
pub struct MsgGameState {
    #[serde(rename = "type")]
    pub msg_type: String,  // always "game_state"
    pub tick: u64,
    pub hp: (u32, u32),
    pub wins: (u32, u32),  // FIX-02: win counter in snapshot
    pub poses: (Vec<PoseKeypoint>, Vec<PoseKeypoint>),
    pub recent_hits: Vec<HitEvent>,
    pub high_latency: bool,
    pub remaining_time: f64,
    pub max_wins: u32,
}
// Alternative: use a unit-value default fn for the type field
// to guarantee it serializes as the literal "game_state"
```

### tower-http ServeDir for Static Files

```rust
// Source: https://github.com/tokio-rs/axum/blob/main/axum/src/docs/routing/route_service.md
use tower_http::services::ServeDir;
use axum::Router;

let app = Router::new()
    .nest_service("/mobile", ServeDir::new("mobile/dist"))
    .nest_service("/overlay", ServeDir::new("overlay/dist"));
```

### Room Expiry Background Task

```rust
// Source: [ASSUMED] - pattern follows DashMap retain + Tokio interval
use tokio::time::{interval, Duration};
use dashmap::DashMap;
use std::sync::Arc;

async fn room_expiry_task(rooms: Arc<DashMap<String, RoomHandle>>) {
    let mut interval = interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        rooms.retain(|_code, handle| !handle.is_expired());
    }
}
// is_expired() = match_over && all_sockets_none_for > 10 minutes
// DashMap::retain takes &K, &mut V -- must not block inside closure
```

### RTT Fairness Cutoff (port from Python)

```rust
// Source: port of server/input_delay.py
pub fn compute_cutoff(
    rtt_samples_p1: &[f64],
    rtt_samples_p2: &[f64],
    max_delay_ms: f64,
) -> (std::time::Instant, f64, f64) {
    let rtt_a = median(rtt_samples_p1);  // ms
    let rtt_b = median(rtt_samples_p2);  // ms
    let max_rtt_s = rtt_a.max(rtt_b).min(max_delay_ms) / 1000.0;
    let cutoff = std::time::Instant::now() - std::time::Duration::from_secs_f64(max_rtt_s);
    (cutoff, rtt_a, rtt_b)
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python asyncio single-threaded loop | Tokio multi-threaded room actors | Phase 1 | True parallelism across rooms; no GIL |
| Pydantic serialization in hot path | serde_json (zero-copy when possible) | Phase 1 | Orders of magnitude faster serialization |
| gen_protocol.py hand-sync | ts-rs derive macro | Phase 1 (D-04) | Compile-time guarantee that TypeScript matches Rust |
| axum 0.7.x | axum 0.8.x | 2025 | Minor API changes in `serve` fn; WebSocket API unchanged |
| ts-rs 10.x | ts-rs 12.0.1 | 2025 | API stable; serde-compat feature still present |

**Deprecated/outdated:**
- `axum 0.7.x`: `axum::Server::bind()` was removed in 0.8; use `tokio::net::TcpListener::bind()` + `axum::serve()`.
- `tokio-tungstenite` direct use: Axum 0.7+ includes its own WebSocket support via `axum::extract::ws`; no need to add tokio-tungstenite as a direct dependency.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Room expiry background task uses `DashMap::retain` directly (not a separate cleanup vec) | Code Examples | `retain` may require holding shard locks longer than ideal; would need alternate approach if profiling shows contention |
| A2 | `MsgGameState` in Rust should model `poses` as `(Vec<PoseKeypoint>, Vec<PoseKeypoint>)` always serialized as `[[],[]]` | Architecture Patterns | If serde_json serializes tuples differently than Python's `tuple[list, list]`, roundtrip test will fail; verify against fixture |
| A3 | The spectator snapshot approach for FIX-02 (subscribe then request snapshot) works correctly with Tokio's broadcast semantics | Common Pitfalls / FIX-02 | If the subscription window is too large, spectator may see duplicate messages; verify with integration test |
| A4 | Dockerfile: using `rust:1.94-slim` as Rust build stage + `debian:bookworm-slim` as final image produces a working binary | Common Pitfalls | If Railway's build environment has incompatible glibc, binary will fail to execute |
| A5 | `ts-rs` `export_to = "../../shared/"` path is relative to `engine/engine-core/Cargo.toml` and correctly resolves to `shared/` at repo root | Code Examples | Wrong path silently writes bindings to wrong location; verify with `cargo test` output |

---

## Open Questions (RESOLVED)

1. **FIX-02 — what messages constitute a complete snapshot?**
   - What we know: The CONTEXT.md says "snapshot of current HP, wins, round number, and elapsed time". The Python protocol has no dedicated snapshot message.
   - What's unclear: Should Phase 1 add a new message type (e.g. `MsgSpectatorSnapshot`) or synthesize existing messages (`game_state` + `round_start` with state)? A new message type would require a TypeScript client change (which is forbidden). Synthesizing `game_state` + some lobby state via existing messages keeps the client unchanged.
   - RESOLVED: Compose existing messages in the correct sequence — `lobby_update`, then if match in progress: `round_start{round_number}` followed by a `game_state` tick with current HP/remaining_time/wins. The overlay already handles these messages; receiving them on connect is idempotent. `MsgGameState` was extended with a `wins: (u32, u32)` field (Plan 01 Task 2) so the snapshot always includes the win counter.

2. **Game loop placeholder in Phase 1**
   - What we know: Phase 1 has no boxing plugin. Claude's Discretion allows a no-op tick or minimal warmup counter.
   - What's unclear: If `game_loop.rs` sends no `game_state` messages, spectators will see no HUD updates. A minimal game loop that sends `game_state{hp:[800,800], remaining_time}` at 60Hz allows the overlay to render correctly even without hit detection.
   - RESOLVED: Implement the full game loop skeleton (warmup gate, round lifecycle, round timer, `game_state` broadcast) without hit detection (Plan 04 Task 1). This satisfies ENG-04 and ENG-09 and allows end-to-end testing of the spectator path.

3. **ts-rs output path relative to workspace root**
   - What we know: `TS_RS_EXPORT_DIR` defaults to `./bindings` relative to `Cargo.toml`. The project wants bindings written to `shared/`.
   - What's unclear: Whether to use `export_to = "../../shared/"` per-struct or set `TS_RS_EXPORT_DIR` globally.
   - RESOLVED: Set `TS_RS_EXPORT_DIR = { value = "../../shared", relative = true }` in `engine/.cargo/config.toml` (Plan 01 Task 1). This is less error-prone than per-struct `export_to` annotations and avoids duplicating the path on every struct.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust / Cargo | All Rust compilation | Available (via rustup) | rustc 1.94.1 / cargo 1.94.1 | — |
| Node.js | TypeScript client builds (mobile, overlay) | Not checked in this session | — | Not needed for engine-core |
| Docker | Final container build / Railway deploy | Not confirmed present | — | Build without Docker during dev |
| Python (server) | Python server (parallel during dev) | Not confirmed | — | Python server is separate, not a Rust dependency |

**Note:** Rust is available at `/Users/charliexue/.rustup/toolchains/stable-aarch64-apple-darwin/bin/` but not on the default PATH. The Wave 0 task must either add `~/.cargo/bin` to PATH or configure the project shell to source rustup. [VERIFIED: filesystem check]

**Missing dependencies with no fallback:**
- `~/.cargo/bin` not on PATH — Wave 0 must configure shell or use full paths in Makefile/scripts.

**Missing dependencies with fallback:**
- Docker: can develop and test the Rust binary directly without containerizing; Docker only needed for Railway deploy verification.

---

## Sources

### Primary (HIGH confidence)

- `/tokio-rs/axum` (Context7) — WebSocket handler pattern, shared state, ServeDir, graceful shutdown
- `/aleph-alpha/ts-rs` (Context7) — derive TS, internally-tagged enums, export_to, serde-compat
- `/websites/rs_tokio_tokio` (Context7) — MissedTickBehavior::Skip, JoinHandle::abort, broadcast channel
- crates.io REST API — verified current versions for axum (0.8.9), tokio (1.52.1), dashmap (6.1.0), serde_json (1.0.149), ts-rs (12.0.1), tower-http (0.6.8), tracing (0.1.44), rand (0.8.6)
- `server/main.py`, `server/rooms.py`, `server/game_loop.py`, `server/input_delay.py`, `server/broadcast.py`, `server/protocol.py` — existing Python implementation (port reference, read in this session)
- `shared/protocol.ts` — TypeScript wire contract (read in this session)
- `.planning/phases/01-engine-core/01-CONTEXT.md` — locked decisions (read in this session)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md` — architectural constraints and known bugs (read in this session)

### Secondary (MEDIUM confidence)

- `Dockerfile` and `railway.toml` — confirmed current multi-stage build structure; Rust stage integration design based on existing patterns

### Tertiary (LOW confidence)

- DashMap `retain` for room expiry — pattern is standard but not verified against a specific DashMap 6.x example [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against crates.io API; library choices confirmed by CONTEXT.md and PROJECT.md locked decisions
- Architecture: HIGH — Axum/Tokio patterns verified via Context7; actor model well-documented; port reference is complete Python source
- Pitfalls: MEDIUM — broadcasting lag, DashMap-across-await, and Dockerfile libc issues are well-known community patterns but not all tested in this specific codebase

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (crate versions move fast; re-verify if >30 days before execution)
