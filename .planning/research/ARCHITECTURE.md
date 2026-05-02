# Architecture Research

**Domain:** Real-time authoritative WebSocket game server (Rust rewrite)
**Researched:** 2026-05-01
**Confidence:** HIGH (Axum/Tokio patterns verified via Context7 and official docs; game loop timing from tokio docs; actor pattern from Alice Ryhl's canonical post)

## Standard Architecture

### System Overview

The Rust server is a single-process Tokio runtime with four distinct concurrency layers:

```
┌──────────────────────────────────────────────────────────────────┐
│                     Axum HTTP/WS Layer                           │
│  GET /rooms  POST /rooms  WS /ws/player/:code  WS /ws/spec/:code │
│  State<Arc<AppState>> injected via Router::with_state            │
└──────────────┬─────────────────────────────┬─────────────────────┘
               │ one tokio task per WS conn  │
               ▼                             ▼
┌──────────────────────────┐   ┌─────────────────────────────────┐
│  Player WS Task (x2/room)│   │  Spectator WS Task (x0..N/room) │
│  owns split sink         │   │  subscribes to broadcast::Rx    │
│  reads frames, pings     │   │  discards all inbound messages   │
│  sends to room actor via │   │                                  │
│  mpsc tx                 │   │                                  │
└──────────┬───────────────┘   └─────────────────────────────────┘
           │ RoomMsg enum
           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Room Actor (one tokio task per room)                            │
│  owns all per-room state (RoomState)                             │
│  drives calibration handshake                                    │
│  starts/stops GameLoop                                           │
│  routes disconnect/reconnect/forfeit timers                      │
│  holds broadcast::Sender for spectator fan-out                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │ tick every 16.67ms
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Game Loop (runs inside Room Actor, not a separate task)         │
│  tokio::time::interval(16.67ms) + MissedTickBehavior::Skip       │
│  calls game_plugin.on_tick(input, state) — synchronous           │
│  drains input_buffer, applies RTT cutoff                         │
│  broadcasts MsgGameState via broadcast::Sender                   │
└──────────────────────────┬───────────────────────────────────────┘
                           │ async call, spawned task
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Commentary Task (optional, per room, fire-and-forget)           │
│  reqwest HTTP to Claude API + ElevenLabs                         │
│  pushes commentary_text / commentary_audio into broadcast chan   │
└──────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Owns | Communicates With | Implementation |
|-----------|------|-------------------|----------------|
| `AppState` | `DashMap<String, RoomHandle>` (room registry), HTTP config | All WS handlers via `State<Arc<AppState>>` | `Arc<AppState>` shared via `Router::with_state` |
| `RoomHandle` | `mpsc::Sender<RoomMsg>`, `broadcast::Sender<Arc<str>>` | WS tasks send RoomMsg; spectator tasks subscribe to broadcast | Cloneable handle struct wrapping channel ends |
| `Room Actor` | `RoomState`, `GameLoop`, disconnect timers, `broadcast::Sender` | Receives `RoomMsg` from player WS tasks; sends to players via stored `mpsc::Sender<WsOutMsg>` per slot | Long-running `tokio::spawn` task per room |
| `PlayerWsTask` | `SplitSink<WebSocket>` write half, `mpsc::Receiver<WsOutMsg>` | Sends `RoomMsg` to Room Actor; receives `WsOutMsg` from Room Actor for outbound WS sends | `tokio::spawn` inside Axum `ws.on_upgrade` |
| `SpectatorWsTask` | `broadcast::Receiver<Arc<str>>` | Receives broadcast from Room Actor | `tokio::spawn` inside Axum `ws.on_upgrade` |
| `GameLoop` | Input buffers, `dyn GamePlugin`, tick counter, HP | Called synchronously by Room Actor on each tick; calls `broadcast::Sender` for game_state | Struct owned by Room Actor, not a separate task |
| `GamePlugin` trait | Game-specific logic only | Called synchronously: `on_tick`, `on_player_join`, `on_player_leave`, `on_calibration_complete` | Statically dispatched `Box<dyn GamePlugin + Send>` |
| `CommentaryTask` | `reqwest::Client`, ElevenLabs key | Receives `CommentaryEvent` via `mpsc`; sends to `broadcast::Sender` | Separate `tokio::spawn`, optionally absent |

## Recommended Project Structure

```
server/
├── main.rs                   # Tokio entry point, Router assembly, AppState init
├── state.rs                  # AppState, RoomHandle, DashMap registry
├── protocol/
│   mod.rs                    # Re-exports all message types
│   mobile.rs                 # Inbound messages (pose_frame, calibration_done, ping, pong)
│   server.rs                 # Outbound messages (game_state, you_were_hit, round_start, ...)
│   shared.rs                 # Shared structs (PoseKeypoint, HitEvent, Position)
├── room/
│   mod.rs                    # RoomMsg enum, RoomState struct, room_actor fn
│   lifecycle.rs              # Calibration handshake, match start/end, rematch, forfeit timers
│   input_delay.rs            # RTT fairness cutoff (ported from input_delay.py)
│   broadcast.rs              # broadcast::Sender helper, dead-receiver pruning
├── ws/
│   player.rs                 # Axum WS handler for /ws/player/:code, PlayerWsTask
│   spectator.rs              # Axum WS handler for /ws/spectator/:code, SpectatorWsTask
├── game/
│   mod.rs                    # GamePlugin trait definition, GameLoop struct
│   loop.rs                   # tick driver: interval, input drain, plugin dispatch, broadcast
│   boxing/
│       mod.rs                # BoxingPlugin: implements GamePlugin
│       hit_detection.rs      # Ported detect_punch / detect_kick
│       damage.rs             # Ported compute_damage
│       bot.rs                # Solo mode bot logic
├── commentary/
│   mod.rs                    # CommentaryTask, event classification, reqwest calls
└── http/
    routes.rs                 # POST /rooms, GET /rooms/:code, static file serving
```

### Structure Rationale

- **`game/` vs `room/`:** Game logic (hit detection, damage, plugin trait) is independent of transport. Room logic (calibration, reconnect, forfeit) is transport-aware. Keeping them separate means the GamePlugin trait has no Axum or WebSocket imports.
- **`protocol/` split:** Inbound (mobile) vs outbound (server) message types are never confused. `shared.rs` holds types that appear in both directions (PoseKeypoint).
- **`ws/` handlers thin:** WS handlers only parse messages and forward `RoomMsg` to the room actor. Zero game logic in WS handlers.

## Architectural Patterns

### Pattern 1: Room Actor owns all per-room mutable state

**What:** Each room runs as a single `tokio::spawn` task that exclusively owns `RoomState`. WS tasks communicate with it only via `mpsc::Sender<RoomMsg>` channels. No `Mutex` guards any per-room state.

**When to use:** Any time multiple concurrent WS tasks need to modify the same room state. This is always the case here.

**Trade-offs:** Eliminates lock contention and `MutexGuard` across `.await` bugs at the cost of slightly more message-passing boilerplate. The alternative — `Arc<RwLock<RoomState>>` — would require holding the write guard across async WS sends, which is unsound with `std::sync::RwLock` and slow with `tokio::sync::RwLock`.

```rust
// Room actor message enum
pub enum RoomMsg {
    PlayerConnect { slot: u8, tx: mpsc::Sender<WsOutMsg>, reconnect: bool },
    PlayerDisconnect { slot: u8 },
    PoseFrame { slot: u8, frame: MsgPoseFrame },
    CalibrationDone { slot: u8, reference_velocity: f32 },
    Ping { slot: u8, t: f64 },
    Pong { slot: u8, t: f64 },
    RematchRequest,
}

// Room actor loop — owns all state, no Arc<Mutex<>>
async fn room_actor(mut rx: mpsc::Receiver<RoomMsg>, state: RoomState) {
    let mut interval = tokio::time::interval(Duration::from_nanos(16_666_667));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            Some(msg) = rx.recv() => handle_msg(&mut state, msg).await,
            _ = interval.tick(), if state.game_loop_active => {
                state.game_loop.tick(&state.broadcast_tx).await;
            }
        }
    }
}
```

### Pattern 2: Game loop runs inside the Room Actor, not a separate task

**What:** The 60Hz interval tick is driven by `tokio::select!` inside the room actor, not by a separate `tokio::spawn`. The game plugin `on_tick` is called synchronously. There is no second task to coordinate with.

**When to use:** Always for this architecture. A separate game loop task would need to share `RoomState` with the room actor (back to `Arc<Mutex<>>`) or pass the entire state across a channel each tick (huge allocations).

**Trade-offs:** The game plugin `on_tick` must complete in well under 100µs (the Tokio cooperative preemption budget). For boxing hit detection over 10-frame windows with 33 keypoints each, this is trivially achievable. If a future game plugin has heavy CPU work (e.g., physics simulation), that work should be bounded or offloaded.

**Key constraint:** Never call `.await` inside `on_tick`. The plugin is synchronous. Async side effects (sending `you_were_hit`, queuing commentary) are returned as a result and driven by the room actor after `on_tick` returns.

### Pattern 3: Spectator fan-out via `tokio::sync::broadcast`

**What:** One `broadcast::Sender<Arc<str>>` per room. The room actor sends pre-serialized JSON strings (wrapped in `Arc<str>` to avoid cloning the string per receiver). Each spectator WS task holds a `broadcast::Receiver<Arc<str>>` and writes to its WS sink.

**When to use:** Any time one message must go to N unknown, concurrently-running consumers.

**Trade-offs:** `broadcast` drops messages for slow receivers (`RecvError::Lagged`). For spectators this is acceptable — a single dropped `game_state` frame is invisible at 60Hz. Set channel capacity to 128 (two seconds of ticks) so a slow spectator gets a few seconds before lag-dropping.

```rust
// Spectator task
async fn spectator_task(socket: WebSocket, mut broadcast_rx: broadcast::Receiver<Arc<str>>) {
    let (mut sink, mut stream) = socket.split();
    loop {
        tokio::select! {
            msg = broadcast_rx.recv() => match msg {
                Ok(json) => { let _ = sink.send(Message::Text(json.to_string().into())).await; }
                Err(broadcast::error::RecvError::Lagged(_)) => continue, // skip dropped frames
                Err(_) => break,
            },
            _ = stream.next() => {} // discard; keep connection alive
        }
    }
}
```

### Pattern 4: Per-player outbound channel instead of shared WS sink

**What:** The room actor sends outbound messages to players via `mpsc::Sender<WsOutMsg>`. The player WS task owns the WS sink and drains this channel in a select loop.

**When to use:** Whenever the room actor or game loop needs to send to a specific player (e.g., `you_were_hit`, `joined`, `calibration_start`). This avoids wrapping the WS sink in an `Arc<Mutex<>>`.

**Trade-offs:** One extra allocation per message. For player-specific messages at ~60Hz this is fine; only `game_state` is broadcast to all via the broadcast channel.

### Pattern 5: GamePlugin trait — synchronous, no async, no I/O

**What:** The plugin trait has only synchronous methods. All return types are plain data (events, state changes). The room actor drives async I/O based on what the plugin returns.

**Why:** Async trait methods with `dyn Trait` require boxing futures (`async-trait` crate), which allocates on every call. At 60Hz with potentially many rooms, this matters. More importantly, keeping the plugin sync makes it testable without a Tokio runtime.

```rust
pub struct TickInput<'a> {
    pub tick: u64,
    pub now_secs: f64,
    pub player_frames: [Option<&'a [PoseFrame]>; 2],
    pub reference_velocities: [Option<f32>; 2],
    pub remaining_time: f32,
}

