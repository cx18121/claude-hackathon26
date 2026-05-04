# PoseEngine Game SDK

This document is the complete reference for adding a new game to PoseEngine. You only need
one file: implement the `GamePlugin` trait. The engine handles WebSocket transport, room
lifecycle, pose normalization, input-delay fairness, and round management. Your plugin
handles game rules.

If you want to skip directly to code, jump to [Quick-Start Boilerplate](#3-quick-start-boilerplate). If you want to understand how a real game works, read the [Boxing Plugin Walkthrough](#2-boxing-plugin-walkthrough) first.

---

## 1. Trait Interface Reference

The `GamePlugin` trait lives in `engine/plugin-trait/src/lib.rs`. It has seven methods:
five with required implementations and two that are required, plus two optional lifecycle
callbacks that default to no-ops.

```rust
pub trait GamePlugin: Send + Sync {
    fn init_state(&self) -> Box<dyn Any + Send>;
    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;
    fn max_wins(&self) -> u32 { 2 }
    fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}
    fn on_round_reset(&self, _state: &mut dyn Any) {}
}
```

The trait is object-safe (`dyn GamePlugin + Send + Sync` compiles) because:
- No `async fn` methods
- No `-> Self` return types
- No generic type parameters on methods
- All methods take `&self`

The engine stores your plugin as `Arc<dyn GamePlugin + Send + Sync>` and your per-room
state as `Box<dyn Any + Send>`. You own both; the engine never inspects the state contents.

### Method Reference

---

#### `init_state`

```rust
fn init_state(&self) -> Box<dyn Any + Send>;
```

Creates the initial per-room plugin state.

**Called when:** Once at room creation time, before any players join or calibrate.

**Parameters:** None — read construction config from `self`.

**Return:** `Box<dyn Any + Send>` wrapping your state struct. Typically:
```rust
Box::new(MyState { field: initial_value, ... })
```

**Do NOT:** store references, `Rc`, or any non-`'static` types in the state struct.
The `Box<dyn Any + Send>` bound requires `'static + Send`. Store only owned data.
Downcast in each method:
```rust
let s = state.downcast_mut::<MyState>()
    .expect("my-game plugin: state type mismatch");
```

---

#### `on_tick`

```rust
fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;
```

The main game loop callback, called 60 times per second during the live round.

**Called when:** Every tick after warmup ends and both players have calibrated. The engine
gates `on_tick` — it is not called during the warmup period (approximately 3.8 seconds).

**Parameters:**
- `ctx`: All inputs for this tick — player pose frames, timing, and room state. See `TickContext`.
- `state`: Your per-room state box, passed back from `init_state`. Downcast to your type.

**Return:** `Vec<GameEvent>` — the complete list of side-effects for this tick. Return an
empty vec if nothing happened this tick.

**Do NOT:** make network calls, block the thread, or store references from `ctx` into plugin
state. The frame borrow ends after `on_tick` returns. Do not panic on empty frame slices —
`ctx.frames[slot]` may be empty if a player is lagging.

**Key pattern — round-ended guard:**
```rust
fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
    let s = state.downcast_mut::<MyState>().expect("type mismatch");
    if s.round_ended { return vec![]; }  // guard: never emit RoundOver twice
    // ... rest of game logic
}
```

---

#### `max_wins`

```rust
fn max_wins(&self) -> u32 { 2 }
```

Returns the number of round wins required to win the overall match.

**Called when:** Once at room creation, to configure the win counter.

**Parameters:** None.

**Return:** Win count. Default is 2 (best-of-3). Override to use a config field:
```rust
fn max_wins(&self) -> u32 { self.config.max_wins }
```

**Do NOT:** return 0 — the engine would end the match before the first round starts.

---

#### `on_player_join`

```rust
fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}
```

Called when a player's WebSocket connects to the room.

**Called when:** Each time a player connects via `/ws/player/{code}`. May be called
multiple times if a player disconnects and reconnects mid-match.

**Parameters:**
- `slot`: 0-indexed (0 = player 1, 1 = player 2).
- `state`: Your per-room state box.

**Return:** Nothing (unit).

**Do NOT:** start game logic here. Wait for `on_calibration_complete`, which signals
the player is ready.

The default implementation is a no-op. Boxing overrides it only to log the join.

---

#### `on_player_leave`

```rust
fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}
```

Called when a player's WebSocket disconnects from the room.

**Called when:** Each time a player's connection closes, whether graceful or a network drop.

**Parameters:**
- `slot`: 0-indexed (0 = player 1, 1 = player 2).
- `state`: Your per-room state box.

**Return:** Nothing (unit).

**Do NOT:** clear calibration state here. Calibration data (`ref_vel`, `reference_velocity`)
must persist for the full room lifetime through rematches (FIX-01). Only `init_state` resets
calibration to zero.

Do not emit `RoundOver` from this method — the return type is `()`. If you need walk-over
logic for a disconnect, handle it in `on_tick` by checking `ctx.room.solo_mode`.

---

#### `on_calibration_complete`

```rust
fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}
```

Called after the engine records a player's calibration velocity.

**Called when:** After a player sends `CalibrationDone` from the mobile client, and the
engine has stored `reference_velocity` on the player slot. Called once per player per room
session — calibration persists through rematches (FIX-01).

**Parameters:**
- `slot`: 0-indexed (0 = player 1, 1 = player 2).
- `ref_vel`: Reference velocity in metres per second (typical range 0.5–15.0 m/s).
- `state`: Your per-room state box.

**Return:** Nothing (unit).

**Typical implementation — boxing clamping (D-08):**
```rust
fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
    let s = state.downcast_mut::<BoxingState>().expect("type mismatch");
    // D-08: clamp to [0.5, 15.0] — prevents near-zero ref (phantom hits) and extreme ref (all-miss)
    s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);
}
```

**Dance plugin approach:** The signal still fires (it serves as "player is ready to start"),
but the dance plugin ignores `ref_vel` entirely — no velocity-based scoring. In that case,
use the trait default no-op.

**Do NOT:** clear calibration in `on_round_reset`. The FIX-01 regression in
`server/rooms.py:64` cleared `reference_velocity = None` on rematch — that is the bug
this design explicitly prevents.

---

#### `on_round_reset`

```rust
fn on_round_reset(&self, _state: &mut dyn Any) {}
```

Called after a round ends and before the next round starts.

**Called when:** After the engine broadcasts `MsgRoundEnd` and increments the win counter.
Triggered when your `on_tick` returns a `GameEvent::RoundOver`.

**Parameters:**
- `state`: Your per-room state box.

**Return:** Nothing (unit).

**Contract — what to clear and what to keep:**
- CLEAR: round-scoped state — HP, cooldowns, combo counters, score accumulators, beat counters, round flags.
- KEEP: calibration data (`ref_vel`, any derived per-player constants) — it must survive rematches.

**Boxing example:**
```rust
fn on_round_reset(&self, state: &mut dyn Any) {
    let s = state.downcast_mut::<BoxingState>().expect("type mismatch");
    // FIX-01: clear ONLY round-scoped state. DO NOT touch ref_vel.
    s.hp = [self.config.hp; 2];
    s.last_hit_tick = [-999; 2];
    s.combo = [(0.0, 0); 2];
    s.low_hp_announced = [false; 2];
    s.first_blood_pending = true;
    // ref_vel intentionally NOT reset
}
```

**Do NOT:** emit events here — the return type is `()`.

---

### Type Reference

#### `TickContext<'a>`

All inputs delivered to the plugin for one 60Hz tick.

```rust
pub struct TickContext<'a> {
    pub frames: [&'a VecDeque<PoseFrame>; 2],
    pub tick_info: TickInfo,
    pub room: RoomView,
}
```

- `frames[0]`: Released pose frames for player 1 this tick. May be empty (player lagging).
- `frames[1]`: Released pose frames for player 2 this tick.
- `tick_info`: Timing for this tick (see `TickInfo`).
- `room`: Read-only room state (see `RoomView`).

Frames are normalized to hip-centred Y-up by the engine before delivery (PLUG-06).
Frames have already passed the RTT fairness input-delay buffer.

The `'a` lifetime ties `frames` to the engine's per-tick deque. Do NOT store `ctx.frames`
or any reference from it in your plugin state — the borrow ends after `on_tick` returns.

---

#### `TickInfo`

```rust
pub struct TickInfo {
    pub tick: u64,
    pub elapsed_secs: f64,
    pub remaining_secs: f64,
}
```

- `tick`: Integer counter, incremented by 1 every 60Hz tick from match start. Use this
  for beat clocks and frame counting — it is exact. Note: the tick counter is nonzero at
  round start (the engine has been ticking since before the warmup ended). Capture the
  start tick on first `on_tick` call.
- `elapsed_secs`: Float seconds since round start. Use for duration comparisons.
- `remaining_secs`: Float seconds until round time limit. ≤ 0.0 when time expires.

---

#### `RoomView`

```rust
pub struct RoomView {
    pub slots: [SlotView; 2],
    pub solo_mode: bool,
}
```

- `slots`: Views for player 1 (index 0) and player 2 (index 1).
- `solo_mode`: `true` if the match started in solo/bot mode. Set once at match start
  from the calibration event — do NOT re-derive from `slots[1].connected`. A mid-match
  disconnect would incorrectly trigger solo logic (WR-01 anti-pattern).

---

#### `SlotView`

```rust
pub struct SlotView {
    pub connected: bool,
    pub reference_velocity: Option<f64>,
}
```

- `connected`: `true` if the player's WebSocket is currently open.
- `reference_velocity`: `None` until the player submits `CalibrationDone`. `Some(f64)`
  afterwards — persists through rematches (FIX-01).

---

#### `PoseKeypoint`

```rust
pub struct PoseKeypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub visibility: f64,
}
```

A single MediaPipe pose landmark. The engine normalizes all frames to hip-centred Y-up
before delivery (PLUG-06):
- Origin (0, 0) = midpoint between the player's two hips.
- Positive Y = above the hips. Nose y ≈ +0.80, shoulders y ≈ +0.35, ankles y ≈ -0.90.
- `z` is near-zero for 2D MediaPipe — safe to ignore.
- `visibility` ∈ [0.0, 1.0]. Discard landmarks with `visibility < 0.5` as unreliable.

Do NOT assume raw MediaPipe Y-down coordinates. The engine applies `normalize_to_y_up`
before any plugin sees the data.

---

#### `PoseFrame`

```rust
pub struct PoseFrame {
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}
```

A snapshot of 33 MediaPipe landmarks for one player at one instant. Already normalized to
hip-centred Y-up. Use `.back()` on the `VecDeque<PoseFrame>` for the most recent frame,
or iterate all frames for velocity/motion calculations.

---

#### `BodyRegion`

```rust
pub enum BodyRegion {
    HeadFace, HeadChin, HeadThroat,
    TorsoUpper, TorsoLower,
    BlockHand, BlockForearm,
    LegThigh, LegShin,
}
```

Nine body regions for hit classification. Use `region.to_wire()` to get the snake_case
JSON string (`"head_face"`, `"torso_upper"`, etc.). Do NOT use `format!("{:?}", r).to_lowercase()` —
Debug emits PascalCase that collapses incorrectly (CR-05).

---

#### `GameEvent`

```rust
pub enum GameEvent {
    Hit { attacker: u8, defender: u8, region: BodyRegion, damage: f32, position: [f32; 2] },
    RoundOver { winner: Option<u8> },
    SendToPlayer { slot: u8, payload: Value },
    Broadcast { payload: Value },
    CommentaryHint { kind: String, payload: Value },
}
```

All side-effects a plugin can produce in a single `on_tick` call. The engine dispatches
all events after `on_tick` returns — not during.

- `Hit`: Triggers HP damage broadcast and overlay visual effect. `attacker` and `defender`
  are 1-indexed (1 = player 1, 2 = player 2).
- `RoundOver`: `winner = Some(1)` or `Some(2)` for a win; `None` for a draw. Emit at
  most once per round — use a `round_ended` bool in your state.
- `SendToPlayer`: `slot` is 1-indexed. Delivers `payload` JSON to one player's channel.
- `Broadcast`: Delivers `payload` JSON to the room's slow-path channel — all connected
  clients including spectators.
- `CommentaryHint`: No-op in v1. Will be consumed by the v2 commentary engine (COMM-01).

---

## 2. Boxing Plugin Walkthrough

This section walks through the boxing plugin implementation method by method. Source:
`engine/boxing-plugin/src/lib.rs`.

The boxing plugin is the canonical worked example. Source: `engine/boxing-plugin/src/lib.rs`.

The dance scoring plugin (`engine/dance-plugin/src/lib.rs`) implements the same 7-method
interface — no HP, no hit detection, beat-gated scoring — and required zero engine changes (GAME2-02).

### Config and State (boxing-plugin/src/lib.rs lines 26–56)

`BoxingConfig` holds construction-time constants (hp, round_secs, max_wins, bot_difficulty)
passed to `BoxingPlugin::new`. Immutable for the plugin lifetime (`&self` on all methods).

`BoxingState` holds per-room mutable state: `hp [u32; 2]`, `ref_vel [f64; 2]` (calibration),
`last_hit_tick [i64; 2]` (-999 sentinel = never hit), combo trackers, flags. All fields
are owned types — `Box<dyn Any + Send>` requires `'static + Send`.

### `init_state` (boxing-plugin/src/lib.rs lines 77–87)

```rust
fn init_state(&self) -> Box<dyn Any + Send> {
    Box::new(BoxingState {
        hp: [self.config.hp; 2],
        ref_vel: [0.0; 2],
        last_hit_tick: [-999; 2],  // -999 = never hit; 0 would falsely trigger cooldown
        combo: [(0.0, 0); 2],
        low_hp_announced: [false; 2],
        first_blood_pending: true,
        bot_next_hit_at: 0.0,
    })
}
```

`ref_vel` starts at `[0.0; 2]` until `on_calibration_complete` fires. Hit detection checks
`s.ref_vel[attacker_idx] > 0.0` before computing damage — `0.0` means "not calibrated yet."

### `on_tick` (boxing-plugin/src/lib.rs lines 89–176)

The `on_tick` method has three sections: bot mode, hit detection, and round-over check.

**Bot mode check (lines 96–113):**

```rust
let solo_mode = ctx.room.solo_mode;
if solo_mode {
    let mut bot_events = bot::tick_bot(
        self.config.bot_difficulty,
        &mut s.bot_next_hit_at,
        ctx.tick_info.elapsed_secs,
    );
    // Apply HP damage from bot Hit events
    for ev in &bot_events {
        if let GameEvent::Hit { defender, damage, .. } = ev {
            let idx = (defender - 1) as usize;
            s.hp[idx] = s.hp[idx].saturating_sub(*damage as u32);
        }
    }
    events.append(&mut bot_events);
}
```

`ctx.room.solo_mode` is read from `RoomView` — set once at match start, not re-derived per
tick. A mid-match disconnect from player 2 must NOT trigger bot mode (WR-01 pattern).

**Hit detection loop (lines 116–168):**

```rust
for (attacker_idx, defender_idx) in [(0usize, 1usize), (1, 0)] {
    // BOX-07: 12-tick cooldown — prevents the same attacker from registering multiple
    // hits faster than 200ms
    if (ctx.tick_info.tick as i64) - s.last_hit_tick[attacker_idx] < HIT_COOLDOWN_TICKS {
        continue;
    }

    let ref_vel = if s.ref_vel[attacker_idx] > 0.0 {
        Some(s.ref_vel[attacker_idx])
    } else {
        None
    };

    // In bot mode, slot 2 is the bot — skip its attacker path
    if solo_mode && attacker_idx == 1 {
        continue;
    }

    let hit = hit_detection::detect_punch(
        ctx.frames[attacker_idx],
        ctx.frames[defender_idx],
        ref_vel,
    ).or_else(|| hit_detection::detect_kick( ... ));

    if let Some(h) = hit {
        let dmg = damage::compute_damage(h.region.clone(), h.velocity, ref_vel);
        s.hp[defender_idx] = s.hp[defender_idx].saturating_sub(dmg);
        s.last_hit_tick[attacker_idx] = ctx.tick_info.tick as i64;
        events.push(GameEvent::Hit { ... });
        events.push(GameEvent::SendToPlayer { slot: ..., payload: json!({ "type": "you_were_hit", ... }) });
    }
}
```

The hit detection functions (`detect_punch`, `detect_kick`) live in
`engine/boxing-plugin/src/hit_detection.rs` and take `ctx.frames[slot]` directly.

**Round-over check (lines 170–175):**

```rust
if let Some(ev) = check_round_over(&s.hp, ctx.tick_info.remaining_secs) {
    events.push(ev);
}
```

`check_round_over` (lines 220–234): KO fires if either HP reaches 0; time limit fires if
`remaining_secs <= 0.0`, winner decided by HP (equal HP = draw/`None`).

### `on_calibration_complete` (boxing-plugin/src/lib.rs lines 178–183)

```rust
fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
    let s = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
    // D-08: clamp to [0.5, 15.0]
    s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);
}
```

Values below 0.5 m/s (motionless arm) cause phantom hits; above 15.0 m/s (sensor artifact)
cause all-miss. [0.5, 15.0] is the valid range for human punch velocity (D-08).
The clamped value is stored in `s.ref_vel[slot]` — the plugin state is the authoritative copy.

### `on_round_reset` (boxing-plugin/src/lib.rs lines 185–197)

```rust
fn on_round_reset(&self, state: &mut dyn Any) {
    let s = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
    // FIX-01: clear ONLY round-scoped state. DO NOT touch ref_vel.
    s.hp = [self.config.hp; 2];
    s.last_hit_tick = [-999; 2];
    s.combo = [(0.0, 0); 2];
    s.low_hp_announced = [false; 2];
    s.first_blood_pending = true;
    // bot_next_hit_at is intentionally NOT reset
}
```

The comment "DO NOT touch ref_vel" documents the FIX-01 regression: the original Python
server at `server/rooms.py:64` called `slot.reference_velocity = None` inside
`reset_for_rematch`. This forced every player to re-calibrate before each rematch, breaking
the "one calibration per session" UX promise. The Rust engine and all plugins must never
replicate this mistake.

`bot_next_hit_at` is intentionally not reset because the bot continues its hit timer across
the round break — matching the original Python `_tick_bot` behavior.

### `max_wins` (boxing-plugin/src/lib.rs lines 199–201)

```rust
fn max_wins(&self) -> u32 {
    self.config.max_wins
}
```

Returns the config value passed at construction. Boxing uses 3 (best-of-5 rounds) by
default, set in `engine/engine-core/src/main.rs`.

### `on_player_join` / `on_player_leave` (boxing-plugin/src/lib.rs lines 203–213)

```rust
fn on_player_join(&self, slot: u8, state: &mut dyn Any) {
    let _ = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
    tracing::info!("boxing: player {} joined", slot + 1);
}

fn on_player_leave(&self, slot: u8, state: &mut dyn Any) {
    let _ = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
    tracing::info!("boxing: player {} left", slot + 1);
}
```

Boxing overrides these only to log. The `let _ = state.downcast_mut...` is a defensive
downcast that validates the state type at runtime even when no fields are read.
Most new plugins should use the trait defaults (no-op) for these methods.

---

## 3. Quick-Start Boilerplate

Copy this skeleton to implement a new game. Replace `MyGame`, `MyConfig`, and `MyState`
with your game's types.

```rust
// engine/my-game-plugin/Cargo.toml:
//
// [package]
// name = "my-game-plugin"
// version = "0.1.0"
// edition = "2021"
//
// [lib]
// name = "my_game_plugin"
// path = "src/lib.rs"
//
// [dependencies]
// plugin-trait = { path = "../plugin-trait" }
// serde_json = "1.0.149"

use std::any::Any;
use plugin_trait::{GamePlugin, GameEvent, TickContext};
use serde_json::json;

// ---------------------------------------------------------------------------
// Config — construction-time constants for this game.
// Passed to MyGame::new in engine-core/src/main.rs.
// ---------------------------------------------------------------------------

pub struct MyConfig {
    pub max_wins: u32,
}

// ---------------------------------------------------------------------------
// State — per-room mutable state stored as Box<dyn Any + Send>.
// All fields must be owned (no references) — required for 'static + Send bound.
// ---------------------------------------------------------------------------

pub struct MyState {
    // Add your game's per-round state here.
    pub round_started: bool,
    pub round_ended: bool,
    // NOTE: Do NOT add calibration/velocity fields here unless your game needs them.
    //       If you do add them, they must NOT be cleared in on_round_reset (FIX-01).
}

// ---------------------------------------------------------------------------
// Plugin struct — immutable after construction (config lives here, not in state).
// ---------------------------------------------------------------------------

pub struct MyGame {
    config: MyConfig,
}

impl MyGame {
    pub fn new(config: MyConfig) -> Self {
        Self { config }
    }
}

// ---------------------------------------------------------------------------
// GamePlugin implementation
// ---------------------------------------------------------------------------

impl GamePlugin for MyGame {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(MyState {
            round_started: false,
            round_ended: false,
        })
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<MyState>()
            .expect("my-game plugin: state type mismatch");

        // Guard: never emit RoundOver more than once per round.
        if s.round_ended { return vec![]; }

        let mut events = Vec::new();

        // Lock round_start_tick on the first on_tick call.
        // IMPORTANT: do NOT use 0 as the origin — ctx.tick_info.tick is nonzero at round start.
        if !s.round_started {
            s.round_started = true;
            // store ctx.tick_info.tick if you need a beat clock:
            //   s.round_start_tick = ctx.tick_info.tick;
        }

        // ---- Your game logic here ----
        //
        // Access player pose frames:
        //   ctx.frames[0]  — VecDeque<PoseFrame> for player 1 (empty if lagging)
        //   ctx.frames[1]  — VecDeque<PoseFrame> for player 2
        //   ctx.frames[0].back()  — most recent PoseFrame for player 1
        //
        // Beat clock example (1-second beats at 60Hz):
        //   let elapsed = ctx.tick_info.tick.saturating_sub(s.round_start_tick);
        //   if elapsed > 0 && elapsed % 60 == 0 { /* beat fired */ }
        //
        // Solo mode — skip player 2 logic when only one player is present:
        //   if ctx.room.solo_mode { /* handle single-player */ }
        //
        // Emit events:
        //   events.push(GameEvent::Broadcast { payload: json!({ "type": "my_event", ... }) });
        //   events.push(GameEvent::SendToPlayer { slot: 1, payload: json!({ ... }) });
        //
        // End the round:
        //   s.round_ended = true;
        //   events.push(GameEvent::RoundOver { winner: Some(1) });

        events
    }

    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<MyState>()
            .expect("my-game plugin: state type mismatch");
        // Clear ONLY round-scoped state.
        // DO NOT clear calibration data if your game stores any — it must survive rematches (FIX-01).
        s.round_started = false;
        s.round_ended = false;
    }

    fn max_wins(&self) -> u32 {
        self.config.max_wins
    }

    // on_calibration_complete, on_player_join, on_player_leave:
    // Use trait default no-ops unless your game specifically needs them.
    //
    // If your game is velocity-based like boxing, override on_calibration_complete:
    //
    //   fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
    //       let s = state.downcast_mut::<MyState>().expect("type mismatch");
    //       s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);  // D-08 clamping
    //   }
}
```

---

## 4. Registering Your Plugin

Adding a new game plugin requires two files and no changes to the engine internals.

### Step 1 — Add the crate to the workspace

Edit `engine/Cargo.toml` to include your new crate:

```toml
[workspace]
members = [
    "engine-core",
    "plugin-trait",
    "boxing-plugin",
    "dance-plugin",
    "my-game-plugin",   # add this line
]
resolver = "2"
```

### Step 2 — Add the dependency and register the plugin

Edit `engine/engine-core/Cargo.toml` to add your crate as a dependency:

```toml
[dependencies]
# ... existing deps ...
my-game-plugin = { path = "../my-game-plugin" }
```

Then in `engine/engine-core/src/main.rs`, import your types and insert into the plugin registry:

```rust
use my_game_plugin::{MyGame, MyConfig};

// In main():
let my_config = MyConfig { max_wins: 3 };
plugins.insert("my-game".to_string(), Arc::new(MyGame::new(my_config)));
```

The plugin registry is a `HashMap<String, Arc<dyn GamePlugin + Send + Sync>>` built before
`Arc::new(AppState { ... })`. Both boxing and dance are already registered there.

### Step 3 — Create a room with your game

Once registered, your game is immediately available via the HTTP API:

```
POST /rooms?game=my-game
```

Response:
```json
{ "room_code": "XYZ123" }
```

Players then connect via the existing WebSocket endpoint:

```
ws://host/ws/player/XYZ123
```

Almost done. The game lobby at `/` (GET) does **not** update automatically — you must manually
add a button to the `LOBBY_HTML` constant in `engine/engine-core/src/main.rs`. That is the only
engine file you need to touch. The engine handles everything else.

