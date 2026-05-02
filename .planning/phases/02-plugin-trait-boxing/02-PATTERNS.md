# Phase 2: Plugin Trait + Boxing - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 9
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `engine/plugin-trait/src/lib.rs` | trait-definition | request-response | `engine/engine-core/src/game_loop.rs` (GameEvent) + `engine/engine-core/src/room.rs` (data shapes) | role-match |
| `engine/boxing-plugin/src/lib.rs` | service/plugin | event-driven | `engine/engine-core/src/game_loop.rs` (GameLoop logic) | role-match |
| `engine/boxing-plugin/src/hit_detection.rs` | utility | transform | `server/hit_detection.py` (direct port) | exact |
| `engine/boxing-plugin/src/damage.rs` | utility | transform | `server/damage.py` (direct port) | exact |
| `engine/boxing-plugin/src/bot.rs` | utility | event-driven | `server/game_loop.py` `_tick_bot` + `_BOT_KPS` (direct port) | exact |
| `engine/Cargo.toml` | config | — | existing `engine/Cargo.toml` + `engine/engine-core/Cargo.toml` | exact |
| `engine/engine-core/src/main.rs` | config/wiring | request-response | existing `engine/engine-core/src/main.rs` (AppState construction) | exact |
| `engine/engine-core/src/game_loop.rs` | service | event-driven | existing `engine/engine-core/src/game_loop.rs` | exact |
| `engine/engine-core/src/room.rs` | model/actor | event-driven | existing `engine/engine-core/src/room.rs` | exact |

---

## Pattern Assignments

### `engine/plugin-trait/src/lib.rs` (trait-definition, request-response)

**Analog:** `engine/engine-core/src/game_loop.rs` (GameEvent shape, lines 193–199) and `engine/engine-core/src/room.rs` (PlayerSlot/RoomState data shapes, lines 7–43) and `engine/engine-core/src/protocol.rs` (PoseKeypoint, lines 8–15)

**Crate structure — new lib crate, no binary, no async deps:**
```toml
# engine/plugin-trait/Cargo.toml
[package]
name = "plugin-trait"
version = "0.1.0"
edition = "2021"

[lib]
name = "plugin_trait"
path = "src/lib.rs"

[dependencies]
serde = { version = "1.0.228", features = ["derive"] }
serde_json = "1.0.149"
```

**Imports pattern — follows engine-core's minimal std + serde style:**
```rust
// Copy from engine-core/src/protocol.rs line 1 (serde imports)
// Copy from engine-core/src/room.rs line 1 (std collections)
use std::any::Any;
use std::collections::VecDeque;
use serde_json::Value;
```

**GameEvent enum — replaces the 3-variant Phase 1 version in game_loop.rs lines 194–199:**

The Phase 1 analog at `engine/engine-core/src/game_loop.rs` lines 193–199:
```rust
pub enum GameEvent {
    RoundStart { round_number: u32 },
    RoundOver { winner: Option<u8> },
    MatchEnd { winner: u8 },
    // CommentaryHint { ... } — deferred to Phase 2
}
```

Phase 2 replaces this entirely with the plugin-trait crate version (D-03):
```rust
#[derive(Debug, Clone)]
pub enum BodyRegion {
    HeadFace, HeadChin, HeadThroat,
    TorsoUpper, TorsoLower,
    BlockHand, BlockForearm,
    LegThigh, LegShin,
}

#[derive(Debug)]
pub enum GameEvent {
    Hit { attacker: u8, defender: u8, region: BodyRegion, damage: f32, position: [f32; 2] },
    RoundOver { winner: Option<u8> },
    SendToPlayer { slot: u8, payload: Value },
    Broadcast { payload: Value },
    CommentaryHint { kind: String, payload: Value },
}
```

**Context structs — follow PlayerSlot / RoomState field naming from room.rs lines 7–43:**

`PlayerSlot` in `engine/engine-core/src/room.rs` lines 7–14 provides the source of truth for what fields exist:
```rust
pub struct PlayerSlot {
    pub tx: Option<mpsc::Sender<String>>,
    pub reference_velocity: Option<f64>,
    pub connected: bool,
    pub rtt_samples: Vec<f64>,
    pub pose_buffer: VecDeque<(Instant, MsgPoseFrame)>,
    pub processed_frames: VecDeque<MsgPoseFrame>,
}
```

`PoseKeypoint` in `engine/engine-core/src/protocol.rs` lines 8–15 uses `f64` fields. The plugin-trait `PoseKeypoint` should use `f64` to match (not `f32`):
```rust
#[derive(Clone, Debug)]
pub struct PoseKeypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub visibility: f64,
}

pub struct PoseFrame {
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}

pub struct SlotView {
    pub connected: bool,
    pub reference_velocity: Option<f64>,
}

pub struct RoomView {
    pub slots: [SlotView; 2],
}

pub struct TickInfo {
    pub tick: u64,
    pub elapsed_secs: f64,
    pub remaining_secs: f64,
}

pub struct TickContext<'a> {
    pub frames: [&'a VecDeque<PoseFrame>; 2],
    pub tick_info: TickInfo,
    pub room: RoomView,
}
```

**Object-safe trait — CRITICAL constraint (PLUG-05):**
```rust
pub trait GamePlugin: Send {
    fn init_state(&self) -> Box<dyn Any + Send>;

    fn on_tick(
        &self,
        ctx: &TickContext,
        state: &mut dyn Any,
    ) -> Vec<GameEvent>;

    // Default no-ops — implementors override only what they need
    fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}
    fn on_round_reset(&self, _state: &mut dyn Any) {}
}
```
Anti-patterns to avoid: no `async fn`, no `-> Self`, no generic type parameters on methods. All confirmed via RESEARCH.md Pattern 1.

