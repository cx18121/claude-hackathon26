# Phase 2: Plugin Trait + Boxing - Research

**Researched:** 2026-05-02
**Domain:** Rust trait objects, Cargo workspace crates, boxing game logic port
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01** — Cargo workspace: Phase 2 adds `plugin-trait` and `boxing-plugin` as workspace members in `engine/Cargo.toml`. `engine-core` gains a dep on `plugin-trait`; `boxing-plugin` depends on `plugin-trait`; only `main.rs` imports `BoxingPlugin` directly.

**D-02** — Events-only messaging: `on_tick` returns `Vec<GameEvent>`; no send methods on `TickContext`. `GameEvent::SendToPlayer { slot, payload: serde_json::Value }` and `GameEvent::Broadcast { payload }` are the dispatch mechanisms. Rationale: pure function, unit-testable without engine plumbing.

**D-03** — `GameEvent` variants: `Hit { attacker: u8, defender: u8, region: BodyRegion, damage: f32, position: [f32; 2] }`, `RoundOver { winner: Option<u8> }`, `SendToPlayer { slot: u8, payload: serde_json::Value }`, `Broadcast { payload: serde_json::Value }`, `CommentaryHint { kind: String, payload: serde_json::Value }`.

**D-04** — Bot logic lives entirely in the boxing plugin. Plugin reads `RoomView` to detect solo mode. Bot fabricates `PoseKeypoint` data internally from a static constant. Engine has no concept of bot.

**D-05** — Hardcoded in `engine-core/src/main.rs`:
```rust
let plugin: Box<dyn GamePlugin + Send> = Box::new(BoxingPlugin::new(config));
```
No feature flags or config-file routing in Phase 2.

**D-06** — `BoxingPlugin::new(config: BoxingConfig)`. `GamePlugin::init_state()` takes no arguments. Phase 2 defaults: `{ hp: 800, round_secs: 90.0, max_wins: 3, bot_difficulty: Difficulty::Normal }`.

**D-07** — `reference_velocity` stored on `PlayerSlot` in the engine. Engine's round-reset path does NOT clear it. Boxing's `on_round_reset` clears only HP arrays, cooldown counters, combo trackers.

**D-08** — Boxing plugin clamps `reference_velocity` in `on_calibration_complete` before storing it: valid range 0.5–15.0 m/s, clamped silently.

### Claude's Discretion

- Exact `BodyRegion` enum variants and Rust naming convention (snake_case variants: `HeadChin`, `HeadFace`, `HeadThroat`, `TorsoUpper`, `TorsoLower`, `BlockHand`, `BlockForearm`, `LegThigh`, `LegShin`)
- Internal module layout within `boxing-plugin` crate
- `RoomView` exact fields beyond player count and slot connection status
- Exact difficulty tier hit-interval ranges for bot mode (easy/normal/hard)
- Whether `BoxingConfig` derives `serde::Deserialize`

### Deferred Ideas (OUT OF SCOPE)

- CLI-based or env-based plugin selection (Phase 3)
- `CommentaryHint` consumer/commentary engine (v2 / COMM-01..04)
- Replay/event logging
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-01 | `GamePlugin` trait: `init_state`, `on_tick`, `on_player_join`, `on_player_leave`, `on_calibration_complete`, `on_round_reset` with default no-ops | Trait definition rules in §Architecture Patterns; object safety confirmed |
| PLUG-02 | `TickContext` struct: released pose frames per slot, `TickInfo`, `RoomView`, broadcast helpers | Phase 1 `game_loop.rs` provides the input shape; processed_frames already in `PlayerSlot` |
| PLUG-03 | `GameEvent` enum: `Hit`, `RoundOver`, `SendToPlayer`, `CommentaryHint` minimum | D-03 fully specifies variants; `serde_json::Value` payload eliminates generic type param (object safety) |
| PLUG-04 | Plugin state as `Box<dyn Any + Send>` per room; each plugin downcasts | `std::any::Any` downcast pattern documented; `Box<dyn Any + Send>` compiles; downcast requires `'static` bound on concrete type |
| PLUG-05 | Trait fully object-safe; all methods synchronous (no async fn) | Object safety rules verified in Rust Reference; async fn breaks object safety; `async-trait` not needed |
| PLUG-06 | Engine delivers keypoints hip-centred Y-up before passing to plugin | Phase 1 does NOT normalize coordinates; this is a Phase 2 addition to `game_loop.rs` before passing to plugin |
| BOX-01 | Punch detection: wrist speed over 10-frame window | Python `detect_punch` fully analysed; direct port to Rust (no numpy — use pure f32 arithmetic) |
| BOX-02 | Kick detection: ankle elevation + speed | Python `detect_kick` fully analysed; same window approach |
| BOX-03 | 9-region body classification | Python region constants extracted; Rust `BodyRegion` enum with 9 variants |
| BOX-04 | Guard blocking: wrist-height guard zones | Python `_guarded_zones` / `_apply_guard` analysed; straightforward port |
| BOX-05 | Velocity-scaled damage | Python `compute_damage` analysed: linear scale 0→base_min at 0 vel, midpoint at ref_vel, base_max at 2×ref_vel |
| BOX-06 | HP tracking: 800 HP per player; KO or 90s timer | Python `_check_round_over` analysed |
| BOX-07 | Hit cooldown: 12-tick (200ms) per-attacker lockout | `_HIT_COOLDOWN_TICKS = 12` confirmed in Python |
| BOX-08 | Round draw: equal HP at time expiry | Python `_check_round_over` handles None winner |
| BOX-09 | Multi-round match: engine-tracked win counter | Already in Phase 1 `RoomState.wins`; plugin returns `RoundOver` event; engine increments |
| BOX-10 | Solo/bot mode: static pose P2 slot, scripted hit timer, 3 difficulty tiers | Python `_BOT_KPS` (33 landmarks) and `_BOT_INTERVALS` fully extracted |
| FIX-01 | Calibration persists through rematch | Bug isolated in `rooms.py:64`; D-07 specifies fix; engine does not clear `reference_velocity` in round reset |
</phase_requirements>

---

## Summary