pub struct TickOutput {
    pub game_state: MsgGameState,       // always present — broadcast to spectators
    pub player_messages: Vec<(u8, WsOutMsg)>, // slot, message — sent directly to player
    pub commentary_events: Vec<CommentaryEvent>, // queued for commentary task
}

pub trait GamePlugin: Send + 'static {
    fn on_tick(&mut self, input: TickInput) -> TickOutput;
    fn on_player_join(&mut self, slot: u8, reference_velocity: f32);
    fn on_player_leave(&mut self, slot: u8);
    fn on_calibration_complete(&mut self, slot: u8, reference_velocity: f32);
    fn on_round_start(&mut self, round_number: u32);
}
```

### Pattern 6: Global room registry via DashMap

**What:** `Arc<DashMap<String, RoomHandle>>` is the global registry. `RoomHandle` holds the room's `mpsc::Sender<RoomMsg>` and `broadcast::Sender<Arc<str>>`.

**Why DashMap over `Arc<RwLock<HashMap>>`:** DashMap shards internally (one RwLock per shard), so concurrent room lookups from different WS handler tasks don't contend. `Arc<RwLock<HashMap>>` serializes all lookups under a single lock.

**Trade-offs:** DashMap has slightly higher per-entry overhead than HashMap. At the scale of hundreds of rooms this is irrelevant.

## Data Flow

### Pose Frame Path (mobile → game loop → spectators)

```
Mobile WS send "pose_frame"
    ↓