---

### `engine/boxing-plugin/src/lib.rs` (service/plugin, event-driven)

**Analog:** `engine/engine-core/src/game_loop.rs` (full tick logic, event construction) and `server/game_loop.py` GameLoop class (lines 86–479, port reference)

**Crate structure:**
```toml
# engine/boxing-plugin/Cargo.toml
[package]
name = "boxing-plugin"
version = "0.1.0"
edition = "2021"

[lib]
name = "boxing_plugin"
path = "src/lib.rs"

[dependencies]
plugin-trait = { path = "../plugin-trait" }
serde_json = "1.0.149"
rand = "0.8.6"
```

**Imports pattern:**
```rust
use std::any::Any;
use plugin_trait::{GamePlugin, GameEvent, TickContext, BodyRegion};
use serde_json::json;
mod hit_detection;
mod damage;
mod bot;
```

**Config and state structs — follow engine-core's plain struct + array style (room.rs lines 29–43):**

`RoomState` in `engine/engine-core/src/room.rs` lines 29–43 shows the field naming and array style. `BoxingState` is the plugin-owned analog:
```rust
pub struct BoxingConfig {
    pub hp: u32,
    pub round_secs: f64,
    pub max_wins: u32,
    pub bot_difficulty: bot::Difficulty,
}

// All fields owned (no references) — required for Box<dyn Any + Send> ('static bound)
// Copy pattern from RESEARCH.md Pattern 2
pub struct BoxingState {
    pub hp: [u32; 2],
    pub ref_vel: [f64; 2],           // clamped copy; NOT cleared in on_round_reset (FIX-01)
    pub last_hit_tick: [i64; 2],     // -999 sentinel matches server/game_loop.py line 110
    pub combo: [(f64, u32); 2],      // (last_hit_time, count)
    pub low_hp_announced: [bool; 2],
    pub first_blood_pending: bool,
    pub bot_next_hit_at: f64,
}
```

**init_state pattern — follows RESEARCH.md Pattern 2:**
```rust
impl GamePlugin for BoxingPlugin {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(BoxingState {
            hp: [self.config.hp; 2],
            ref_vel: [0.0; 2],
            last_hit_tick: [-999; 2],
            combo: [(0.0, 0); 2],
            low_hp_announced: [false; 2],
            first_blood_pending: true,
            bot_next_hit_at: 0.0,
        })
    }
```

**Downcast pattern — copy from RESEARCH.md Pattern 2 (derived from std::any::Any):**
```rust
    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch");
        let mut events: Vec<GameEvent> = Vec::new();
        // ... boxing logic
        events
    }
```

**on_calibration_complete — clamp pattern (D-08):**
```rust
    fn on_calibration_complete(&self, slot: u8, ref_vel: f64, state: &mut dyn Any) {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch");
        // Clamp 0.5..=15.0 — per D-08 and CONCERNS.md line 68
        s.ref_vel[slot as usize] = ref_vel.clamp(0.5, 15.0);
    }
```

**on_round_reset — FIX-01 correct implementation (D-07):**

The bug is at `server/rooms.py` line 64: `slot.reference_velocity = None`. The Rust implementation must NOT replicate that. Copy this pattern:
```rust
    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<BoxingState>()
            .expect("boxing plugin: state type mismatch");
        // ONLY clear round-scoped state. DO NOT touch s.ref_vel — FIX-01.
        s.hp = [self.config.hp; 2];
        s.last_hit_tick = [-999; 2];
        s.combo = [(0.0, 0); 2];
        s.low_hp_announced = [false; 2];
        s.first_blood_pending = true;
        // bot_next_hit_at set by first tick of new round
    }
```

**on_tick hit processing — follows server/game_loop.py _process_attacker (lines 178–229):**

Python pattern to port:
```python
# server/game_loop.py lines 192–196
if self.tick - self._last_hit_tick[attacker] < _HIT_COOLDOWN_TICKS:
    return []
ref_vel = room.players[attacker].reference_velocity
result = detect_punch(a_frames, d_frames, ref_vel) or detect_kick(a_frames, d_frames, ref_vel)
```

Rust port pattern (using `ctx.frames[attacker_idx]` from TickContext):
```rust
// _HIT_COOLDOWN_TICKS = 12 from server/game_loop.py line 22
const HIT_COOLDOWN_TICKS: i64 = 12;

for (attacker, defender) in [(0usize, 1usize), (1, 0)] {
    if ctx.tick_info.tick as i64 - s.last_hit_tick[attacker] < HIT_COOLDOWN_TICKS {
        continue;
    }
    let ref_vel = if s.ref_vel[attacker] > 0.0 { Some(s.ref_vel[attacker]) } else { None };
    if let Some(hit) = hit_detection::detect_punch(ctx.frames[attacker], ctx.frames[defender], ref_vel)
        .or_else(|| hit_detection::detect_kick(ctx.frames[attacker], ctx.frames[defender], ref_vel))
    {
        let dmg = damage::compute_damage(hit.region, hit.velocity, ref_vel);
        s.hp[defender] = s.hp[defender].saturating_sub(dmg);
        s.last_hit_tick[attacker] = ctx.tick_info.tick as i64;
        // emit commentary hint
        emit_commentary_hint(&mut events, s, attacker, defender, hit.region, dmg, ctx.tick_info.elapsed_secs);
        events.push(GameEvent::Hit {
            attacker: (attacker + 1) as u8,
            defender: (defender + 1) as u8,
            region: hit.region,
            damage: dmg as f32,
            position: [hit.position.0 as f32, hit.position.1 as f32],
        });
        events.push(GameEvent::SendToPlayer {
            slot: (defender + 1) as u8,
            payload: json!({ "type": "you_were_hit", "region": format!("{:?}", hit.region), "damage": dmg }),
        });
    }
}
```