Phase 2 layers the `GamePlugin` abstraction on top of the Phase 1 engine-core. The engine delivers pose frames, tick timing, and room state to the plugin through `TickContext`; the plugin returns a `Vec<GameEvent>` describing every side-effect. Two new workspace crates are added (`plugin-trait`, `boxing-plugin`); `engine-core` retains sole ownership of all transport and concurrency logic.

The boxing plugin is a faithful port of the Python hit detection pipeline (`server/hit_detection.py`, `server/damage.py`, `server/game_loop.py`). The Python code uses NumPy for velocity calculations; the Rust port replaces these with pure `f32` arithmetic (central-difference velocity, peak-speed scan over a `VecDeque` window). All threshold constants (`_REL_HEAD_Y`, `_REL_TORSO_HI_Y`, `_REL_GUARD_HEAD_Y`, `PUNCH_THRESHOLD`, `KICK_THRESHOLD`) have been extracted and need direct translation. The 33-point `_BOT_KPS` static pose has been fully recorded and needs porting as a `const [PoseKeypoint; 33]`.

The most important architectural constraint for planning is object safety: the `GamePlugin` trait must not use `async fn`, must not use `Self` in return positions, and must not have generic type parameters on its methods. Using `serde_json::Value` (not a generic) for event payloads eliminates the generic-type pitfall. `Box<dyn Any + Send>` for plugin state is the established Rust pattern and requires that the concrete state type be `'static + Send`. The `on_round_reset` method is the FIX-01 integration point: the engine calls it after broadcasting `RoundOver`; boxing clears only round-scoped state.

**Primary recommendation:** Implement `plugin-trait` first (trait + context + event types), then `boxing-plugin` (port Python logic module by module), then wire `game_loop.rs` to call the plugin and dispatch its returned events.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GamePlugin trait definition + types | plugin-trait crate | — | Shared contract; engine-core and boxing-plugin both depend on it |
| Pose coordinate normalization (Y-up) | engine-core / game_loop.rs | — | PLUG-06: engine delivers normalized coords; plugin never transforms |
| Input delay buffer drain | engine-core / game_loop.rs | — | Phase 1 already does this; Phase 2 passes released frames to plugin via TickContext |
| Punch/kick hit detection | boxing-plugin / hit_detection.rs | — | Game-domain logic; engine has no concept of punch/kick |
| Body region classification | boxing-plugin / hit_detection.rs | — | Boxing-specific; 9 region constants are boxing domain knowledge |
| Guard blocking | boxing-plugin / hit_detection.rs | — | Boxing-specific defender guard logic |
| Damage scaling | boxing-plugin / damage.rs | — | Boxing-specific BASE_DAMAGE + velocity scaling |
| HP tracking + round outcome | boxing-plugin state (BoxingState) | — | Plugin owns all round-scoped state |
| Hit cooldown tracking | boxing-plugin state (BoxingState) | — | Per-attacker 12-tick lockout lives in plugin state |
| Combo / first-blood / low-hp detection | boxing-plugin (commentary triggers) | — | CommentaryHint emission lives in boxing plugin |
| Bot pose injection + scripted hits | boxing-plugin / bot.rs | — | D-04: engine has no concept of bot |
| Event dispatch (SendToPlayer, Broadcast) | engine-core (after on_tick returns) | — | D-02: engine owns transport; plugin only returns events |
| Round lifecycle (win counter, match end) | engine-core / game_loop.rs | boxing-plugin (RoundOver event) | Plugin signals RoundOver; engine increments wins, calls on_round_reset |
| reference_velocity persistence (FIX-01) | engine-core PlayerSlot | boxing-plugin clamping | Engine never clears it; boxing clamps on receipt in on_calibration_complete |
| Plugin construction / registration | engine-core / main.rs | boxing-plugin BoxingPlugin::new | D-05: hardcoded in main.rs; engine sees only dyn GamePlugin + Send |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| serde / serde_json | 1.0.228 / 1.0.149 | Serialize GameEvent payloads | Already in engine-core; `serde_json::Value` used for `CommentaryHint` and `SendToPlayer` payloads |
| std::any::Any | std | Type-erased plugin state | Zero-dep Rust standard; `Box<dyn Any + Send>` is the canonical plugin-state pattern |

[VERIFIED: engine/engine-core/Cargo.toml]

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| rand | 0.8.6 | Bot hit-timer randomization (`random::uniform(lo, hi)`) | boxing-plugin/bot.rs for bot difficulty hit intervals |

[VERIFIED: engine/engine-core/Cargo.toml — rand already declared; same version used in boxing-plugin]

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `serde_json::Value` for event payloads | Generic type parameter `P: Serialize` | Generic type param on trait method breaks object safety (dyn-incompatible); `serde_json::Value` is the correct choice |
| Pure `f32` velocity arithmetic | ndarray / nalgebra | numpy-style; unnecessary allocation overhead at 60Hz; 3D distance is trivially `(dx*dx+dy*dy+dz*dz).sqrt()` |
| `Box<dyn Any + Send>` for state | `Arc<Mutex<BoxingState>>` | Arc adds unnecessary ref-count overhead; engine owns state exclusively via `&mut dyn Any` — no cross-thread access needed |

**Installation (new workspace members):**
```bash
# engine/Cargo.toml additions:
# members = ["engine-core", "plugin-trait", "boxing-plugin"]
```

---

## Architecture Patterns

### System Architecture Diagram