PlayerWsTask: parse JSON → RoomMsg::PoseFrame { slot, frame }
    ↓ mpsc send
Room Actor: push to input_buffer[slot]
Room Actor: serialize MsgPoseUpdate → broadcast::Sender (fast path, no tick delay)
    ↓ broadcast channel
SpectatorWsTask(s): receive Arc<str> → ws sink.send
    ↓
Overlay Pixi.js renders at capture rate

(separately, each 16.67ms tick:)
Room Actor: GameLoop::tick()
    → input_buffer drained up to RTT cutoff → processed_frames
    → plugin.on_tick(processed_frames) → TickOutput
    → MsgGameState serialized → broadcast::Sender (includes recent_hits, hp, timer)
    → player-specific messages (you_were_hit) → per-player mpsc
```

**Key invariant:** Pose data and game state are two separate broadcast channels flowing at different rates. `MsgPoseUpdate` bypasses the game loop entirely and is fanned out immediately on frame arrival. `MsgGameState` only exits the game loop at tick rate.

### Hit Detection Path (server-authoritative)

```
GameLoop::tick()
    → compute_cutoff(rtt_samples) → cutoff timestamp
    → drain input_buffer[1] and input_buffer[2] up to cutoff
    → plugin.on_tick(frames_1, frames_2, ...) — synchronous
        → boxing_plugin: detect_punch/detect_kick against 10-frame windows
        → if hit: compute_damage, update hp, produce HitEvent
        → returns TickOutput { game_state with recent_hits, you_were_hit msg for defender }
    ← room actor receives TickOutput
    → broadcast MsgGameState (contains recent_hits) via broadcast channel
    → send MsgYouWereHit to defender via per-player mpsc