**CommentaryHint emission — follows server/game_loop.py _emit_hit_commentary lines 415–479:**
```rust
fn emit_commentary_hint(
    events: &mut Vec<GameEvent>,
    s: &mut BoxingState,
    attacker: usize,
    defender: usize,
    region: BodyRegion,
    damage: u32,
    elapsed: f64,
) {
    // Combo tracking: server/game_loop.py lines 430-437
    let (last_t, count) = s.combo[attacker];
    let count = if elapsed - last_t <= 1.8 { count + 1 } else { 1 };
    s.combo[attacker] = (elapsed, count);
    s.combo[defender] = (0.0, 0); // reset opponent combo on being hit

    let defender_hp_pct = s.hp[defender] as f64 / 800.0;
    let attacker_hp_pct = s.hp[attacker] as f64 / 800.0;

    let kind = if s.first_blood_pending {
        s.first_blood_pending = false;
        "first_blood"
    } else if count >= 3 {
        "combo"
    } else if attacker_hp_pct < 0.3 && defender_hp_pct >= attacker_hp_pct {
        "comeback"
    } else if defender_hp_pct <= 0.25 && !s.low_hp_announced[defender] {
        s.low_hp_announced[defender] = true;
        "low_hp"
    } else {
        "hit"
    };

    events.push(GameEvent::CommentaryHint {
        kind: kind.to_string(),
        payload: json!({
            "attacker": attacker + 1,
            "defender": defender + 1,
            "damage": damage,
            "combo_count": if kind == "combo" { count } else { 0 },
        }),
    });
}
```

**Round-over check — follows server/game_loop.py _check_round_over lines 258–273:**
```rust
fn check_round_over(hp: &[u32; 2], remaining_secs: f64) -> Option<GameEvent> {
    if hp[0] == 0 { return Some(GameEvent::RoundOver { winner: Some(2) }); }
    if hp[1] == 0 { return Some(GameEvent::RoundOver { winner: Some(1) }); }
    if remaining_secs <= 0.0 {
        let winner = match hp[0].cmp(&hp[1]) {
            std::cmp::Ordering::Greater => Some(1),
            std::cmp::Ordering::Less => Some(2),
            std::cmp::Ordering::Equal => None, // draw
        };
        return Some(GameEvent::RoundOver { winner });
    }
    None
}
```

---

### `engine/boxing-plugin/src/hit_detection.rs` (utility, transform)

**Analog:** `server/hit_detection.py` — direct port. All constants and functions extracted.

**Imports pattern — pure Rust, no external crates:**
```rust
use std::collections::VecDeque;
use plugin_trait::{PoseKeypoint, PoseFrame, BodyRegion};
```

**Public output type (mirrors Python HitResult dataclass, lines 56–61):**
```rust
pub struct HitResult {
    pub region: BodyRegion,
    pub velocity: f64,
    pub position: (f64, f64),  // (x, y) in normalized space; z omitted (2D display)
}
```

**Landmark index constants — from server/hit_detection.py lines 19–27:**
```rust
const WRIST_LEFT: usize  = 15;
const WRIST_RIGHT: usize = 16;
const ANKLE_LEFT: usize  = 27;
const ANKLE_RIGHT: usize = 28;
const LEFT_HIP: usize    = 23;
const RIGHT_HIP: usize   = 24;
const LEFT_SHOULDER: usize  = 11;
const RIGHT_SHOULDER: usize = 12;
```

**Body-local threshold constants — from server/hit_detection.py lines 30–41:**
```rust
const REL_HEAD_Y: f64      = 1.45;
const REL_TORSO_HI_Y: f64  = 0.70;
const REL_TORSO_LO_Y: f64  = 0.00;
const REL_KICK_MID_Y: f64  = -0.30;
const REL_GUARD_HEAD_Y: f64  = 1.10;
const REL_GUARD_TORSO_Y: f64 = 0.35;
const DEFAULT_BODY_SCALE: f64 = 0.30;
```

**Velocity helpers — port of Python lines 67–97 using VecDeque:**

The engine stores `processed_frames: VecDeque<MsgPoseFrame>` (room.rs line 13). The plugin-trait `TickContext.frames` is `[&VecDeque<PoseFrame>; 2]`. Copy the velocity calc from RESEARCH.md Pattern 4:
```rust
fn velocity_3d(frames: &VecDeque<PoseFrame>, idx: usize) -> (f64, f64, f64) {
    if frames.len() < 3 { return (0.0, 0.0, 0.0); }
    let new = &frames[frames.len()-1].keypoints[idx];
    let old = &frames[frames.len()-3].keypoints[idx];
    let dt = frames[frames.len()-1].timestamp - frames[frames.len()-3].timestamp;
    let dt = if dt < 1e-4 { 2.0 / 30.0 } else { dt };
    ((new.x - old.x) / dt, (new.y - old.y) / dt, (new.z - old.z) / dt)
}

fn speed(v: (f64, f64, f64)) -> f64 {
    (v.0*v.0 + v.1*v.1 + v.2*v.2).sqrt()
}

fn peak_speed(frames: &VecDeque<PoseFrame>, idx: usize) -> f64 {
    // consecutive-pair max — ported from server/hit_detection.py lines 81-97
    let frames_slice = frames.as_slices();
    let all: Vec<&PoseFrame> = frames_slice.0.iter().chain(frames_slice.1.iter()).collect();
    all.windows(2).map(|w| {
        let dt = w[1].timestamp - w[0].timestamp;
        let dt = if dt < 1e-4 { 1.0/30.0 } else { dt };
        let a = &w[0].keypoints[idx];
        let b = &w[1].keypoints[idx];
        let dx = b.x - a.x; let dy = b.y - a.y; let dz = b.z - a.z;
        (dx*dx + dy*dy + dz*dz).sqrt() / dt
    }).fold(0.0_f64, f64::max)
}
```

