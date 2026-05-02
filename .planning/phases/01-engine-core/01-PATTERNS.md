# Phase 1: Engine Core - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 11 new files (all net-new Rust, plus Dockerfile modification)
**Analogs found:** 11 / 11 (all from Python server — direct port analogs)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `engine/Cargo.toml` | config | — | `Dockerfile` (multi-stage build) | structural |
| `engine/engine-core/Cargo.toml` | config | — | `server/requirements.txt` (dep list) | structural |
| `engine/engine-core/src/main.rs` | service (entry + router) | request-response | `server/main.py` | exact port |
| `engine/engine-core/src/protocol.rs` | model | request-response | `server/protocol.py` + `shared/protocol.ts` | exact port |
| `engine/engine-core/src/room.rs` | service (actor) | event-driven | `server/rooms.py` (RoomState/PlayerSlot) + `server/game_loop.py` (run/tick) | exact port |
| `engine/engine-core/src/room_manager.rs` | service (registry) | CRUD | `server/rooms.py` (RoomManager) | exact port |
| `engine/engine-core/src/input_delay.rs` | utility | transform | `server/input_delay.py` | exact port |
| `engine/engine-core/src/broadcast.rs` | utility | event-driven | `server/broadcast.py` | exact port |
| `engine/engine-core/src/game_loop.rs` | service (actor loop) | event-driven | `server/game_loop.py` (GameLoop) | exact port |
| `engine/engine-core/tests/protocol_roundtrip.rs` | test | batch | no exact test analog exists | no analog |
| `scripts/capture_fixtures.py` | utility (script) | request-response | `scripts/gen_protocol.py` | role-match |
| `Dockerfile` (modified) | config | — | existing `Dockerfile` | exact (additive stage) |

---

## Pattern Assignments

### `engine/Cargo.toml` (workspace config)

**Analog:** `Dockerfile` (multi-stage structure; each stage = one crate)

**Core pattern:**
```toml
[workspace]
members = ["engine-core"]
resolver = "2"
```

Note: Phase 2 appends `"plugin-trait"` and `"boxing-plugin"` to `members` without any other change.

---

### `engine/engine-core/Cargo.toml` (package manifest)

**Analog:** `server/requirements.txt` (dependency list); versions from RESEARCH.md (crates.io verified).

**Core pattern — full `[dependencies]` block:**
```toml
[package]
name = "engine-core"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.8.9", features = ["ws"] }
tokio = { version = "1.52.1", features = ["full"] }
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.149"
dashmap = "6.1.0"
tower-http = { version = "0.6.8", features = ["fs"] }
ts-rs = { version = "12.0.1", features = ["serde-compat"] }
tracing = "0.1.44"
tracing-subscriber = { version = "0.3.23", features = ["env-filter"] }
rand = "0.8.6"
futures-util = "0.3"
```

**ts-rs export path config** — create `engine/.cargo/config.toml`:
```toml
[env]
TS_RS_EXPORT_DIR = { value = "../../shared", relative = true }
```
This writes generated bindings to `shared/` at repo root (path is relative to `engine/engine-core/Cargo.toml`). Avoids per-struct `export_to` annotations.

---

### `engine/engine-core/src/main.rs` (Axum router + startup)

**Analog:** `server/main.py` (lines 1-683)

**Imports pattern** — copy structure of Python imports block:
```python
# server/main.py lines 1-27
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from rooms import RoomManager
from broadcast import broadcast_to_spectators
from protocol import MsgJoined, MsgPing, MsgPoseUpdate, parse_mobile_msg
```
Rust equivalent:
```rust
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::sync::Arc;
use tower_http::services::ServeDir;
use tracing::info;

mod protocol;
mod room;
mod room_manager;
mod input_delay;
mod broadcast;
mod game_loop;
```

**Startup pattern** — `server/main.py` lines 64-102 (lifespan):
```python
# server/main.py lines 64-75
@asynccontextmanager
async def lifespan(app: FastAPI):
    code = room_manager.create_room()
    app.state.default_room = code
    yield
    # Cleanup: cancel tasks, close sockets
```
Rust equivalent uses `tokio::net::TcpListener` + `axum::serve` (NOT deprecated `axum::Server::bind`):
```rust
#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let state = Arc::new(AppState { rooms: RoomManager::new() });
    tokio::spawn(room_manager::expiry_task(state.rooms.clone()));
    let app = Router::new()
        .route("/ws/player/:room_code", get(ws_player))
        .route("/ws/spectator/:room_code", get(ws_spectator))
        .nest_service("/mobile", ServeDir::new("mobile/dist"))
        .nest_service("/overlay", ServeDir::new("overlay/dist"))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

**WebSocket player handler pattern** — `server/main.py` lines 447-656 (`ws_player`):
```python
# server/main.py lines 447-477: accept, slot assignment
await websocket.accept()
slot = room.players[slot_num]
slot.ws = websocket
slot.connected = True
# ... send MsgJoined ...
# server/main.py lines 535-592: receive loop
while True:
    raw = await websocket.receive_text()
    try:
        data = json.loads(raw)
        msg = parse_mobile_msg(data)
    except Exception as exc:
        log.warning("Player %d bad message: %s", slot_num, exc)
        continue
    if msg.type == "pose_frame":
        ...send RoomCmd::PoseFrame to actor...
    elif msg.type == "pong":
        record_pong(slot, msg.t)
    elif msg.type == "calibration_done":
        ...send RoomCmd::CalibrationDone to actor...