```

### Calibration Path

```
Both players connect
    ↓ RoomMsg::PlayerConnect for each
Room Actor: when both connected → send calibration_start to both via per-player mpsc
    ↓
PlayerWsTask: receives calibration_start → sends over WS
    ↓ (mobile app calibrates...)
Mobile: sends calibration_done { reference_velocity }
    ↓
PlayerWsTask: parse → RoomMsg::CalibrationDone { slot, reference_velocity }
    ↓ mpsc
Room Actor: record reference_velocity in RoomState
    → when both calibrated: create BoxingPlugin, create GameLoop, start interval
    → send match_start to both players via per-player mpsc
    → broadcast match_start via broadcast channel (spectators)

BUG FIX: reset_for_rematch MUST preserve reference_velocity in PlayerSlot.
Current Python bug: reset_for_rematch sets reference_velocity = None, forcing recalibration.
Fix: introduce a separate `calibration_state` field; reset only match state, not calibration.
```

### Commentary Path

```
TickOutput::commentary_events non-empty
    ↓
Room Actor: mpsc send to CommentaryTask
    ↓
CommentaryTask: classify event → prompt → reqwest::Client POST to Claude API (streaming)
    → token deltas → serialize → broadcast::Sender (commentary_text)
    → sentence complete → ElevenLabs TTS → base64 audio → broadcast::Sender (commentary_audio)
    ↓
SpectatorWsTask: receives commentary_text / commentary_audio → WS sink
    ↓
Overlay: plays audio, shows subtitle
```

### Spectator Reconnect Fix

On spectator join, the room actor immediately sends current state before the spectator enters the broadcast stream:

```
SpectatorWsTask sends RoomMsg::SpectatorConnect { tx: oneshot::Sender<InitialState> }
Room Actor: build InitialState { hp, wins, round_number, match_phase, lobby_state }
    → oneshot reply
SpectatorWsTask: send InitialState over WS, then subscribe to broadcast channel
```

This fixes the bug where spectator reconnect resets local win counters because the server never sent a state snapshot.

## Task Topology Diagram

```
main()
  └─ Tokio runtime
       ├─ Axum server task (HTTP + WS upgrade)
       ├─ Room Actor task [per room, long-lived]
       │    ├─ interval tick (game loop)
       │    └─ commentary task [per room, optional]
       ├─ Player WS task [2 per room]
       │    ├─ read half: parse frames, send RoomMsg
       │    └─ write half: drain WsOutMsg channel → ws sink
       └─ Spectator WS task [N per room]
            ├─ subscribe broadcast::Receiver
            └─ discard inbound