**Y-up helpers — port of Python lines 104–120. NOTE: engine delivers Y-up-normalized coords (PLUG-06), so hip_mid_y in normalized space IS 0.0 by definition. The `_y_up` and `_body_scale` must use raw MediaPipe convention because the engine now passes pre-normalized frames. If the normalization step in game_loop.rs zeroes hip_mid_y, then `_y_up(kp, idx) = kp[idx].y` directly. Confirm in game_loop.rs normalization implementation:**
```rust
// After PLUG-06 normalization: hip_mid is at (0,0,0), Y-up is positive above hip.
// So _y_up is just kp.y (already shifted). _body_scale still works from shoulder/hip Y.
fn body_scale(kp: &[PoseKeypoint]) -> f64 {
    let shoulder_y = (kp[LEFT_SHOULDER].y + kp[RIGHT_SHOULDER].y) / 2.0;
    let hip_y = (kp[LEFT_HIP].y + kp[RIGHT_HIP].y) / 2.0;
    let scale = (hip_y - shoulder_y).abs();
    scale.clamp(0.12, 0.55)  // server/hit_detection.py line 120
}
```

**Guard-raise veto — port of Python lines 183–193 (IMPORTANT: prevents false punches on guard raise):**
```rust
fn is_primarily_upward(vel: (f64, f64, f64)) -> bool {
    // After Y-up normalization, positive Y is up.
    // Guard-raise = wrist moving upward (positive Y velocity).
    // Port of _is_primarily_upward but adapted for Y-up convention.
    // In Y-up: vy > 0 means moving up; dominant = vy > |vx| + |vz|
    vel.1 > vel.0.abs() + vel.2.abs()
}
```
NOTE: Python's `_is_primarily_upward` checks `vy < 0` because MediaPipe Y is positive-down. After Y-up normalization, the sign flips — upward motion is `vy > 0`. This is the double-negation pitfall from RESEARCH.md Pitfall 2.

**Public API — port of Python lines 220–291:**
```rust
pub fn detect_punch(
    attacker_frames: &VecDeque<PoseFrame>,
    defender_frames: &VecDeque<PoseFrame>,
    ref_velocity: Option<f64>,
) -> Option<HitResult> { ... }

pub fn detect_kick(
    attacker_frames: &VecDeque<PoseFrame>,
    defender_frames: &VecDeque<PoseFrame>,
    ref_velocity: Option<f64>,
) -> Option<HitResult> { ... }
```

---

### `engine/boxing-plugin/src/damage.rs` (utility, transform)

**Analog:** `server/damage.py` — direct port (23 lines).

**Imports:**
```rust
use plugin_trait::BodyRegion;
```

**BASE_DAMAGE — port of server/damage.py lines 3–13:**
```rust
// (base_min, base_max) per region
fn base_damage(region: BodyRegion) -> (u32, u32) {
    match region {
        BodyRegion::BlockHand    => (2, 4),
        BodyRegion::BlockForearm => (2, 4),
        BodyRegion::LegThigh     => (3, 5),
        BodyRegion::LegShin      => (3, 5),
        BodyRegion::TorsoLower   => (6, 9),
        BodyRegion::TorsoUpper   => (9, 13),
        BodyRegion::HeadFace     => (15, 20),
        BodyRegion::HeadChin     => (20, 25),
        BodyRegion::HeadThroat   => (20, 25),
    }
}
```

**compute_damage — port of server/damage.py lines 16–22:**
```rust
pub fn compute_damage(region: BodyRegion, limb_velocity: f64, reference_velocity: Option<f64>) -> u32 {
    let ref_v = reference_velocity.unwrap_or(3.0);
    let (base_min, base_max) = base_damage(region);
    // server/damage.py line 20: t = min(1.0, vel / (2.0 * max(ref, 0.1)))
    let t = (limb_velocity / (2.0 * f64::max(ref_v, 0.1))).min(1.0);
    let raw = base_min as f64 + (base_max - base_min) as f64 * t;
    (raw.round() as u32).clamp(base_min, base_max)
}
```

---

### `engine/boxing-plugin/src/bot.rs` (utility, event-driven)

**Analog:** `server/game_loop.py` `_tick_bot` (lines 231–256), `_BOT_KPS` (lines 49–83), `_BOT_INTERVALS` / `_BOT_DAMAGES` / `_BOT_REGIONS` (lines 31–44).

**Imports:**
```rust
use rand::Rng;
use plugin_trait::{PoseKeypoint, PoseFrame, BodyRegion, GameEvent};
use serde_json::json;
```

**Difficulty enum — port of Python dict keys from line 31:**
```rust
#[derive(Clone, Copy, Debug)]
pub enum Difficulty { Easy, Normal, Hard }
```

**BOT_INTERVALS — port of server/game_loop.py line 31:**
```rust
fn bot_interval(difficulty: Difficulty) -> (f64, f64) {
    match difficulty {
        Difficulty::Easy   => (4.5, 7.0),
        Difficulty::Normal => (2.5, 4.5),
        Difficulty::Hard   => (1.0, 2.5),
    }
}
```

**BOT_DAMAGES — port of server/game_loop.py line 36:**
```rust
fn bot_damage_range(difficulty: Difficulty) -> (u32, u32) {
    match difficulty {
        Difficulty::Easy   => (15, 35),
        Difficulty::Normal => (30, 55),
        Difficulty::Hard   => (50, 80),
    }
}
```