```
WebSocket
 Player ──> main.rs handle_player
                │
                │ RoomCmd::PoseFrame (arrived_at, MsgPoseFrame)
                ▼
         room_actor (select! loop)
                │
                │ 60Hz tick
                ▼
         game_loop::game_tick(state, plugin)
                │
                ├─► coordinate_normalize(processed_frames) ──► TickContext
                │                                                    │
                │                                         plugin.on_tick(ctx, state)
                │                                                    │
                │                                          Vec<GameEvent>
                │                                                    │
                ├─► dispatch_events(events, room_state)
                │       │
                │       ├── Hit ──────────────────────► game_tx (MsgGameState.recent_hits)
                │       │                               player_tx (MsgYouWereHit to defender)
                │       ├── RoundOver ─────────────────► game_tx (MsgRoundEnd)
                │       │                               on_round_reset(plugin_state)
                │       ├── SendToPlayer ──────────────► player_tx[slot]
                │       ├── Broadcast ─────────────────► game_tx
                │       └── CommentaryHint ─────────────► (no-op in Phase 2; v2 consumer)
                │
                └─► MsgGameState broadcast (game_tx)


 boxing-plugin (pure logic, no async):
    BoxingPlugin::on_tick(ctx, state)
        │
        ├── Hit detection: iterate processed_frames per attacker
        │     detect_punch / detect_kick ──► HitResult{region, velocity, position}
        │     cooldown check (12 ticks)
        │     compute_damage ──► damage: f32
        │     emit GameEvent::Hit + GameEvent::SendToPlayer(MsgYouWereHit)
        │     emit GameEvent::CommentaryHint if first_blood/combo/low_hp
        │
        ├── Bot tick: if solo && now >= bot_next_hit_at
        │     scripted random damage, emit GameEvent::Hit + SendToPlayer
        │
        └── Round check: if hp[i] == 0 || remaining_secs <= 0
              emit GameEvent::RoundOver{winner}
```

### Recommended Project Structure
```
engine/
├── Cargo.toml                     # [workspace] members = ["engine-core", "plugin-trait", "boxing-plugin"]
├── engine-core/
│   └── src/
│       ├── main.rs                # +BoxingPlugin::new construction; plugin Arc'd into RoomManager
│       ├── game_loop.rs           # +coordinate normalization; +call plugin.on_tick; +event dispatch
│       └── room.rs                # +plugin_state: Box<dyn Any + Send> on RoomState
├── plugin-trait/
│   └── src/
│       └── lib.rs                 # GamePlugin trait, TickContext, TickInfo, RoomView, GameEvent, BodyRegion
└── boxing-plugin/
    └── src/
        ├── lib.rs                 # BoxingPlugin struct, BoxingConfig, BoxingState; impl GamePlugin
        ├── hit_detection.rs       # detect_punch, detect_kick (port of server/hit_detection.py)
        ├── damage.rs              # BASE_DAMAGE array, compute_damage (port of server/damage.py)
        └── bot.rs                 # BOT_KPS constant, tick_bot, Difficulty enum, BOT_INTERVALS
```

### Pattern 1: Object-Safe GamePlugin Trait

**What:** All trait methods take `&self` or `&mut dyn Any`; no generic parameters; no `async fn`; no `-> Self`. Methods that aren't relevant to a game get default no-op implementations so implementors only override what they need.

**When to use:** This is the ONLY trait definition pattern that satisfies `Box<dyn GamePlugin + Send>`.

```rust
// Source: Rust Reference /rust-lang/reference — dyn-incompatible features
// Source: PLUG-01 requirement, D-02 decision

use std::any::Any;

pub trait GamePlugin: Send {
    fn init_state(&self) -> Box<dyn Any + Send>;

    fn on_tick(
        &self,
        ctx: &TickContext,
        state: &mut dyn Any,
    ) -> Vec<GameEvent>;

    // Default no-op implementations — implementors override only what they need
    fn on_player_join(&self, slot: u8, state: &mut dyn Any) {}
    fn on_player_leave(&self, slot: u8, state: &mut dyn Any) {}
    fn on_calibration_complete(&self, slot: u8, reference_velocity: f64, state: &mut dyn Any) {}
    fn on_round_reset(&self, state: &mut dyn Any) {}
}
```

**Object safety rules satisfied:**
- No `async fn` (would make the trait dyn-incompatible via hidden `Future` return type)
- No `-> Self` return types
- No generic type parameters on methods
- `&self` receiver (not `self` by value, which would be dyn-incompatible)
- `Send` is a supertrait (auto-trait, does not break object safety)

[VERIFIED: /rust-lang/reference dyn-incompatible trait features documentation]

### Pattern 2: `Box<dyn Any + Send>` Plugin State Downcast

**What:** Engine stores `Box<dyn Any + Send>` per room. Each plugin method downcasts to its own concrete state type.

**When to use:** Every plugin method that touches game state.

```rust
// Source: Rust std::any::Any — downcast_mut pattern
// Source: PLUG-04 requirement

struct BoxingState {
    hp: [u32; 2],
    last_hit_tick: [i64; 2],
    combo: [(f64, u32); 2],
    low_hp_announced: [bool; 2],
    first_blood_pending: bool,
    bot_next_hit_at: f64,
}

impl GamePlugin for BoxingPlugin {
    fn init_state(&self) -> Box<dyn Any + Send> {
        Box::new(BoxingState {
            hp: [self.config.hp; 2],
            last_hit_tick: [-999; 2],
            combo: [(0.0, 0); 2],
            low_hp_announced: [false; 2],
            first_blood_pending: true,
            bot_next_hit_at: 0.0,
        })
    }

    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent> {
        let state: &mut BoxingState = state.downcast_mut::<BoxingState>().expect("boxing plugin: state type mismatch");
        // ... boxing logic
        vec![]
    }
}
```

**Critical constraint:** `BoxingState` must be `'static + Send`. Avoid storing references inside plugin state — use owned data only.