```

Number of tasks per room: 1 (actor) + 1 (commentary) + 2 (players) + N (spectators). For 10 rooms and 3 spectators each: ~50 tasks — negligible for Tokio.

## 60Hz Tick Jitter Analysis

**Root cause of jitter:** The Python server uses `asyncio.sleep(max(0, target_dt - elapsed))`. If any async operation in the same event loop blocks for >1ms (a WS send, Python GIL contention, JSON serialization), the sleep fires late and jitter accumulates.

**Rust solution:**

1. **`tokio::time::interval` instead of sleep:** Interval tracks absolute deadlines, not relative sleeps. If a tick takes 5ms of a 16.67ms budget, the next tick fires after 11.67ms, not after 16.67ms.

2. **`MissedTickBehavior::Skip`:** If a tick runs long (>16.67ms), do not burst-fire catchup ticks. Skip to the next wall-clock aligned tick. For a game server, one late tick is better than two immediately consecutive ticks.

3. **Game loop in actor, not separate task:** Eliminates cross-task scheduling overhead. The actor's event loop has the interval and the mpsc receive in the same `tokio::select!`. Tokio's work-stealing scheduler keeps this on the same thread most of the time.

4. **Synchronous plugin dispatch:** No `.await` inside `on_tick`. JSON serialization (`serde_json::to_string`) is synchronous and fast (~5µs for a `MsgGameState`). No allocation spikes from async trait boxing.

5. **Externally-tagged serde enums:** The wire protocol uses `"type": "..."` as the discriminator. Serde's internally-tagged representation is 2x slower for deserialization due to buffering the entire input. Use `#[serde(tag = "type")]` externally tagged or a manual match on `msg["type"]` string.

**Expected jitter:** <1ms p99 with this structure on a single-threaded Tokio runtime or multi-threaded with one room per actor. The Python baseline sees 2–5ms jitter due to GIL + asyncio overhead.

## Anti-Patterns

### Anti-Pattern 1: Arc<RwLock<RoomState>> shared across WS tasks

**What people do:** Put `RoomState` in `Arc<RwLock<>>` and pass it to every WS task.

**Why it's wrong:** WS tasks need to hold write locks across `.await` points (sending a WS message, waiting for calibration). `std::sync::RwLock` is not `Send` across `.await`; `tokio::sync::RwLock` is, but contention from 2 player tasks + game loop ticking at 60Hz creates a write queue and introduces the very latency spikes that cause tick jitter.

**Do this instead:** Room actor owns all state. WS tasks communicate only via channels. No `Arc<RwLock<>>` on hot paths.

### Anti-Pattern 2: Async methods on GamePlugin trait

**What people do:** Add `async fn on_tick(...)` to the plugin trait to allow plugins to do network I/O.

**Why it's wrong:** `dyn Trait` with async methods requires `async-trait` (boxes every future). At 60Hz × N rooms, this is N allocations per tick. More critically, it moves I/O decisions into the plugin, which breaks the separation between game logic and transport.

**Do this instead:** Plugin methods are synchronous. Side effects (WS sends, commentary) are returned in `TickOutput` and driven by the room actor. If a plugin needs external data (e.g., ML model inference), it should pre-compute and cache, not block the tick.

### Anti-Pattern 3: Poses in game_state broadcast

**What people do:** Include full pose keypoints in `MsgGameState` to simplify the spectator protocol.

**Why it's wrong:** At 60Hz, 2 players × 33 keypoints × 4 floats = ~1600 floats per tick through the slow game-state path. This inflates the broadcast message size and adds serialization time in the tick hot path.

**Do this instead:** Keep the two-channel design from the Python server. `MsgPoseUpdate` is sent immediately by the player WS task on frame arrival (not tick-synchronized). `MsgGameState` sends empty pose arrays. This gives the overlay maximum responsiveness for pose rendering while keeping the game-state broadcast small.

### Anti-Pattern 4: spawn_blocking for the game loop

**What people do:** Use `tokio::task::spawn_blocking` to isolate the game loop from the async executor.

**Why it's wrong:** `spawn_blocking` is for operations that "eventually finish." A game loop that runs for the lifetime of a match will exhaust the blocking thread pool (default 512 threads). The docs explicitly warn against infinite loops in `spawn_blocking`.

**Do this instead:** Run the game loop as a normal async task using `tokio::time::interval`. The synchronous `on_tick` work completes in <100µs, well within Tokio's cooperative preemption budget.

### Anti-Pattern 5: One broadcast channel for everything

**What people do:** A single `broadcast::Sender` per room for all message types (poses, game state, commentary, system events).