**BOT_REGIONS — port of server/game_loop.py line 41:**
```rust
const BOT_REGIONS: [BodyRegion; 6] = [
    BodyRegion::TorsoLower, BodyRegion::TorsoLower, BodyRegion::TorsoUpper,
    BodyRegion::TorsoUpper, BodyRegion::HeadFace,   BodyRegion::TorsoLower,
];
```

**BOT_KPS static pose — port of server/game_loop.py lines 49–83 (all 33 landmarks):**
```rust
// Static neutral standing pose. Hip y=0.60, shoulder y=0.30 → body_scale=0.30.
// These are RAW MediaPipe coordinates (before Y-up normalization).
// The engine's PLUG-06 normalization will transform them when they pass through TickContext.
pub const BOT_KPS: [PoseKeypoint; 33] = [
    PoseKeypoint { x: 0.50, y: 0.10, z: 0.0, visibility: 1.0 }, // 0  nose
    PoseKeypoint { x: 0.52, y: 0.08, z: 0.0, visibility: 1.0 }, // 1  left_eye_inner
    PoseKeypoint { x: 0.53, y: 0.08, z: 0.0, visibility: 1.0 }, // 2  left_eye
    PoseKeypoint { x: 0.55, y: 0.08, z: 0.0, visibility: 1.0 }, // 3  left_eye_outer
    PoseKeypoint { x: 0.48, y: 0.08, z: 0.0, visibility: 1.0 }, // 4  right_eye_inner
    PoseKeypoint { x: 0.47, y: 0.08, z: 0.0, visibility: 1.0 }, // 5  right_eye
    PoseKeypoint { x: 0.45, y: 0.08, z: 0.0, visibility: 1.0 }, // 6  right_eye_outer
    PoseKeypoint { x: 0.57, y: 0.12, z: 0.0, visibility: 1.0 }, // 7  left_ear
    PoseKeypoint { x: 0.43, y: 0.12, z: 0.0, visibility: 1.0 }, // 8  right_ear
    PoseKeypoint { x: 0.52, y: 0.15, z: 0.0, visibility: 1.0 }, // 9  mouth_left
    PoseKeypoint { x: 0.48, y: 0.15, z: 0.0, visibility: 1.0 }, // 10 mouth_right
    PoseKeypoint { x: 0.62, y: 0.30, z: 0.0, visibility: 1.0 }, // 11 left_shoulder
    PoseKeypoint { x: 0.38, y: 0.30, z: 0.0, visibility: 1.0 }, // 12 right_shoulder
    PoseKeypoint { x: 0.65, y: 0.46, z: 0.0, visibility: 1.0 }, // 13 left_elbow
    PoseKeypoint { x: 0.35, y: 0.46, z: 0.0, visibility: 1.0 }, // 14 right_elbow
    PoseKeypoint { x: 0.67, y: 0.62, z: 0.0, visibility: 1.0 }, // 15 left_wrist
    PoseKeypoint { x: 0.33, y: 0.62, z: 0.0, visibility: 1.0 }, // 16 right_wrist
    PoseKeypoint { x: 0.67, y: 0.64, z: 0.0, visibility: 1.0 }, // 17 left_pinky
    PoseKeypoint { x: 0.33, y: 0.64, z: 0.0, visibility: 1.0 }, // 18 right_pinky
    PoseKeypoint { x: 0.68, y: 0.63, z: 0.0, visibility: 1.0 }, // 19 left_index
    PoseKeypoint { x: 0.32, y: 0.63, z: 0.0, visibility: 1.0 }, // 20 right_index
    PoseKeypoint { x: 0.67, y: 0.63, z: 0.0, visibility: 1.0 }, // 21 left_thumb
    PoseKeypoint { x: 0.33, y: 0.63, z: 0.0, visibility: 1.0 }, // 22 right_thumb
    PoseKeypoint { x: 0.59, y: 0.60, z: 0.0, visibility: 1.0 }, // 23 left_hip
    PoseKeypoint { x: 0.41, y: 0.60, z: 0.0, visibility: 1.0 }, // 24 right_hip
    PoseKeypoint { x: 0.60, y: 0.75, z: 0.0, visibility: 1.0 }, // 25 left_knee
    PoseKeypoint { x: 0.40, y: 0.75, z: 0.0, visibility: 1.0 }, // 26 right_knee
    PoseKeypoint { x: 0.60, y: 0.90, z: 0.0, visibility: 1.0 }, // 27 left_ankle
    PoseKeypoint { x: 0.40, y: 0.90, z: 0.0, visibility: 1.0 }, // 28 right_ankle
    PoseKeypoint { x: 0.60, y: 0.93, z: 0.0, visibility: 1.0 }, // 29 left_heel
    PoseKeypoint { x: 0.40, y: 0.93, z: 0.0, visibility: 1.0 }, // 30 right_heel
    PoseKeypoint { x: 0.61, y: 0.95, z: 0.0, visibility: 1.0 }, // 31 left_foot_index
    PoseKeypoint { x: 0.39, y: 0.95, z: 0.0, visibility: 1.0 }, // 32 right_foot_index
];
```

**tick_bot — port of server/game_loop.py lines 231–256, adapted to return Vec<GameEvent>:**