[VERIFIED: Rust Reference, std::any — downcast_ref/downcast_mut require 'static bound on T]
[VERIFIED: Phase 1 engine-core pattern: Box<dyn Any + Send> established in PLUG-04 spec]

### Pattern 3: Coordinate Normalization (PLUG-06)

**What:** Phase 1 engine stores raw MediaPipe frames (`MsgPoseFrame` with `timestamp: f64`, `keypoints: Vec<PoseKeypoint>`). MediaPipe Y-axis is positive-downward. The engine's `game_loop.rs` must transform frames to hip-centred Y-up before passing them to the plugin via `TickContext`.

**Why:** Python `hit_detection.py` uses `_y_up(kp, idx)` which negates Y relative to hip midpoint. PLUG-06 says the engine delivers normalized coords so the plugin never transforms. If this normalization is NOT done in the engine, every `detect_punch`/`detect_kick` call would need to know about MediaPipe's Y convention — a leaky abstraction.

**Transform:**
```rust
// MediaPipe: Y positive = toward feet; hip_mid_y ≈ 0.60 in [0,1]
// Y-up: height_above_hip = hip_mid_y - kp_y
// Source: server/hit_detection.py _y_up() and _hip_mid_y() — direct port

fn normalize_to_y_up(frame: &MsgPoseFrame) -> Vec<PoseKeypoint> {
    let hip_l = &frame.keypoints[23]; // LEFT_HIP
    let hip_r = &frame.keypoints[24]; // RIGHT_HIP
    let hip_mid_y = (hip_l.y + hip_r.y) / 2.0;
    let hip_mid_x = (hip_l.x + hip_r.x) / 2.0;

    frame.keypoints.iter().map(|kp| PoseKeypoint {
        x: kp.x - hip_mid_x,
        y: hip_mid_y - kp.y,  // negate + shift = Y-up above hip
        z: kp.z,
        visibility: kp.visibility,
    }).collect()
}
```

[VERIFIED: server/hit_detection.py lines 104-112 — _hip_mid_y and _y_up logic extracted]
[ASSUMED: Whether engine normalizes in game_loop.rs or passes raw and boxing normalizes itself; PLUG-06 spec says engine does it; Phase 1 game_loop.rs confirms no normalization is currently performed]

### Pattern 4: Velocity Calculation (No NumPy)

**What:** Python hit detection uses `np.array` + `np.linalg.norm` for 3D velocity. Rust port uses pure `f32` arithmetic — no allocations in the velocity hot path.

```rust
// Source: server/hit_detection.py _velocity() and _peak_speed() — direct port
// Landmark indices: WRIST_LEFT=15, WRIST_RIGHT=16, ANKLE_LEFT=27, ANKLE_RIGHT=28

fn velocity_3d(frames: &VecDeque<PoseFrame>, idx: usize) -> (f32, f32, f32) {
    if frames.len() < 3 { return (0.0, 0.0, 0.0); }
    let new = &frames[frames.len()-1].keypoints[idx];
    let old = &frames[frames.len()-3].keypoints[idx];
    let dt = (frames[frames.len()-1].timestamp - frames[frames.len()-3].timestamp) as f32;
    let dt = if dt < 1e-4 { 2.0 / 30.0 } else { dt };
    ((new.x - old.x) / dt, (new.y - old.y) / dt, (new.z - old.z) / dt)
}

fn speed(v: (f32, f32, f32)) -> f32 {
    (v.0*v.0 + v.1*v.1 + v.2*v.2).sqrt()
}

fn peak_speed(frames: &VecDeque<PoseFrame>, idx: usize) -> f32 {
    // consecutive-pair max — ported from _peak_speed in Python
    frames.make_contiguous().windows(2).map(|w| {
        let dt = (w[1].timestamp - w[0].timestamp) as f32;
        let dt = if dt < 1e-4 { 1.0/30.0 } else { dt };
        let a = &w[0].keypoints[idx];
        let b = &w[1].keypoints[idx];
        let dx = b.x - a.x; let dy = b.y - a.y; let dz = b.z - a.z;
        (dx*dx + dy*dy + dz*dz).sqrt() / dt
    }).fold(0.0_f32, f32::max)
}
```

[VERIFIED: server/hit_detection.py lines 67-97 — direct port confirmed]

### Pattern 5: TickContext Construction in game_loop.rs

**What:** `game_loop.rs` assembles `TickContext` from `RoomState` before calling `plugin.on_tick(ctx, state)`.

```rust
// Source: Phase 1 room.rs (PlayerSlot.processed_frames is VecDeque<MsgPoseFrame>)
// Source: PLUG-02 requirement

pub struct TickContext<'a> {
    pub frames: [&'a VecDeque<MsgPoseFrame>; 2],  // released frames per slot
    pub tick_info: TickInfo,
    pub room: RoomView<'a>,
}

pub struct TickInfo {
    pub tick: u64,
    pub elapsed_secs: f64,
    pub remaining_secs: f64,
}

pub struct RoomView<'a> {
    pub player_count: usize,
    pub slots: [SlotView; 2],
}

pub struct SlotView {
    pub connected: bool,
    pub reference_velocity: Option<f64>,
}
```

**Note:** `RoomView` is intentionally read-only (no `&mut` access to `RoomState`). The boxing plugin reads `room.slots[1].connected` to detect solo/bot mode (D-04).

[VERIFIED: Phase 1 room.rs PlayerSlot layout — `connected: bool`, `reference_velocity: Option<f64>`, `processed_frames: VecDeque<MsgPoseFrame>`]

### Pattern 6: Event Dispatch in game_loop.rs

**What:** After `plugin.on_tick(ctx, plugin_state)` returns, `game_loop.rs` iterates the event vec and acts on each variant.

```rust
// Source: D-02, D-03 decisions; Phase 1 game_loop.rs broadcast pattern

fn dispatch_events(state: &mut RoomState, events: Vec<GameEvent>, tick: u64) {
    let mut round_over_event: Option<Option<u8>> = None;
    for event in events {
        match event {
            GameEvent::Hit { attacker, defender, region, damage, position } => {
                state.hp[(defender - 1) as usize] =
                    state.hp[(defender - 1) as usize].saturating_sub(damage as u32);
                // Build MsgYouWereHit, send to defender via player_tx
                // Add to recent_hits for MsgGameState
            }
            GameEvent::RoundOver { winner } => {
                round_over_event = Some(winner);
            }
            GameEvent::SendToPlayer { slot, payload } => {
                // send to state.players[(slot-1) as usize].tx
            }
            GameEvent::Broadcast { payload } => {
                let _ = state.game_tx.send(serde_json::to_string(&payload).unwrap_or_default());
            }
            GameEvent::CommentaryHint { .. } => {
                // No-op in Phase 2; v2 commentary engine will consume
            }
        }
    }
    // Handle round_over_event: broadcast MsgRoundEnd, increment wins, call on_round_reset
}
```

[VERIFIED: Phase 1 game_loop.rs round_over handling pattern; Phase 1 broadcast_all / send_to_slot patterns]

### Anti-Patterns to Avoid

- **`async fn` in GamePlugin:** Breaks object safety (`Box<dyn GamePlugin + Send>` won't compile). All plugin methods MUST be synchronous. Side effects travel via returned `GameEvent` vec.
- **Generic type parameters on trait methods:** E.g., `fn process<T: Serialize>(&self, data: T)` is dyn-incompatible. Use `serde_json::Value` for variable-typed payloads.
- **`-> Self` in trait methods:** Dyn-incompatible. Use `Box<dyn GamePlugin>` if cloning is needed.
- **Storing `&RoomState` references in plugin state:** Plugin state must be `'static`; references to engine-owned data are not `'static`. Plugin state must be fully owned.
- **Calling `downcast_mut` without `.expect()`:** A type mismatch would panic in both cases; using `.expect("boxing plugin: state type mismatch")` makes the error message meaningful.
- **Clearing `reference_velocity` in `on_round_reset`:** This is FIX-01. Boxing's `on_round_reset` clears only `hp`, `last_hit_tick`, `combo`, `low_hp_announced`, `first_blood_pending`. It does NOT touch `reference_velocity` — that lives in `PlayerSlot` in the engine.
- **Double-negating Y in hit detection:** Phase 1 delivers raw MediaPipe frames (Y positive-down). If the engine normalizes to Y-up in `game_loop.rs` (per PLUG-06) AND boxing also negates Y, results will be wrong. The boxing plugin should use the normalized frame coordinates as-is.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON serialization of event payloads | Custom serializer | `serde_json::Value` + `serde_json::json!()` macro | Already in the dependency tree; `Value` is the correct type for `CommentaryHint`/`SendToPlayer` payloads |
| Random hit-timer intervals for bot | Custom PRNG | `rand::thread_rng().gen_range(lo..hi)` | `rand` crate already in workspace (declared in engine-core Cargo.toml); no new dep needed |
| Trait object dispatch | External plugin framework (libloading, etc.) | `Box<dyn GamePlugin + Send>` with Rust vtable | Static dispatch via trait objects is the correct pattern; no dynamic loading needed |
| VecDeque sliding window velocity | Ring buffer library | `std::collections::VecDeque` | Already used in Phase 1 `PlayerSlot.processed_frames`; `make_contiguous().windows(2)` for peak_speed scan |

**Key insight:** The entire boxing logic is a translation from Python, not a novel algorithm. Every algorithm is already validated in the Python server. The translation task is mechanical and must be faithful — do not invent improved algorithms; port what works.

---

## Phase 1 Engine State — What Exists and What's Missing

Understanding the exact Phase 1 output is critical because Phase 2 modifies existing files.

### What Phase 1 Built (VERIFIED from 01-VERIFICATION.md + source)

| Component | Status | Notes |
|-----------|--------|-------|
| `engine/Cargo.toml` | `members = ["engine-core"]` only | Phase 2 adds `"plugin-trait"`, `"boxing-plugin"` |
| `engine-core/src/main.rs` | Axum routes, WS handlers, AppState | Phase 2 adds plugin construction + passes to room_manager |
| `engine-core/src/room.rs` | `PlayerSlot` (tx, reference_velocity, rtt_samples, pose_buffer, processed_frames), `RoomState` (players[2], hp, wins, round_number, round_start_time, max_wins) | Phase 2 adds `plugin_state: Box<dyn Any + Send>` to RoomState |
| `engine-core/src/game_loop.rs` | 60Hz tick, warmup gate, round lifecycle, `GameEvent` enum (basic variants), processed_frames.clear() each tick | Phase 2: REMOVE processed_frames.clear(); ADD coordinate normalization; ADD plugin.on_tick call; ADD event dispatch |
| `engine-core/src/protocol.rs` | All 17 wire message structs; `MsgPoseFrame` has `timestamp: f64` and `keypoints: Vec<PoseKeypoint>` | No changes needed for boxing logic; `MsgYouWereHit{region: String, damage: f64}` already exists |
| `engine-core/src/input_delay.rs` | `compute_cutoff`, `record_pong`, `median_rtt` | No changes |
| `engine-core/src/broadcast.rs` | `forward_broadcast_to_spectator`, `send_snapshot` | No changes |

### Critical Phase 1 Gaps for Phase 2

1. **`processed_frames.clear()` in `game_loop.rs` line 64 (WR-05 note):** Phase 1 clears processed_frames every tick because Phase 2 is not yet there to consume them. Phase 2 MUST remove this clear and instead pass frames to the plugin, then clear after `on_tick` returns.

2. **`GameEvent` enum in `game_loop.rs` only has 3 variants:** `RoundStart`, `RoundOver`, `MatchEnd`. Phase 2 extends this significantly (Hit, SendToPlayer, Broadcast, CommentaryHint) — BUT these variants will live in `plugin-trait`, not `engine-core`. The engine-core `GameEvent` becomes the plugin-trait `GameEvent`.

3. **`solo: bool` and `bot_difficulty` not on `RoomState`:** Phase 1 `RoomState` has no `solo` or `bot_difficulty` fields (unlike Python `RoomState`). Phase 2 needs these OR the bot detection relies solely on `slot[1].connected == false` from `RoomView`. Decision D-04 says "plugin reads RoomView to detect solo mode" — `connected: false` on slot 1 is sufficient; no `solo` field needed on `RoomState`.

4. **No `plugin` in `RoomState` or accessible from `game_loop.rs`:** Phase 1 has no plugin concept. Phase 2 must thread the plugin through from `main.rs` construction into the room actor. Options:
   - Store `Arc<Box<dyn GamePlugin + Send>>` on `RoomState` (requires `Arc` for cloneability into room creation)
   - Pass the plugin as a constructor argument to `room_actor`
   - Store `Box<dyn GamePlugin + Send>` on `RoomState` directly (no Arc needed since room actor exclusively owns its state)

[VERIFIED: engine-core/src/room.rs — RoomState fields confirmed; engine-core/src/game_loop.rs — WR-05 comment on processed_frames.clear() confirmed]

---

## Python Implementation Details (Port Reference)

### Hit Detection Constants to Port

```python
# server/hit_detection.py lines 17-41
# Landmark indices
WRIST_LEFT  = 15
WRIST_RIGHT = 16
ANKLE_LEFT  = 27
ANKLE_RIGHT = 28
LEFT_HIP    = 23; RIGHT_HIP   = 24
LEFT_SHOULDER = 11; RIGHT_SHOULDER = 12

# Y-up height thresholds (* body_scale for per-player scaling)
_REL_HEAD_Y      = 1.45
_REL_TORSO_HI_Y  = 0.70
_REL_TORSO_LO_Y  = 0.00
_REL_KICK_MID_Y  = -0.30

# Guard thresholds
_REL_GUARD_HEAD_Y  = 1.10
_REL_GUARD_TORSO_Y = 0.35

_DEFAULT_BODY_SCALE = 0.30  # used when calibration hasn't run
```

**body_scale** is computed per-frame from the defender's pose:
```python
# _body_scale: abs(hip_y - shoulder_y), clamped [0.12, 0.55]
```

### Damage Constants to Port

```python
# server/damage.py — BASE_DAMAGE (lo, hi) per region
BASE_DAMAGE = {
    "block_hand":    (2, 4),
    "block_forearm": (2, 4),
    "leg_thigh":     (3, 5),
    "leg_shin":      (3, 5),
    "torso_lower":   (6, 9),
    "torso_upper":   (9, 13),
    "head_face":     (15, 20),
    "head_chin":     (20, 25),
    "head_throat":   (20, 25),
}
# compute_damage: t = min(1.0, vel / (2.0 * max(ref, 0.1)))
#                 raw = base_min + (base_max - base_min) * t
#                 result = clamp(round(raw), base_min, base_max)
```

### Bot Configuration to Port

```python
# server/game_loop.py lines 31-83
_BOT_INTERVALS = {"easy": (4.5,7.0), "normal": (2.5,4.5), "hard": (1.0,2.5)}
_BOT_DAMAGES   = {"easy": (15,35),   "normal": (30,55),   "hard": (50,80)}
_BOT_REGIONS   = ["torso_lower","torso_lower","torso_upper","torso_upper","head_face","torso_lower"]
# _BOT_KPS: 33-point static pose — all values extracted in game_loop.py lines 49-83
```

[VERIFIED: server/game_loop.py lines 31-83 — all values extracted]

### CommentaryHint Trigger Conditions

```python
# server/game_loop.py _emit_hit_commentary lines 415-479
# Triggers (in priority order):
# 1. first_blood_pending == True → kind = "first_blood"
# 2. combo count >= 3 (same attacker within 1.8s) → kind = "combo"
# 3. attacker_hp_pct < 0.30 AND defender_hp_pct >= attacker_hp_pct → kind = "comeback"
# 4. defender_hp_pct <= 0.25 AND not yet announced for this player → kind = "low_hp"
# 5. otherwise → kind = "hit"
# Round-level: "ko" on KO, "round_end" on timeout, "match_end" on match end
```

[VERIFIED: server/game_loop.py lines 415-479]

---

## Common Pitfalls

### Pitfall 1: async fn in GamePlugin Methods
**What goes wrong:** Compiler error: "method `on_tick` references the `Self` type, which is not yet supported in dyn traits" / trait is not dyn-compatible.
**Why it happens:** `async fn foo(&self)` desugars to `fn foo(&self) -> impl Future<Output=()>` — the `impl Future` return type is opaque and `Self`-dependent, making the method dyn-incompatible.
**How to avoid:** All GamePlugin methods MUST be `fn`, not `async fn`. Game state mutations and network sends happen via returned `Vec<GameEvent>` (events-out pattern, D-02).
**Warning signs:** Compiler error mentioning "dyn-incompatible" or "associated type `Output` is not constrained."

[VERIFIED: Rust Reference dyn-incompatible trait features documentation]

### Pitfall 2: Double Y-Negation in Hit Detection
**What goes wrong:** All hit and guard zone thresholds are inverted — punches to the head register as leg hits and vice versa.
**Why it happens:** Python `_y_up()` negates Y relative to hip. If the engine normalizes to Y-up AND boxing also negates Y, the transform is applied twice.
**How to avoid:** Confirm PLUG-06 coordinate delivery in the engine's normalization step. Boxing plugin uses coordinates as-is after the engine delivers them. Landmark heights in the normalized frame: head is positive (above hip), legs are negative (below hip).
**Warning signs:** All punches register as `leg_thigh` or `leg_shin` during testing.

[VERIFIED: server/hit_detection.py _y_up() and _hip_mid_y() — transform logic confirmed]
[ASSUMED: Engine normalizes before passing to plugin (per PLUG-06 spec); implementation detail for planning to specify]

### Pitfall 3: FIX-01 Regression — Clearing reference_velocity in on_round_reset
**What goes wrong:** Players must recalibrate after every round, not just every session — exactly the bug FIX-01 fixes.
**Why it happens:** Python `reset_for_rematch` sets `slot.reference_velocity = None` (rooms.py line 64). If boxing's `on_round_reset` clears plugin state including any reference velocity copy, the bug re-emerges.
**How to avoid:** `BoxingState` stores `ref_vel: [f64; 2]` (clamped copy). `on_round_reset` MUST NOT zero this array. Only clear `hp`, `last_hit_tick`, `combo`, `low_hp_announced`, `first_blood_pending`. The engine's `PlayerSlot.reference_velocity` is also never cleared by the engine round-reset path.
**Warning signs:** Test: verify `BoxingState.ref_vel` survives `on_round_reset` call.

[VERIFIED: server/rooms.py lines 57-67 — bug location confirmed; D-07 decision confirmed]

### Pitfall 4: processed_frames Not Cleared Before Phase 2 Consumes Them
**What goes wrong:** Frames from previous rounds bleed into hit detection for the next round, causing phantom hits on round start.
**Why it happens:** Phase 1 added `player.processed_frames.clear()` at the end of the input-drain loop (WR-05 note in game_loop.rs). Phase 2 must pass these frames to the plugin first, then clear them — or alternatively clear them in `on_round_reset`.
**How to avoid:** Remove the `processed_frames.clear()` call from `game_loop.rs` live-phase drain. Clear them in the warmup path (which Phase 1 already does: `player.pose_buffer.clear()` and `player.processed_frames.clear()` during warmup). This ensures no frame bleeds across rounds.
**Warning signs:** Comment `// Phase 2 will process these frames before clearing.` in Phase 1 game_loop.rs line 63.

[VERIFIED: engine-core/src/game_loop.rs lines 62-64 — WR-05 comment confirmed]

### Pitfall 5: Plugin State Lifetime — References in BoxingState
**What goes wrong:** Compile error: "the parameter type `T` may not live long enough" or "lifetime may not be 'static".
**Why it happens:** `Box<dyn Any + Send>` requires `'static`. Any `BoxingState` field that is a reference (e.g., `&[PoseKeypoint]`) would prevent `'static` satisfaction.
**How to avoid:** `BoxingState` must contain only owned data: `[f64; 2]`, `[u32; 2]`, `[(f64, u32); 2]`, `[bool; 2]`, `f64`, etc. No slices, no references, no `Arc<RoomState>` inside.
**Warning signs:** Compile error mentioning `'static` or "parameter type may not live long enough" when boxing BoxingState.

[VERIFIED: Rust std::any::Any — 'static bound on T: Any requirement; /rust-lang/reference documentation]

### Pitfall 6: Guard-Raise Veto Not Ported
**What goes wrong:** A player raising their guard (both wrists moving upward simultaneously) is incorrectly registered as throwing a punch.
**Why it happens:** Python `detect_punch` includes a guard-raise veto: if both wrists are `_is_primarily_upward()` at the same time, skip the punch detection.
**How to avoid:** Port `_is_primarily_upward()` (the velocity's upward component dominates combined horizontal + depth components) and apply it in `detect_punch`.
**Warning signs:** Guard-raising triggers false punch events in tests.

[VERIFIED: server/hit_detection.py lines 183-193, 245-249 — guard-raise veto logic confirmed]

---

## Code Examples

### GamePlugin Trait (plugin-trait/src/lib.rs)

```rust
// Source: PLUG-01, D-02, D-03 decisions + Rust Reference object-safety rules
use std::any::Any;
use serde_json::Value;

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

pub struct TickInfo {
    pub tick: u64,
    pub elapsed_secs: f64,
    pub remaining_secs: f64,
}

pub struct SlotView {
    pub connected: bool,
    pub reference_velocity: Option<f64>,
}

pub struct RoomView {
    pub slots: [SlotView; 2],
}

pub struct TickContext<'a> {
    pub frames: [&'a std::collections::VecDeque<PoseFrame>; 2],
    pub tick_info: TickInfo,
    pub room: RoomView,
}

pub struct PoseFrame {
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}

#[derive(Clone)]
pub struct PoseKeypoint {
    pub x: f32, pub y: f32, pub z: f32, pub visibility: f32,
}

pub trait GamePlugin: Send {
    fn init_state(&self) -> Box<dyn Any + Send>;
    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;
    fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}
    fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}
    fn on_round_reset(&self, _state: &mut dyn Any) {}
}
```

### BoxingPlugin Construction (engine-core/src/main.rs addition)

```rust
// Source: D-05, D-06 decisions
use boxing_plugin::{BoxingPlugin, BoxingConfig, Difficulty};

let boxing_config = BoxingConfig {
    hp: 800,
    round_secs: 90.0,
    max_wins: 3,
    bot_difficulty: Difficulty::Normal,
};
let plugin: Arc<Box<dyn GamePlugin + Send>> = Arc::new(Box::new(BoxingPlugin::new(boxing_config)));
// Arc so it can be shared into each room actor (multiple rooms, same plugin instance)
```

### on_round_reset (FIX-01 correct implementation)

```rust
// Source: FIX-01 requirement, D-07 decision
impl GamePlugin for BoxingPlugin {
    fn on_round_reset(&self, state: &mut dyn Any) {
        let s = state.downcast_mut::<BoxingState>().expect("boxing: state type mismatch");
        // ONLY clear round-scoped state. DO NOT touch s.ref_vel — that persists.
        let hp = self.config.hp;
        s.hp = [hp; 2];
        s.last_hit_tick = [-999; 2];
        s.combo = [(0.0, 0); 2];
        s.low_hp_announced = [false; 2];
        s.first_blood_pending = true;
        // bot_next_hit_at will be set by the first tick of the new round
    }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python `_velocity()` using `np.array` and `np.linalg.norm` | Rust pure `f32` arithmetic: `(dx*dx+dy*dy+dz*dz).sqrt()` | Phase 2 | Eliminates NumPy heap allocation; same algorithm |
| `async-trait` crate for async trait objects | Not used; all methods synchronous | Phase 2 design decision | No vtable penalty for per-call `Box<dyn Future>` at 60Hz |
| Python `game_loop.py` monolith (479 lines) mixing all concerns | Separate crates: engine-core, plugin-trait, boxing-plugin | Phase 2 | Responsibilities separated; boxing logic fully testable without running the server |

**Deprecated/outdated:**
- `engine-core/src/game_loop.rs::processed_frames.clear()` (WR-05 note): This is a Phase 1 placeholder that Phase 2 removes.
- `engine-core/src/game_loop.rs::GameEvent` enum: The 3-variant Phase 1 version is replaced by the plugin-trait `GameEvent` in Phase 2. The engine-core should re-export or depend on plugin-trait's `GameEvent`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Engine normalizes frames to Y-up before passing to plugin (PLUG-06 implementation lives in game_loop.rs, not boxing-plugin) | Pitfall 2, Pattern 3 | If boxing normalizes its own frames and engine also normalizes, double negation breaks all threshold comparisons |
| A2 | `BoxingPlugin` is shared across rooms via `Arc` (one plugin instance, per-room plugin_state) | Pattern 5, BoxingPlugin Construction | If plugin is constructed per-room instead, the Arc wrapping is unnecessary overhead |
| A3 | `PoseFrame` type in plugin-trait crate mirrors `MsgPoseFrame` from protocol.rs (timestamp: f64, keypoints: Vec<PoseKeypoint>) | Architecture Patterns | If field types differ (e.g., f64 vs f32 for coordinates), boxing plugin and engine use different precision |
| A4 | `rand 0.8.6` in engine-core Cargo.toml is also used for boxing-plugin without version conflict | Standard Stack | rand 0.8 and rand 0.9 have incompatible APIs; if boxing-plugin declares a different version, a duplicate dep is pulled in |

**If A1 is confirmed:** Boxing plugin uses normalized coordinates as-is; no `_y_up()` function needed in boxing-plugin.
**If A1 is denied (boxing normalizes its own):** Remove PLUG-06 normalization from game_loop.rs; boxing-plugin must contain normalization logic.

---

## Open Questions (RESOLVED)

1. **Where does `plugin_state: Box<dyn Any + Send>` live on `RoomState`?**
   - What we know: Phase 1 `RoomState` has no plugin state field.
   - What's unclear: Whether to store `plugin_state` directly on `RoomState` or in a separate per-room wrapper.
   - Recommendation: Add `plugin_state: Box<dyn Any + Send>` directly to `RoomState`. Initialized in `create_room` by calling `plugin.init_state()`. Passed as `&mut dyn Any` to all plugin methods.
   - RESOLVED: `plugin_state: Box<dyn Any + Send>` is added directly to `RoomState` in `engine-core/src/room.rs` (Plan 04, Task 1). Initialized by calling `plugin.init_state()` in `create_room`; passed as `&mut dyn Any` to every plugin method call in `game_loop.rs`.

2. **How is the plugin instance threaded into room_actor?**
   - What we know: `room_actor(cmd_rx, state)` in Phase 1 takes only those two args. The plugin is constructed in `main.rs`.
   - What's unclear: Whether to pass `Arc<Box<dyn GamePlugin + Send>>` as a third arg to `room_actor`, or store it on `RoomState`.
   - Recommendation: Add `plugin: Arc<dyn GamePlugin + Send>` as a field on `RoomState` (or pass as arg to `room_actor`). Using `Arc<dyn GamePlugin + Send>` (not `Arc<Box<...>>`) is idiomatic — `Arc<dyn Trait>` is fat-pointer already.
   - RESOLVED: `plugin: Arc<dyn GamePlugin + Send + Sync>` is stored on `RoomState` (Plan 04, Task 1). Constructed as `Arc::new(BoxingPlugin::new(config))` in `main.rs` and cloned into each room at creation time. `Arc` is required because the same plugin instance is shared across potentially multiple rooms; `Sync` is required by `Arc`.

3. **Does `TickContext` use `plugin-trait`'s own `PoseFrame` type or re-export `engine-core::protocol::MsgPoseFrame`?**
   - What we know: `plugin-trait` must not depend on `engine-core` (dependency flows: engine-core → plugin-trait, boxing-plugin → plugin-trait).
   - What's unclear: Whether `PoseFrame` in plugin-trait is a thin wrapper or a re-declaration.
   - Recommendation: `plugin-trait` defines its own `PoseFrame { timestamp: f64, keypoints: Vec<PoseKeypoint> }`. `engine-core`'s `game_loop.rs` converts `MsgPoseFrame` to plugin-trait's `PoseFrame` when building `TickContext`. This keeps the plugin-trait crate dependency-free.
   - RESOLVED: `plugin-trait` declares its own `PoseFrame` and `PoseKeypoint` types (Plan 01, Task 1). `game_loop.rs` converts `MsgPoseFrame` → plugin-trait `PoseFrame` during `TickContext` construction (Plan 04, Task 2). The `plugin-trait` crate remains free of any `engine-core` dependency.

---

## Environment Availability

Step 2.6: Minimal external dependencies — all logic is Rust compilation.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | All Phase 2 crates | ✓ | 1.86 (rust:1.86-slim Dockerfile) | — |
| rand 0.8.6 | boxing-plugin bot.rs | ✓ | Already in engine-core Cargo.toml | — |
| serde/serde_json | plugin-trait GameEvent payloads | ✓ | Already in engine-core Cargo.toml | — |
| Python server (port reference) | None at runtime; only for reference | ✓ | server/ directory present | — |

[VERIFIED: engine/engine-core/Cargo.toml — all deps confirmed]

---

## Sources

### Primary (HIGH confidence)
- `engine/engine-core/src/game_loop.rs` — Phase 1 output; WR-05 comment on processed_frames.clear() confirms the Phase 2 hook point
- `engine/engine-core/src/room.rs` — Phase 1 PlayerSlot and RoomState layout
- `engine/engine-core/src/protocol.rs` — All wire types including `MsgPoseFrame`, `MsgYouWereHit`
- `.planning/phases/01-engine-core/01-VERIFICATION.md` — All Phase 1 artifacts verified
- `/rust-lang/reference` via Context7 — dyn-incompatible trait features documentation
- `server/hit_detection.py` — Python reference; all constants and algorithms extracted
- `server/damage.py` — BASE_DAMAGE and compute_damage fully extracted
- `server/game_loop.py` — _BOT_KPS, _BOT_INTERVALS, _BOT_DAMAGES, commentary triggers extracted
- `server/rooms.py` — FIX-01 bug location confirmed (line 64)
- `.planning/phases/02-plugin-trait-boxing/02-CONTEXT.md` — All locked decisions

### Secondary (MEDIUM confidence)
- `.planning/codebase/ARCHITECTURE.md` — Coordinate system note confirmed (Y-up in hit_detection.py)
- `.planning/codebase/CONCERNS.md` — reference_velocity clamping range (0.5–15.0 m/s) confirmed (line 68)

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified in engine-core Cargo.toml
- Trait object safety rules: HIGH — verified from Rust Reference via Context7
- Phase 1 engine state: HIGH — source files read directly; 01-VERIFICATION.md cross-checked
- Python logic port: HIGH — all algorithms read directly from server/ source
- Architecture: HIGH — decisions locked in 02-CONTEXT.md; patterns confirmed against Phase 1 codebase
- Plugin threading into room_actor: MEDIUM — design is clear but exact plumbing (arg vs field) is a planning decision

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (stable Rust ecosystem; 30-day window)