**Why it's wrong:** Pose updates arrive at 60Hz from two players (120/s). Game state goes out at 60Hz. Commentary audio frames are large and infrequent. Mixing them means the broadcast buffer fills with pose frames, and slow spectators lag and drop game state messages.

**Do this instead:** Two channels per room — a fast-path `broadcast::Sender` for `pose_update` messages (sent inline by the player WS task, capacity 32), and a game-state `broadcast::Sender` for everything from the room actor (capacity 128). Commentary can share the game-state channel since it is infrequent.

## Build Order Implications

The component graph has clear serial dependencies:

```
Phase 1: Protocol types (serde models, wire format parity)
    → no dependencies
    → blocks: everything else

Phase 2: Transport skeleton (Axum WS upgrades, room registry, player/spectator tasks)
    → depends on: Protocol types
    → blocks: Room actor, game loop

Phase 3: Room actor + calibration handshake
    → depends on: Transport skeleton
    → blocks: Game loop, commentary
    → BUG FIX: calibration persistence across rematch lives here

Phase 4: Game loop + BoxingPlugin (engine core + first plugin)
    → depends on: Room actor
    → blocks: Second plugin, SDK docs
    → BUG FIX: spectator state snapshot on connect lives here

Phase 5: Commentary port (reqwest + Claude + ElevenLabs)
    → depends on: Room actor broadcast channel (Phase 3)
    → no game loop dependency — can be stubbed out

Phase 6: Second game plugin (validates trait generality)
    → depends on: GamePlugin trait (Phase 4)

Phase 7: SDK documentation
    → depends on: Two working plugins (Phase 6)
```

**Rationale for ordering:**
- Protocol first: every subsequent test can speak the wire format.
- Transport before actor: once Axum accepts WS connections and routes to a room handle, you can write integration tests against real clients.
- Room actor before game loop: the actor's `select!` is what drives ticks; the game loop is instantiated by the actor.
- Commentary last: it is a separate concern (async HTTP) with no compile-time coupling to the game engine.
- Second plugin before SDK: documentation should describe a proven interface, not a hypothetical one.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude API | `reqwest::Client::post` with streaming response, inside `CommentaryTask` tokio::spawn | Use `reqwest`'s async body streaming; map token deltas to `commentary_text` broadcast messages |
| ElevenLabs TTS | `reqwest::Client::post` non-streaming (full audio chunk), inside `CommentaryTask` | Base64-encode audio bytes; send as `commentary_audio` broadcast message |
| Railway/Docker | No change from Python deployment — same port, same `railway.toml` shape | Multi-stage Dockerfile: `rust:1.78-slim` builder → `debian:bookworm-slim` runtime |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| PlayerWsTask → RoomActor | `mpsc::Sender<RoomMsg>` | Bounded channel (64); backpressure disconnects unresponsive clients |
| RoomActor → PlayerWsTask | `mpsc::Sender<WsOutMsg>` per slot | Bounded (32); if player is too slow, their WS task drops sends gracefully |
| RoomActor → SpectatorWsTask | `broadcast::Sender<Arc<str>>` | Capacity 128 for game-state channel; lagged receivers skip frames |
| RoomActor → CommentaryTask | `mpsc::Sender<CommentaryEvent>` | Bounded (16); if commentary is backed up, events are dropped (acceptable) |
| GamePlugin → RoomActor | Synchronous return via `TickOutput` | No channel; plugin runs inside actor's tick |
| RoomActor → DashMap registry | `Arc<DashMap<String, RoomHandle>>` | Read on WS connect; insert on room create; delete on room empty |

## Sources

- Axum WebSocket docs (Context7 / tokio-rs/axum): https://context7.com/tokio-rs/axum/llms.txt
- Tokio shared state tutorial: https://tokio.rs/tokio/tutorial/shared-state
- Alice Ryhl, "Actors with Tokio": https://ryhl.io/blog/actors-with-tokio/
- tokio::time::interval MissedTickBehavior: https://docs.rs/tokio/latest/tokio/time/enum.MissedTickBehavior.html
- Tokio async game server design forum: https://users.rust-lang.org/t/tokio-tungstenite-async-game-server-design/65996
- DashMap concurrent HashMap: https://github.com/xacrimon/dashmap
- Serde enum representations: https://serde.rs/enum-representations.html
- Tokio spawn_blocking docs (why not for game loops): https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html

---
*Architecture research for: Rust real-time WebSocket game server (Axum + Tokio rewrite of Python/FastAPI)*
*Researched: 2026-05-01*