Python `_tick_bot` sends `MsgYouWereHit` via `await ws.send_text(...)`. In Rust, that becomes `GameEvent::SendToPlayer`. Pattern from RESEARCH.md Pattern 6 (event dispatch):
```rust
pub fn tick_bot(
    difficulty: Difficulty,
    bot_next_hit_at: &mut f64,
    elapsed_secs: f64,
    slot1_connected: bool,
) -> Vec<GameEvent> {
    // solo mode = slot 1 connected, slot 2 (bot) not connected
    if !slot1_connected || elapsed_secs < *bot_next_hit_at {
        return vec![];
    }
    let mut rng = rand::thread_rng();
    let (lo, hi) = bot_interval(difficulty);
    *bot_next_hit_at = elapsed_secs + rng.gen_range(lo..hi);
    let (dmg_lo, dmg_hi) = bot_damage_range(difficulty);
    let dmg = rng.gen_range(dmg_lo..=dmg_hi);
    let region_idx = rng.gen_range(0..BOT_REGIONS.len());
    let region = BOT_REGIONS[region_idx].clone();
    vec![
        GameEvent::Hit {
            attacker: 2, defender: 1,
            region: region.clone(),
            damage: dmg as f32,
            position: [0.5, 0.4],
        },
        GameEvent::SendToPlayer {
            slot: 1,
            payload: json!({ "type": "you_were_hit", "region": format!("{:?}", region), "damage": dmg }),
        },
    ]
}
```

---

### `engine/Cargo.toml` (config)

**Analog:** `engine/Cargo.toml` (lines 1–3) — workspace file already exists with `members = ["engine-core"]`.

**Modification — add two workspace members:**
```toml
[workspace]
members = ["engine-core", "plugin-trait", "boxing-plugin"]
resolver = "2"
```

No other changes. The workspace-level Cargo.toml does not need a `[dependencies]` section (crates declare their own deps).

---

### `engine/engine-core/src/main.rs` (config/wiring)

**Analog:** `engine/engine-core/src/main.rs` — the existing file constructs `AppState` and passes it into routes (lines 18–39).

**Imports to add (follow existing import block style at lines 1–9):**
```rust
// Add after existing use declarations:
use boxing_plugin::{BoxingPlugin, BoxingConfig};
use boxing_plugin::bot::Difficulty;
use plugin_trait::GamePlugin;
use std::sync::Arc;
```

**Plugin construction — add in `main()` before AppState construction (D-05, D-06):**

Copy the `Arc::new(room_manager::RoomManager::new())` pattern from line 26 — wrap plugin the same way:
```rust
let boxing_config = BoxingConfig {
    hp: 800,
    round_secs: 90.0,
    max_wins: 3,
    bot_difficulty: Difficulty::Normal,
};
let plugin: Arc<dyn GamePlugin + Send + Sync> = Arc::new(BoxingPlugin::new(boxing_config));
```

NOTE: `Arc<dyn GamePlugin + Send + Sync>` is idiomatic (fat pointer, no double-boxing). If `GamePlugin` supertrait is just `Send`, then `Sync` must either be added to the supertrait or the `Arc` must use `Arc<Box<dyn GamePlugin + Send>>`. Prefer `Arc<dyn GamePlugin + Send + Sync>` per RESEARCH.md OQ-2.

**AppState modification — pass plugin to RoomManager (follow rooms field pattern at line 19):**
```rust
pub struct AppState {
    pub rooms: Arc<room_manager::RoomManager>,
    pub plugin: Arc<dyn GamePlugin + Send + Sync>,
}
```

**RoomManager::create_room — threading plugin into actor:**

The existing `create_room` at `engine/engine-core/src/room_manager.rs` line 48 constructs `RoomState` without a plugin. Phase 2 must pass `Arc<dyn GamePlugin + Send + Sync>` into `RoomState::new`. Follow the same pattern as `pose_tx.clone()` / `Arc::clone(&match_over_flag)` at lines 57–67.

---

### `engine/engine-core/src/game_loop.rs` (service, event-driven)

**Analog:** `engine/engine-core/src/game_loop.rs` — the entire existing file is modified.

**Phase 1 elements to REMOVE:**
- Line 64: `player.processed_frames.clear();` — WR-05 placeholder. Phase 2 processes frames before clearing.
- Lines 193–199: `pub enum GameEvent { ... }` — replaced by `plugin_trait::GameEvent`.

**Import additions (follow existing `use crate::...` style at lines 1–3):**
```rust
use plugin_trait::{GamePlugin, GameEvent, TickContext, TickInfo, RoomView, SlotView, PoseFrame};
use std::any::Any;
```

**Coordinate normalization — add before building TickContext (PLUG-06):**

New function to add; source pattern is RESEARCH.md Pattern 3:
```rust
fn normalize_to_y_up(frame: &MsgPoseFrame) -> PoseFrame {
    // Analog: server/hit_detection.py _hip_mid_y (line 104) and _y_up (line 109)
    let hip_l = &frame.keypoints[23]; // LEFT_HIP
    let hip_r = &frame.keypoints[24]; // RIGHT_HIP
    let hip_mid_y = (hip_l.y + hip_r.y) / 2.0;
    let hip_mid_x = (hip_l.x + hip_r.x) / 2.0;
    PoseFrame {
        timestamp: frame.timestamp,
        keypoints: frame.keypoints.iter().map(|kp| plugin_trait::PoseKeypoint {
            x: kp.x - hip_mid_x,
            y: hip_mid_y - kp.y,  // negate + shift = Y-up above hip
            z: kp.z,
            visibility: kp.visibility,
        }).collect(),
    }
}
```

**TickContext construction — add in game_tick after frame drain, before plugin call:**
```rust
// Normalize frames to Y-up (PLUG-06) and collect into PoseFrame VecDeques
let norm_frames: [VecDeque<PoseFrame>; 2] = [
    state.players[0].processed_frames.iter().map(normalize_to_y_up).collect(),
    state.players[1].processed_frames.iter().map(normalize_to_y_up).collect(),
];
let ctx = TickContext {
    frames: [&norm_frames[0], &norm_frames[1]],
    tick_info: TickInfo {
        tick: state.tick,
        elapsed_secs: live_elapsed,
        remaining_secs: remaining_time,
    },
    room: RoomView {
        slots: [
            SlotView { connected: state.players[0].connected, reference_velocity: state.players[0].reference_velocity },
            SlotView { connected: state.players[1].connected, reference_velocity: state.players[1].reference_velocity },
        ],
    },
};
```