# server/main.py lines 593-656: disconnect handling (finally block)
```
Rust pattern (thin handler — extract, route to actor):
```rust
async fn ws_player(
    Path(room_code): Path<String>,
    State(app): State<Arc<AppState>>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_player(socket, room_code, app))
}

async fn handle_player(socket: axum::extract::ws::WebSocket, room_code: String, app: Arc<AppState>) {
    // Find room handle in DashMap — clone cmd_tx, do NOT hold guard across await
    let cmd_tx = match app.rooms.get_cmd_tx(&room_code) {
        Some(tx) => tx,
        None => { /* close with 4004 */ return; }
    };
    // Split socket to avoid borrow-checker conflict (Pitfall 3)
    let (sink, mut stream) = socket.split();
    // Spawn outbound task (ENG-05)
    let (player_tx, player_rx) = tokio::sync::mpsc::channel::<String>(32);
    tokio::spawn(async move { /* drain player_rx -> sink */ });
    // Send RoomCmd::Join to actor (gets slot assignment back via oneshot)
    // Receive loop: parse msg, route to cmd_tx
    while let Some(Ok(msg)) = stream.next().await {
        // log-and-continue on parse error (Python pattern)
        match msg {
            Message::Text(raw) => {
                match serde_json::from_str::<InboundMobileMsg>(&raw) {
                    Ok(m) => { cmd_tx.send(RoomCmd::from(m)).await.ok(); }
                    Err(e) => { tracing::warn!("bad message: {e}"); continue; }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    // Disconnect: send RoomCmd::PlayerDisconnect
    cmd_tx.send(RoomCmd::PlayerDisconnect { slot }).await.ok();
}
```

**WebSocket spectator handler pattern** — `server/main.py` lines 659-679 (`ws_spectator`):
```python
# server/main.py lines 659-679
@app.websocket("/ws/spectator/{room_code}")
async def ws_spectator(websocket: WebSocket, room_code: str):
    room = room_manager.get_room(room_code)
    await websocket.accept()
    room.add_spectator(websocket)
    await websocket.send_text(_lobby_update_json(room))  # initial state
    try:
        while True:
            await websocket.receive_text()  # keep-alive, discard
    except WebSocketDisconnect:
        pass
    finally:
        room.remove_spectator(websocket)
```
**FIX-02 correction:** Rust version must subscribe to broadcast BEFORE requesting snapshot (Pitfall 6 in RESEARCH.md). See broadcast.rs pattern below.

**Static file serving pattern** — `server/main.py` lines 107-131:
```python
app.mount("/overlay", NoCacheHtmlStatic(directory=str(_overlay_dist), html=True))
app.mount("/mobile", NoCacheHtmlStatic(directory=str(_mobile_dist), html=True))
```
Rust equivalent (tower-http ServeDir — ENG-12):
```rust
.nest_service("/mobile", ServeDir::new("mobile/dist"))
.nest_service("/overlay", ServeDir::new("overlay/dist"))
```

**Error handling pattern** — `server/main.py` lines 540-544 (log-and-continue):
```python
try:
    data = json.loads(raw)
    msg = parse_mobile_msg(data)
except Exception as exc:
    log.warning("Player %d bad message: %s", slot_num, exc)
    continue
```
Port as: `Err(e) => { tracing::warn!(...); continue; }` — never panic or drop connection on bad input.

---

### `engine/engine-core/src/protocol.rs` (serde models + ts-rs bindings)

**Analog:** `server/protocol.py` (lines 1-175) — direct field-for-field port.
**Spec authority:** `shared/protocol.ts` (lines 1-199) — every field name and discriminator must match exactly.

**Python model pattern** — `server/protocol.py` lines 6-9, 44-48:
```python
class PoseKeypoint(BaseModel):
    x: float; y: float; z: float; visibility: float

class MsgJoined(BaseModel):
    type: Literal["joined"] = "joined"
    room_code: str; player_slot: Literal[1, 2]; opponent_connected: bool
```

**Rust struct pattern for each outbound message** (PROTO-01, PROTO-03):
```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct PoseKeypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub visibility: f64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgJoined {
    #[serde(rename = "type")]
    pub msg_type: &'static str,  // always "joined" — use a fn default
    pub room_code: String,
    pub player_slot: u8,         // 1 or 2
    pub opponent_connected: bool,
}
```

**Type literal pattern for `msg_type` field:** Use `#[serde(default = "...")]` with a const fn returning the literal string, OR use a newtype wrapper. The goal is that `msg_type` always serializes as the correct literal (e.g. `"joined"`, `"game_state"`) to match Python's `type: Literal["joined"] = "joined"`.

**Full message inventory** to port (from `server/protocol.py` lines 16-168, verified against `shared/protocol.ts`):

| Rust struct | Python class | `type` literal | Direction |
|-------------|-------------|----------------|-----------|
| `MsgJoin` | `MsgJoin` | `"join"` | Mobile→Server |
| `MsgPoseFrame` | `MsgPoseFrame` | `"pose_frame"` | Mobile→Server |
| `MsgCalibrationDone` | `MsgCalibrationDone` | `"calibration_done"` | Mobile→Server |
| `MsgPing` | `MsgPing` | `"ping"` | Both |
| `MsgPong` | `MsgPong` | `"pong"` | Both |
| `MsgJoined` | `MsgJoined` | `"joined"` | Server→Mobile |
| `MsgCalibrationStart` | `MsgCalibrationStart` | `"calibration_start"` | Server→Mobile |
| `MsgMatchStart` | `MsgMatchStart` | `"match_start"` | Server→Mobile |
| `MsgYouWereHit` | `MsgYouWereHit` | `"you_were_hit"` | Server→Mobile |
| `MsgPlayerDisconnected` | `MsgPlayerDisconnected` | `"player_disconnected"` | Server→Mobile |
| `MsgGameState` | `MsgGameState` | `"game_state"` | Server→Overlay |
| `MsgPoseUpdate` | `MsgPoseUpdate` | `"pose_update"` | Server→Overlay |
| `MsgRoundStart` | `MsgRoundStart` | `"round_start"` | Server→All |
| `MsgRoundEnd` | `MsgRoundEnd` | `"round_end"` | Server→All |
| `MsgMatchEnd` | `MsgMatchEnd` | `"match_end"` | Server→All |
| `MsgRematchStart` | `MsgRematchStart` | `"rematch_start"` | Server→All |
| `MsgLobbyUpdate` | `MsgLobbyUpdate` | `"lobby_update"` | Server→All |
| `HitEvent` | `HitEvent` | (embedded) | in MsgGameState |
| `Position` | `Position` | (embedded) | in HitEvent |

**Inbound union enum** — `server/protocol.py` lines 164-174:
```python
InboundMobileMsg = Annotated[
    Union[MsgJoin, MsgPoseFrame, MsgCalibrationDone, MsgPing, MsgPong],
    Field(discriminator="type"),
]
```
Rust equivalent (internally-tagged enum, NOT separate structs):
```rust
#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum InboundMobileMsg {
    #[serde(rename = "join")] Join(MsgJoin),
    #[serde(rename = "pose_frame")] PoseFrame(MsgPoseFrame),
    #[serde(rename = "calibration_done")] CalibrationDone(MsgCalibrationDone),
    #[serde(rename = "ping")] Ping(MsgPing),
    #[serde(rename = "pong")] Pong(MsgPong),
}
```

**Critical note on ts-rs + internally-tagged enums:** Do NOT derive `TS` on `InboundMobileMsg` (union enum). Derive `TS` only on the individual message structs. The TypeScript side uses `shared/protocol.ts` discriminated unions which are already hand-maintained per the existing `OutboundMobileMsg` union type.

**MsgGameState tuple fields** — `server/protocol.py` lines 90-99:
```python
class MsgGameState(BaseModel):
    hp: tuple[int, int]
    poses: tuple[list[PoseKeypoint], list[PoseKeypoint]]
```
These must serialize as JSON arrays `[a, b]` not objects. Rust `(T, T)` tuples serialize as JSON arrays with `serde_json` — this matches Python's `tuple[int, int]` behavior. Verify with golden-file test.

---

### `engine/engine-core/src/room.rs` (RoomState, PlayerSlot, room actor task)

**Analog:** `server/rooms.py` (lines 1-90) for state layout; `server/game_loop.py` (lines 86-480) for actor behavior.

**State layout** — `server/rooms.py` lines 16-67:
```python
@dataclass
class PlayerSlot:
    ws: WebSocket | None = None
    latest_pose: MsgPoseFrame | None = None
    reference_velocity: float | None = None
    connected: bool = False
    rtt_samples: list[float] = field(default_factory=list)

@dataclass
class RoomState:
    code: str
    players: dict[int, PlayerSlot]
    spectators: set = ...
    game_loop: object = None
    round_number: int = 1
    wins: list[int] = [0, 0]
    round_start_time: float | None = None
    match_over: bool = False
    max_wins: int = 2
```
Rust equivalent — actor exclusively owns this state (no `Arc<Mutex>`):
```rust
pub struct PlayerSlot {
    pub tx: Option<mpsc::Sender<String>>,  // replaces ws; outbound task owns the actual socket
    pub reference_velocity: Option<f64>,
    pub connected: bool,
    pub rtt_samples: Vec<f64>,
}

pub struct RoomState {
    pub code: String,
    pub players: [PlayerSlot; 2],   // index 0 = player 1, index 1 = player 2
    pub round_number: u32,
    pub wins: [u32; 2],
    pub round_start_time: Option<std::time::Instant>,
    pub match_over: bool,
    pub max_wins: u32,
    // No spectator set here — spectators subscribe to broadcast channels
}
```

**Actor command enum** — designed from `server/main.py` message dispatch (lines 548-585):
```rust
pub enum RoomCmd {
    PlayerConnect {
        slot: u8,
        tx: mpsc::Sender<String>,
        reply: oneshot::Sender<ConnectResult>,
    },
    PoseFrame { slot: u8, frame: MsgPoseFrame, arrived_at: std::time::Instant },
    CalibrationDone { slot: u8, reference_velocity: f64 },
    RecordPong { slot: u8, original_t: f64 },
    PlayerDisconnect { slot: u8 },
    GetSnapshot { reply: oneshot::Sender<RoomSnapshot> },  // FIX-02
}
```

**Actor select! loop** — mirrors `server/game_loop.py` lines 157-166 (while self.running loop) and `server/main.py` lines 447+ (command dispatch):
```rust
// server/game_loop.py lines 157-166: target_dt = 1/60; sleep remainder
// Rust replaces asyncio.sleep loop with Tokio interval:
pub async fn room_actor(
    mut cmd_rx: mpsc::Receiver<RoomCmd>,
    mut state: RoomState,
    pose_tx: broadcast::Sender<String>,
    game_tx: broadcast::Sender<String>,
) {
    let mut tick = tokio::time::interval(Duration::from_millis(1000 / 60));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);  // NOT Burst
    loop {
        tokio::select! {
            Some(cmd) = cmd_rx.recv() => {
                handle_cmd(&mut state, cmd, &pose_tx, &game_tx).await;
            }
            _ = tick.tick() => {
                game_tick(&mut state, &game_tx).await;
            }
            else => break,
        }
    }
}
```

**Warmup gate** — `server/game_loop.py` lines 287-306:
```python
if now < self._round_live_at:
    for buf in self._buffers.values():
        buf.clear()
    for buf in self._processed.values():
        buf.clear()
    room.round_start_time = self._round_live_at  # pin timer
    ...broadcast game_state with remaining_time=_ROUND_DURATION...
    return
```
Port constant: `_ROUND_WARMUP = 3.8` → `const ROUND_WARMUP: f64 = 3.8;`

**Round lifecycle** — `server/game_loop.py` lines 336-383:
```python
round_over, round_winner = self._check_round_over(remaining_time)
if round_over:
    await self._broadcast(MsgRoundEnd(...).model_dump_json())
    if round_winner is not None:
        room.wins[round_winner - 1] += 1
    if max(room.wins) >= room.max_wins:
        await self._broadcast(MsgMatchEnd(winner=...).model_dump_json())
        self.stop(); return
    room.round_number += 1
    room.round_start_time = None
    self.hp = [800, 800]
    self._round_live_at = now + _ROUND_WARMUP
    await self._broadcast(MsgRoundStart(round_number=room.round_number).model_dump_json())
    return
```

**Input buffer drain** — `server/game_loop.py` lines 315-319:
```python
cutoff, rtt_a, rtt_b = compute_cutoff(room)
for slot in (1, 2):
    buf = self._buffers[slot]
    while buf and buf[0][0] <= cutoff:
        _, frame = buf.popleft()
        self._processed[slot].append(frame)
```

**Broadcast to all** — `server/game_loop.py` lines 168-176:
```python
async def _broadcast(self, json_text: str) -> None:
    await broadcast_to_spectators(self.room, json_text)
    for slot in self.room.players.values():
        if slot.ws is not None:
            try:
                await slot.ws.send_text(json_text)
            except Exception:
                pass
```
Rust: send to `game_tx` broadcast channel (spectators subscribed) + each `player_tx` mpsc sender. Never call `ws.send()` from game loop (ENG-05 anti-pattern).

---

### `engine/engine-core/src/room_manager.rs` (DashMap registry + expiry task)

**Analog:** `server/rooms.py` lines 70-90 (RoomManager class).

**Registry pattern** — `server/rooms.py` lines 70-89:
```python
class RoomManager:
    def __init__(self): self._rooms: dict[str, RoomState] = {}

    def create_room(self, max_wins=2, ...) -> str:
        while True:
            code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if code not in self._rooms: break
        self._rooms[code] = RoomState(code=code, ...)
        return code

    def get_room(self, code: str) -> RoomState | None:
        return self._rooms.get(code)

    def remove_room(self, code: str) -> None:
        self._rooms.pop(code, None)
```
Rust equivalent with DashMap (thread-safe, no `Arc<Mutex>`):
```rust
use dashmap::DashMap;
use rand::{distributions::Alphanumeric, Rng};

pub struct RoomHandle {
    pub cmd_tx: mpsc::Sender<RoomCmd>,
    pub join_handle: tokio::task::JoinHandle<()>,  // ENG-13: abort on teardown
    pub created_at: std::time::Instant,
    // Expiry tracking: these are set by the actor via RoomCmd::MarkExpired
    pub match_over: std::sync::atomic::AtomicBool,
    pub last_player_present: std::sync::Mutex<Option<std::time::Instant>>,
}

pub struct RoomManager {
    rooms: Arc<DashMap<String, RoomHandle>>,
}

impl RoomManager {
    pub fn create_room(&self, max_wins: u32) -> String {
        loop {
            let code: String = rand::thread_rng()
                .sample_iter(&Alphanumeric)
                .take(6)
                .map(|c| c.to_ascii_uppercase())
                .collect();
            if !self.rooms.contains_key(&code) {
                // Insert + spawn actor, release DashMap guard BEFORE first await
                let (cmd_tx, cmd_rx) = mpsc::channel(128);
                let (pose_tx, _) = broadcast::channel(64);
                let (game_tx, _) = broadcast::channel(128);
                let state = RoomState::new(code.clone(), max_wins);
                let handle = tokio::spawn(room_actor(cmd_rx, state, pose_tx, game_tx));
                self.rooms.insert(code.clone(), RoomHandle { cmd_tx, join_handle: handle, ... });
                return code;
            }
        }
    }
}
```

**Critical: never hold DashMap guard across `.await`** (Pitfall 4 in RESEARCH.md). Clone `cmd_tx` from the entry before any async call.

**Room expiry task** — D-08 decision; no Python analog (Python never had expiry):
```rust
// Pattern from RESEARCH.md Code Examples (room_expiry_task)
pub async fn expiry_task(rooms: Arc<DashMap<String, RoomHandle>>) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        rooms.retain(|_code, handle| !handle.is_expired());
        // is_expired(): match_over == true AND last_player_present > 10 minutes ago
    }
}
```
Call `.abort()` on `handle.join_handle` inside `retain` closure before returning `false`.

---

### `engine/engine-core/src/input_delay.rs` (RTT fairness buffer)

**Analog:** `server/input_delay.py` (lines 1-45) — straight port, algorithm unchanged (D-06).

**Full Python source to port** — `server/input_delay.py` lines 13-45:
```python
_MAX_INPUT_DELAY_MS = 60  # cap so the low-latency player never waits > 60ms

def record_pong(slot, original_t: float) -> float:
    rtt = (time.time() - original_t) * 1000  # ms
    slot.rtt_samples.append(rtt)
    if len(slot.rtt_samples) > 10:
        slot.rtt_samples = slot.rtt_samples[-10:]
    return rtt

def median_rtt(slot) -> float:
    if not slot.rtt_samples: return 0.0
    return statistics.median(slot.rtt_samples)

def compute_cutoff(room, max_delay_ms=_MAX_INPUT_DELAY_MS) -> tuple[float, float, float]:
    now = time.time()
    rtt_a = median_rtt(room.players[1])
    rtt_b = median_rtt(room.players[2])
    max_rtt_s = min(max(rtt_a, rtt_b), max_delay_ms) / 1000.0
    return now - max_rtt_s, rtt_a, rtt_b
```

**Rust port:**
```rust
pub const MAX_INPUT_DELAY_MS: f64 = 60.0;

pub fn record_pong(samples: &mut Vec<f64>, original_t: f64) -> f64 {
    let rtt = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap()
        .as_secs_f64() - original_t) * 1000.0;
    samples.push(rtt);
    if samples.len() > 10 { samples.drain(0..samples.len()-10); }
    rtt
}

pub fn median_rtt(samples: &[f64]) -> f64 {
    if samples.is_empty() { return 0.0; }
    let mut s = samples.to_vec();
    s.sort_by(f64::total_cmp);
    let mid = s.len() / 2;
    if s.len() % 2 == 0 { (s[mid-1] + s[mid]) / 2.0 } else { s[mid] }
}

pub fn compute_cutoff(
    samples_p1: &[f64],
    samples_p2: &[f64],
    max_delay_ms: f64,
) -> (std::time::Instant, f64, f64) {
    let rtt_a = median_rtt(samples_p1);
    let rtt_b = median_rtt(samples_p2);
    let max_rtt_s = rtt_a.max(rtt_b).min(max_delay_ms) / 1000.0;
    let cutoff = std::time::Instant::now()
        - std::time::Duration::from_secs_f64(max_rtt_s);
    (cutoff, rtt_a, rtt_b)
}
```

Note: `ping.t` in the Python protocol is `time.time()` (Unix float seconds). The Rust server must use the same epoch when computing RTT in `record_pong`. Use `SystemTime::now()` for cross-system time; use `Instant` only for the returned `cutoff` value used in comparisons within the same process.

---

### `engine/engine-core/src/broadcast.rs` (spectator fan-out + FIX-02 snapshot)

**Analog:** `server/broadcast.py` (lines 1-24) — simple loop; Rust replaces manual loop with `tokio::sync::broadcast`.

**Python fan-out** — `server/broadcast.py` lines 9-23:
```python
async def broadcast_to_spectators(room, msg: str) -> None:
    if not room.spectators: return
    dead: set = set()
    for ws in room.spectators:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    if dead:
        room.spectators -= dead
```

**Rust replacement:** Spectators subscribe to `game_tx: broadcast::Sender<String>` and `pose_tx: broadcast::Sender<String>`. The manual dead-connection tracking is replaced by broadcast subscriber lifecycle management. Handle `Err(RecvError::Lagged(n))` non-fatally (Pitfall 2):
```rust
// In spectator WS handler:
// Subscribe BEFORE requesting snapshot to avoid race (Pitfall 6 in RESEARCH.md)
let mut game_rx = game_tx.subscribe();
let mut pose_rx = pose_tx.subscribe();

// Request snapshot from room actor via oneshot
let (reply_tx, reply_rx) = oneshot::channel();
cmd_tx.send(RoomCmd::GetSnapshot { reply: reply_tx }).await?;
let snapshot = reply_rx.await?;

// Send snapshot (FIX-02): lobby_update + round_start (if in progress) + game_state
ws.send(Message::Text(serde_json::to_string(&snapshot.lobby_update)?)).await?;
if let Some(gs) = snapshot.game_state {
    ws.send(Message::Text(serde_json::to_string(&snapshot.round_start)?)).await?;
    ws.send(Message::Text(serde_json::to_string(&gs)?)).await?;
}

// Forward broadcast messages, handle Lagged non-fatally
loop {
    tokio::select! {
        result = game_rx.recv() => match result {
            Ok(msg) => { ws.send(Message::Text(msg)).await?; }
            Err(RecvError::Lagged(n)) => {
                tracing::warn!("spectator lagged by {n} messages, continuing");
                // continue — receiver is auto-repositioned
            }
            Err(RecvError::Closed) => break,
        },
        result = pose_rx.recv() => match result {
            Ok(msg) => { ws.send(Message::Text(msg)).await?; }
            Err(RecvError::Lagged(n)) => { tracing::warn!("pose lag {n}"); }
            Err(RecvError::Closed) => break,
        },
        else => break,
    }
}
```

**FIX-02 snapshot struct** — resolves Open Question 1 from RESEARCH.md (compose existing messages, no new type):
```rust
pub struct RoomSnapshot {
    pub lobby_update: MsgLobbyUpdate,
    pub round_start: Option<MsgRoundStart>,   // Some if match in progress
    pub game_state: Option<MsgGameState>,     // Some if match in progress
}
```
The overlay already handles all three message types idempotently on connect.

**Pose fan-out** — `server/main.py` lines 556-567 (immediate, not in game loop):
```python
# Immediately on pose_frame arrival in ws_player handler:
if room.spectators:
    pose_update_json = MsgPoseUpdate(player=slot_num, keypoints=msg.keypoints).model_dump_json()
    for ws in room.spectators:
        await ws.send_text(pose_update_json)
```
Rust: the WS player handler (not the game actor) calls `pose_tx.send(...)` immediately on `PoseFrame` arrival. No round-trip to the actor needed for pose fan-out (ENG-07).

---

### `engine/engine-core/src/game_loop.rs` (60Hz tick logic, round lifecycle)

**Analog:** `server/game_loop.py` (lines 86-480) — port without hit detection (Phase 1 placeholder).

**Phase 1 scope:** Implement the full game loop skeleton: warmup gate, round timer, `game_state` broadcast, round lifecycle (RoundOver/MatchEnd). Omit `_process_attacker`, `detect_punch`, `detect_kick`, `compute_damage`. This satisfies ENG-04, ENG-09, ENG-10, and allows end-to-end spectator overlay testing.

**Core tick function** — ported from `server/game_loop.py` lines 275-409 with hit detection stubbed:
```python
# server/game_loop.py lines 275-310: warmup check
async def _tick(self) -> None:
    self.tick += 1
    now = time.time()
    if now < self._round_live_at:
        for buf in self._buffers.values(): buf.clear()
        room.round_start_time = self._round_live_at
        ...broadcast game_state with remaining_time=ROUND_DURATION...
        return

    if room.round_start_time is None:
        room.round_start_time = now
    remaining_time = max(0.0, _ROUND_DURATION - (now - room.round_start_time))
    cutoff, rtt_a, rtt_b = compute_cutoff(room)
    # ... drain buffers, run hit detection (Phase 2), check round_over ...
    state = MsgGameState(tick=self.tick, hp=(hp[0],hp[1]), poses=(_EMPTY_POSES,_EMPTY_POSES),
                         recent_hits=[], high_latency=max(rtt_a, rtt_b) > 150,
                         remaining_time=remaining_time, max_wins=room.max_wins)
    await broadcast_to_spectators(self.room, state.model_dump_json())
```

**Constants to port** (from `server/game_loop.py` lines 21-28):
```python
_EMPTY_POSES: list[PoseKeypoint] = []
_ROUND_DURATION = 90.0
_ROUND_WARMUP = 3.8
```
Rust:
```rust
const ROUND_DURATION: f64 = 90.0;
const ROUND_WARMUP: f64 = 3.8;
// _EMPTY_POSES = just send empty Vec<PoseKeypoint> for both slots
```

**GameEvent enum** — D-07 decision; Phase 1 defines the enum shape without commentary variants:
```rust
pub enum GameEvent {
    RoundStart { round_number: u32 },
    RoundOver { winner: Option<u8> },
    MatchEnd { winner: u8 },
    // CommentaryHint { ... } — deferred to Phase 2
}
```

---

### `engine/engine-core/tests/protocol_roundtrip.rs` (PROTO-02 golden-file tests)

**Analog:** No existing test file in the repo. Structure from standard Rust test conventions.

**Pattern from RESEARCH.md (PROTO-02):**
```rust
// tests/protocol_roundtrip.rs
#[cfg(test)]
mod roundtrip {
    use engine_core::protocol::*;
    use std::fs;

    fn fixture(name: &str) -> String {
        fs::read_to_string(format!("tests/fixtures/{name}.json"))
            .expect("fixture file missing — run scripts/capture_fixtures.py first")
    }

    #[test]
    fn msg_pose_frame_roundtrip() {
        let json = fixture("msg_pose_frame");
        let msg: MsgPoseFrame = serde_json::from_str(&json).expect("deserialize");
        let re_serialized = serde_json::to_string(&msg).expect("serialize");
        // Compare key fields, not raw string equality (float formatting may differ)
        let orig: serde_json::Value = serde_json::from_str(&json).unwrap();
        let round: serde_json::Value = serde_json::from_str(&re_serialized).unwrap();
        assert_eq!(orig["type"], round["type"]);
        assert_eq!(orig["keypoints"].as_array().unwrap().len(),
                   round["keypoints"].as_array().unwrap().len());
    }

    #[test]
    fn msg_game_state_roundtrip() { /* same pattern */ }
    // ... one test per fixture file
}
```

Test files live at `engine/engine-core/tests/fixtures/*.json`. Fixtures captured by `scripts/capture_fixtures.py` against the live Python server.

---

### `scripts/capture_fixtures.py` (PROTO-05 golden fixture capture)

**Analog:** `scripts/gen_protocol.py` (role-match: Python script that generates protocol artifacts).

**Pattern from `scripts/gen_protocol.py`** — read from Python server, write output files:
```python
# Rough structure
import json, asyncio, websockets

async def capture():
    # Connect to running Python server
    async with websockets.connect("ws://localhost:8000/ws/player/TESTROOM") as ws:
        # Trigger each message type
        await ws.send(json.dumps({"type": "ping", "t": 1234567890.0}))
        raw = await ws.recv()
        Path("engine/engine-core/tests/fixtures/msg_pong.json").write_text(raw)
        # ... repeat for each message type

asyncio.run(capture())
```

The script connects to the Python server (not the Rust server) to capture authoritative wire format. Requires the Python server to be running locally first.

---

### `Dockerfile` (modified — additive Rust build stage)

**Analog:** Existing `Dockerfile` (lines 1-24) — add one stage before the final Python→Python stage, then replace CMD.

**Existing stages to preserve** — `Dockerfile` lines 1-11:
```dockerfile
FROM node:20-slim AS overlay-builder
...
FROM node:20-slim AS mobile-builder
...
```

**New Rust stage to insert** (after mobile-builder, before final stage):
```dockerfile
FROM rust:1.86-slim AS engine-builder
WORKDIR /engine
COPY engine/ ./
RUN cargo build --release --manifest-path engine-core/Cargo.toml
```

**Modified final stage** (replaces `FROM python:3.11-slim`):
```dockerfile
FROM debian:bookworm-slim
WORKDIR /app
COPY --from=engine-builder /engine/target/release/engine-core ./engine-core
COPY --from=overlay-builder /overlay/dist/ ./overlay/dist/
COPY --from=mobile-builder /mobile/dist/ ./mobile/dist/
CMD ["./engine-core"]
```

Note: Use `rust:1.86-slim` (Debian-based) to match the `debian:bookworm-slim` final image. Do NOT use `rust:alpine` — that would produce a musl binary that cannot run in a glibc image (Pitfall 5 in RESEARCH.md). The Python server dependencies (`requirements.txt`, pip install) are dropped from the final image.

---

## Shared Patterns

### Tracing / Logging
**Source:** Python `server/main.py` lines 48-49 (log setup), lines 485, 573, 597 (call sites)
**Python pattern:**
```python
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)
log.info("Player %d connected to room %s", slot_num, room_code)
log.warning("Player %d bad message: %s", slot_num, exc)
```
**Rust equivalent — apply to all modules:**
```rust
tracing::info!("player {} connected to room {}", slot_num, room_code);
tracing::warn!("bad message from player {}: {}", slot_num, e);
tracing::error!("room actor error: {}", e);
```
Initialize once in `main.rs`:
```rust
tracing_subscriber::fmt::init();
// Or with env filter: tracing_subscriber::EnvFilter::from_default_env()
```

### Log-and-Continue Error Handling (WebSocket receive loop)
**Source:** `server/main.py` lines 538-543
**Python pattern:**
```python
try:
    data = json.loads(raw)
    msg = parse_mobile_msg(data)
except Exception as exc:
    log.warning("Player %d bad message: %s", slot_num, exc)
    continue
```
**Apply to:** `main.rs` WebSocket receive loops (both player and any future admin endpoints).
**Rust pattern:** `Err(e) => { tracing::warn!(...); continue; }` — never propagate parse errors as fatal; never close connection on bad input.

### DashMap Safe Access (no guard across await)
**Source:** RESEARCH.md Pitfall 4 — no Python analog needed (Python is single-threaded async).
**Apply to:** All DashMap operations in `room_manager.rs` and `main.rs`.
**Pattern:** Always clone the value out before the first `.await`:
```rust
// CORRECT
let cmd_tx = rooms.get(&code).map(|h| h.cmd_tx.clone());
drop(/* guard released */);
if let Some(tx) = cmd_tx {
    tx.send(cmd).await.ok();
}

// WRONG — guard held across .await
let guard = rooms.get(&code).unwrap();
guard.cmd_tx.send(cmd).await.ok();  // DEADLOCK
```

### Broadcast Lag Handling (non-fatal)
**Source:** RESEARCH.md Pitfall 2 — no Python analog (Python uses manual set of ws handles).
**Apply to:** All `broadcast::Receiver::recv()` call sites in spectator handlers (`broadcast.rs` / `main.rs`).
**Pattern:** `Err(RecvError::Lagged(n)) => { tracing::warn!("lagged {n}"); /* continue */ }`

### JoinHandle Abort on Room Teardown
**Source:** ENG-13 requirement — no Python analog.
**Apply to:** `room_manager.rs` `retain` closure (expiry task) and any explicit room removal.
**Pattern:**
```rust
rooms.retain(|_code, handle| {
    if handle.is_expired() {
        handle.join_handle.abort();  // ENG-13
        false
    } else { true }
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `engine/engine-core/tests/protocol_roundtrip.rs` | test | batch | No existing test files in the repo at all — pure greenfield |
| `engine/.cargo/config.toml` | config | — | No existing Cargo workspace — `TS_RS_EXPORT_DIR` config is new |

For these files, RESEARCH.md Code Examples provide the authoritative patterns (PROTO-02 section and ts-rs documentation).

---

## Metadata

**Analog search scope:** `server/` (Python port reference), `shared/` (protocol spec), `scripts/`, `Dockerfile`
**Files scanned:** 7 Python source files, 1 TypeScript file, 1 Dockerfile, 1 shell script
**No Rust files exist in the repo yet** — this is a full greenfield Rust implementation; all patterns come from Python analogs.
**Pattern extraction date:** 2026-05-02