NOTE: `state.tick` must be added to `RoomState` as `pub tick: u64` — it's currently `0` in the Phase 1 `build_game_state` (line 182). Add it to `RoomState` and increment each tick.

**Plugin call + event dispatch — add after TickContext construction:**

Follows Pattern 6 from RESEARCH.md:
```rust
let events = state.plugin.on_tick(&ctx, &mut *state.plugin_state);

// Clear processed frames AFTER plugin has consumed them (replaces line 64)
for player in state.players.iter_mut() {
    player.processed_frames.clear();
}

dispatch_events(&mut state, events, state.tick);
```

**dispatch_events function — new, following existing broadcast patterns in room.rs:**

The existing `send_to_slot` at `engine/engine-core/src/room.rs` line 113 and `broadcast_all` at line 120 show the channel dispatch pattern. Copy that style:
```rust
fn dispatch_events(state: &mut RoomState, events: Vec<GameEvent>) {
    let mut round_over_event: Option<Option<u8>> = None;
    for event in events {
        match event {
            GameEvent::Hit { attacker, defender, region, damage, position } => {
                // HP update handled by plugin (plugin owns HP); engine just logs
                // Add to recent_hits for MsgGameState broadcast
                // Copy HitEvent struct from protocol.rs lines 27-32
                state.recent_hits.push(crate::protocol::HitEvent {
                    player: attacker,
                    region: format!("{:?}", region).to_lowercase(),
                    damage: damage as f64,
                    position: crate::protocol::Position { x: position[0] as f64, y: position[1] as f64, z: 0.0 },
                });
            }
            GameEvent::RoundOver { winner } => {
                round_over_event = Some(winner);
            }
            GameEvent::SendToPlayer { slot, payload } => {
                // Copy send_to_slot pattern from room.rs line 113
                if let Some(tx) = &state.players[(slot - 1) as usize].tx {
                    if let Ok(json) = serde_json::to_string(&payload) {
                        let _ = tx.try_send(json);
                    }
                }
            }
            GameEvent::Broadcast { payload } => {
                // Copy game_tx.send pattern from room.rs line 121
                if let Ok(json) = serde_json::to_string(&payload) {
                    let _ = state.game_tx.send(json);
                }
            }
            GameEvent::CommentaryHint { .. } => {
                // No-op in Phase 2 (v2 commentary engine will consume)
            }
        }
    }
    if let Some(winner) = round_over_event {
        // Copy existing round_over broadcast pattern from game_loop.rs lines 79-158
        // Then call: state.plugin.on_round_reset(&mut *state.plugin_state);
    }
}
```

---

### `engine/engine-core/src/room.rs` (model/actor, event-driven)

**Analog:** `engine/engine-core/src/room.rs` — the entire file is modified in place.

**Import additions (follow lines 1–5):**
```rust
use std::any::Any;
use plugin_trait::GamePlugin;
```

**RoomState new fields — add to struct definition at line 29:**

Follow the existing field naming style (snake_case, pub, documented inline):
```rust
pub struct RoomState {
    // ... existing fields unchanged ...
    pub plugin: Arc<dyn GamePlugin + Send + Sync>,
    pub plugin_state: Box<dyn Any + Send>,
    pub tick: u64,           // added for TickInfo.tick (was hardcoded 0 in Phase 1)
    pub recent_hits: Vec<crate::protocol::HitEvent>,  // cleared each tick after broadcast
}
```

**RoomState::new signature — add plugin parameter (follow existing signature at line 45):**
```rust
pub fn new(
    code: String,
    max_wins: u32,
    pose_tx: broadcast::Sender<String>,
    game_tx: broadcast::Sender<String>,
    match_over_flag: Arc<std::sync::atomic::AtomicBool>,
    plugin: Arc<dyn GamePlugin + Send + Sync>,   // NEW
) -> Self {
    let plugin_state = plugin.init_state();       // NEW
    Self {
        // ... existing fields ...
        plugin,
        plugin_state,
        tick: 0,
        recent_hits: Vec::new(),
    }
}
```

**room_actor — CalibrationDone cmd must notify plugin (line 225 analog):**

Existing handler at lines 225–241 already sets `state.players[slot].reference_velocity`. Phase 2 adds:
```rust
RoomCmd::CalibrationDone { slot, reference_velocity } => {
    state.players[slot].reference_velocity = Some(reference_velocity);
    // NEW: notify plugin (boxing plugin clamps and stores in plugin state)
    state.plugin.on_calibration_complete(slot as u8, reference_velocity, &mut *state.plugin_state);
    // ... rest unchanged ...
}
```

**room_actor — PlayerConnect / PlayerDisconnect cmds notify plugin:**
```rust
// In PlayerConnect after state.players[slot].connected = true:
state.plugin.on_player_join(slot as u8, &mut *state.plugin_state);

// In PlayerDisconnect after state.players[slot].connected = false:
state.plugin.on_player_leave(slot as u8, &mut *state.plugin_state);
```

---

## Shared Patterns

### Downcast Pattern (Box<dyn Any + Send>)
**Source:** RESEARCH.md Pattern 2 (derived from Rust std::any::Any)
**Apply to:** All plugin method implementations in `boxing-plugin/src/lib.rs`
```rust
let s = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
```
The `.expect()` message must name the plugin so panics are diagnosable. This exact form is required — never call `unwrap()` without message on a downcast.

### serde_json Payload Pattern
**Source:** `engine/engine-core/src/room.rs` line 121 + `engine/engine-core/src/game_loop.rs` lines 83–85
**Apply to:** All `GameEvent::SendToPlayer` and `GameEvent::Broadcast` payload construction
```rust
// Pattern used throughout engine-core for JSON serialization:
if let Ok(json) = serde_json::to_string(&payload) {
    let _ = state.game_tx.send(json);
}
// For ad-hoc payloads in plugin:
use serde_json::json;
let payload = json!({ "type": "you_were_hit", "region": "head_face", "damage": 20 });
```

### Channel Send Pattern (Non-Blocking)
**Source:** `engine/engine-core/src/room.rs` lines 113–116, 120–127
**Apply to:** All `GameEvent::SendToPlayer` dispatch in `game_loop.rs` dispatch_events
```rust
// Player-specific (send_to_slot pattern):
if let Some(tx) = &state.players[slot_idx].tx {
    let _ = tx.try_send(json.to_string());
}
// Broadcast (broadcast_all pattern):
let _ = state.game_tx.send(json.to_string());
```
Use `try_send` (non-blocking) for player channels — follows existing WR-02 pattern. Log channel-full warnings with `tracing::warn!` for critical messages.

### tracing Pattern
**Source:** `engine/engine-core/src/game_loop.rs` lines 128, 157 and `engine/engine-core/src/room.rs` lines 214, 228
**Apply to:** All significant state transitions in boxing-plugin and game_loop.rs modifications
```rust
tracing::info!("room {} player {} hit | region={:?} vel={:.1} dmg={}", state.code, attacker+1, region, velocity, damage);
tracing::warn!("room {} player {} outbound channel full, dropping message", state.code, slot);
```

### Rust Module Declaration Pattern
**Source:** `engine/engine-core/src/main.rs` lines 11–16 (mod declarations)
**Apply to:** `engine/boxing-plugin/src/lib.rs` submodule declarations
```rust
mod hit_detection;
mod damage;
mod bot;
pub use hit_detection::{detect_punch, detect_kick};
pub use damage::compute_damage;
pub use bot::{Difficulty, tick_bot};
```

### Test Pattern
**Source:** `engine/engine-core/tests/protocol_roundtrip.rs` (integration test style) and `engine/engine-core/src/input_delay.rs` lines 63–101 (inline unit test style)
**Apply to:** Unit tests for hit_detection.rs and damage.rs (inline `#[cfg(test)]` module)
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_damage_at_ref_vel_is_midpoint() {
        let dmg = compute_damage(BodyRegion::HeadFace, 3.0, Some(3.0));
        // At ref_vel: t = 3.0 / (2.0 * 3.0) = 0.5 → midpoint of (15, 20) = 17.5 → 18
        assert_eq!(dmg, 18);
    }

    #[test]
    fn on_round_reset_preserves_ref_vel() {
        // FIX-01 regression guard
        let plugin = BoxingPlugin::new(BoxingConfig { hp: 800, round_secs: 90.0, max_wins: 3, bot_difficulty: Difficulty::Normal });
        let mut state = plugin.init_state();
        plugin.on_calibration_complete(0, 4.5, &mut *state);
        plugin.on_round_reset(&mut *state);
        let s = state.downcast_ref::<BoxingState>().unwrap();
        assert_eq!(s.ref_vel[0], 4.5, "FIX-01: ref_vel must survive round reset");
    }
}
```

---

## No Analog Found

All 9 files have analogs — either exact ports from Python source or modifications of existing Phase 1 Rust files. No files require novel algorithms without a reference.

---

## Critical Implementation Warnings

1. **FIX-01 (rooms.py line 64 bug):** `BoxingState.ref_vel` must NOT be cleared in `on_round_reset`. Only clear `hp`, `last_hit_tick`, `combo`, `low_hp_announced`, `first_blood_pending`. This is the primary bug being fixed.

2. **processed_frames.clear() removal (game_loop.rs line 64):** The WR-05 comment marks this as a Phase 1 placeholder. Phase 2 MUST remove this line and clear frames only after `on_tick` returns.

3. **Y-up negation (hit_detection.rs):** After PLUG-06 normalization in game_loop.rs, coordinates are already Y-up. The `_is_primarily_upward` guard-raise check must use `vy > 0` (not `vy < 0` as in Python), because Python uses raw MediaPipe (positive-down Y). All body-region thresholds also assume positive Y = above hip after normalization.

4. **f64 vs f32 coordinate precision:** `protocol.rs` PoseKeypoint uses `f64`. Plugin-trait `PoseKeypoint` should also use `f64` to avoid conversion loss. The `HitResult.position` and `GameEvent::Hit.position` use `f32` per D-03 (wire format is compact). Convert at the boundary (hit detection returns `f64`, GameEvent stores `f32`).

5. **GamePlugin trait Sync bound:** `Arc<dyn GamePlugin + Send>` requires `Sync` to be `Arc`-able (`Arc<T>: Send + Sync` requires `T: Send + Sync`). Either add `Sync` to the supertrait (`pub trait GamePlugin: Send + Sync`) or use `Arc<Mutex<Box<dyn GamePlugin + Send>>>`. Adding `Sync` to the supertrait is simpler and valid because `BoxingPlugin` holds only a `BoxingConfig` (no interior mutability).

---

## Metadata

**Analog search scope:** `engine/engine-core/src/`, `server/` (Python port sources)
**Files scanned:** 11 Rust source files + 3 Python source files + 2 planning documents
**Pattern extraction date:** 2026-05-02
