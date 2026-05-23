//! GamePlugin interface — the only contract a game developer needs to implement.
//! All types in this crate are shared between engine-core and any plugin crate.
//! Object safety rules: no async fn, no -> Self, no generic type params on methods.

use std::any::Any;
use std::collections::VecDeque;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Pose data types (mirrors protocol.rs PoseKeypoint; uses f64 to match)
// ---------------------------------------------------------------------------

/// A single MediaPipe pose landmark, normalized to hip-centred Y-up coordinates
/// by the engine before delivery to the plugin (PLUG-06).
///
/// **Coordinate system (Y-up, hip-centred):**
/// - Origin (0, 0) is at the midpoint between the player's two hips.
/// - Positive Y = above the hips; negative Y = below the hips.
/// - Approximate ranges: nose y ≈ +0.8, shoulders y ≈ +0.35, ankles y ≈ -0.90.
/// - `z` is near-zero for 2D MediaPipe estimation; safe to ignore.
/// - `visibility` ∈ [0.0, 1.0]. Filter landmarks with `visibility < 0.5` as unreliable.
///
/// **Do NOT** assume raw MediaPipe Y-down coordinates — the engine applies
/// `normalize_to_y_up` before any plugin sees the frame.
#[derive(Clone, Debug)]
pub struct PoseKeypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub visibility: f64,
}

/// A single pose frame delivered to the plugin via `TickContext.frames`.
///
/// Each frame holds 33 MediaPipe landmarks for one player at one instant,
/// already normalized to hip-centred Y-up coordinates.
///
/// **Usage in `on_tick`:** Iterate `ctx.frames[slot_idx]` to access the
/// per-player deque of released frames for this tick. Use `.back()` for the
/// most recent frame, or iterate all frames for velocity/motion calculations.
///
/// Timestamp is in seconds (matches MsgPoseFrame.timestamp from protocol.rs).
#[derive(Clone, Debug)]
pub struct PoseFrame {
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}

// ---------------------------------------------------------------------------
// Body region classification (BOX-03: 9 regions)
// ---------------------------------------------------------------------------

/// Nine body regions for hit classification in combat games (BOX-03).
///
/// Use `to_wire()` to get the snake_case JSON string for wire messages.
/// Do NOT use `format!("{:?}", r).to_lowercase()` — Debug emits PascalCase
/// that collapses incorrectly (e.g., `HeadFace` → `headface`, not `head_face`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BodyRegion {
    HeadFace,
    HeadChin,
    HeadThroat,
    TorsoUpper,
    TorsoLower,
    BlockHand,
    BlockForearm,
    LegThigh,
    LegShin,
}

impl BodyRegion {
    /// Returns the canonical snake_case wire string for JSON messages (CR-05).
    /// Replaces `format!("{:?}", region).to_lowercase()` at all call sites.
    pub fn to_wire(&self) -> &'static str {
        match self {
            BodyRegion::HeadFace     => "head_face",
            BodyRegion::HeadChin     => "head_chin",
            BodyRegion::HeadThroat   => "head_throat",
            BodyRegion::TorsoUpper   => "torso_upper",
            BodyRegion::TorsoLower   => "torso_lower",
            BodyRegion::BlockHand    => "block_hand",
            BodyRegion::BlockForearm => "block_forearm",
            BodyRegion::LegThigh     => "leg_thigh",
            BodyRegion::LegShin      => "leg_shin",
        }
    }
}

// ---------------------------------------------------------------------------
// Game events (D-03: five variants; replaces Phase 1 engine-core GameEvent)
// ---------------------------------------------------------------------------

/// All side-effects a plugin can produce in a single `on_tick` call.
///
/// The engine dispatches events after `on_tick` returns (D-02: events-only messaging).
///
/// - `Hit`: triggers HP damage broadcast, overlay visual effect.
/// - `RoundOver`: engine broadcasts `MsgRoundEnd`, increments win counter, calls `on_round_reset`.
/// - `SendToPlayer`: delivers `payload` JSON to one player's outbound channel.
/// - `Broadcast`: delivers `payload` JSON to the room's slow-path channel (all connected clients).
/// - `CommentaryHint`: no-op in v1; consumed by v2 commentary engine (COMM-01).
///
/// **Important:** Emit `RoundOver` at most once per round. Use a `round_ended: bool`
/// flag in your state to guard against re-emitting on subsequent ticks.
#[derive(Debug)]
pub enum GameEvent {
    /// A hit landed: attacker hit defender in body region with given damage.
    /// position is [x, y] in normalised space (used for overlay rendering).
    Hit {
        attacker: u8,
        defender: u8,
        region: BodyRegion,
        damage: f32,
        position: [f32; 2],
    },
    /// Round ended. winner = Some(slot_number 1..=2), None = draw (BOX-08).
    RoundOver { winner: Option<u8> },
    /// Send a JSON message to one player's outbound channel.
    SendToPlayer { slot: u8, payload: Value },
    /// Broadcast a JSON message to the room's slow-path channel (spectators + players).
    Broadcast { payload: Value },
    /// Hint for the v2 commentary engine. No-op in Phase 2.
    CommentaryHint { kind: String, payload: Value },
}

// ---------------------------------------------------------------------------
// Tick context types (PLUG-02)
// ---------------------------------------------------------------------------

/// Per-tick timing information. Monotonically incrementing values.
///
/// - `tick`: integer counter incremented by 1 every 60Hz tick from match start.
///   Use this (not `elapsed_secs`) for beat clocks and frame counting — it is exact.
/// - `elapsed_secs`: float seconds since round start. Use for duration comparisons.
/// - `remaining_secs`: float seconds until round time limit. ≤ 0.0 when time expires.
pub struct TickInfo {
    /// Monotonically increasing tick counter (incremented each 60Hz tick).
    pub tick: u64,
    /// Seconds elapsed since round start (after warmup).
    pub elapsed_secs: f64,
    /// Seconds remaining in the current round.
    pub remaining_secs: f64,
}

/// Read-only view of one player slot, passed to the plugin via `RoomView`.
///
/// - `connected`: true if the player's WebSocket is currently open.
/// - `reference_velocity`: `None` until the player submits `CalibrationDone`;
///   `Some(f64)` afterwards (persists through rematches — FIX-01).
pub struct SlotView {
    /// True if the player's WebSocket is currently connected.
    pub connected: bool,
    /// None until the player submits CalibrationDone.
    pub reference_velocity: Option<f64>,
}

/// Read-only view of room-level state, passed to the plugin via `TickContext`.
///
/// - `slots`: views for slot 1 (index 0) and slot 2 (index 1).
/// - `solo_mode`: `true` if the match started in solo/bot mode (only one player
///   calibrated before match start). Set once at match start — **do not re-derive**
///   from `slots[1].connected`; a mid-match disconnect would incorrectly trigger
///   solo logic (WR-01 anti-pattern).
///
/// Plugin uses this to detect solo/bot mode (D-04): `slots[1].connected == false`.
pub struct RoomView {
    pub slots: [SlotView; 2],
    /// True if the match started in solo/bot mode (WR-01: set once at CalibrationDone, not re-derived per tick).
    pub solo_mode: bool,
}

/// All inputs delivered to the plugin for one 60Hz tick.
///
/// - `frames[0]`: released pose frames for slot 1 this tick (may be empty if player is lagging).
/// - `frames[1]`: released pose frames for slot 2 this tick.
///   Frames are normalized to hip-centred Y-up by the engine before delivery (PLUG-06).
///   Frames have passed the RTT fairness input-delay buffer — they are already-released frames only.
/// - `tick_info`: timing for this tick (see `TickInfo`).
/// - `room`: read-only room state (see `RoomView`).
///
/// **Lifetime:** The `'a` lifetime ties `frames` to the engine's per-tick deque reference.
/// Do NOT store `ctx.frames` or references into it in plugin state.
///
/// `frames\[0\]` = slot 1 released pose frames; `frames\[1\]` = slot 2 released pose frames.
/// Frames have already been normalized to hip-centred Y-up by the engine (PLUG-06).
pub struct TickContext<'a> {
    pub frames: [&'a VecDeque<PoseFrame>; 2],
    pub tick_info: TickInfo,
    pub room: RoomView,
}

// ---------------------------------------------------------------------------
// GamePlugin trait (PLUG-01, PLUG-05)
// ---------------------------------------------------------------------------

/// The complete interface for a PoseEngine game.
///
/// Object safety rules satisfied (PLUG-05):
/// - No `async fn` (would break dyn-compatibility via impl Future return)
/// - No `-> Self` return types
/// - No generic type parameters on methods
/// - `&self` receiver on all methods
/// - `Send + Sync` supertrait (auto-traits, do not break object safety)
///
/// Plugin state is stored as `Box<dyn Any + Send>` per room (PLUG-04).
/// Each plugin downcasts in its own methods; the engine never inspects state.
/// BoxingState must be 'static + Send (no references, no non-Send types).
pub trait GamePlugin: Send + Sync {
    /// Creates the initial per-room plugin state.
    ///
    /// **Called when:** Once at room creation time, before any players join or calibrate.
    ///
    /// **Contract:**
    /// - Return a `Box<dyn Any + Send>` containing your plugin's mutable state struct.
    /// - The returned type must be `'static + Send` — store only owned data, no references.
    /// - The engine will pass this box back to every plugin method as `state: &mut dyn Any`.
    ///
    /// **Return:** `Box` containing your state struct (e.g., `Box::new(MyState { ... })`).
    ///
    /// **Do NOT:** store `Arc`, `Rc`, `&str` with lifetimes, or any non-`'static` types.
    /// Downcast in your other methods: `state.downcast_mut::<MyState>().expect("type mismatch")`.
    fn init_state(&self) -> Box<dyn Any + Send>;

    /// The main game loop callback, called 60 times per second during the live round.
    ///
    /// **Called when:** Every tick after warmup ends and both players have calibrated.
    /// The warmup period (3.8 seconds) delivers empty frame slices — `on_tick` is NOT
    /// called during warmup; the engine gates it.
    ///
    /// **Contract:**
    /// - This method must be synchronous and non-blocking (no `await`, no `thread::sleep`).
    /// - Do not call network or I/O. All side-effects must be expressed as returned events.
    /// - The engine dispatches returned events after `on_tick` returns — not during.
    /// - `ctx.frames[0]` = released pose frames for slot 1; `ctx.frames[1]` = slot 2.
    ///   Frames are normalized to hip-centred Y-up coordinates before delivery (PLUG-06).
    ///   Frames have already passed the RTT fairness input-delay buffer.
    ///
    /// **Return:** `Vec<GameEvent>` — the complete list of side-effects for this tick.
    /// Return an empty vec if nothing happened.
    ///
    /// **Do NOT:** mutate engine state directly, store references from `ctx` in plugin
    /// state (the frames borrow ends after this call), or panic on missing frames
    /// (frames may be empty if a player is lagging).
    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;

    /// Returns the number of round wins required to win the overall match.
    ///
    /// **Called when:** Once at room creation, to configure the win counter.
    ///
    /// **Contract:**
    /// - Must return a positive integer ≥ 1.
    /// - The default implementation returns 2. Override to use your config struct value.
    ///
    /// **Return:** Win count (e.g., 3 for best-of-5).
    ///
    /// **Do NOT:** return 0 (would cause the first round to end the match immediately).
    fn max_wins(&self) -> u32 { 2 }

    /// Called when a player's WebSocket connects to the room.
    ///
    /// **Called when:** Each time a player (slot 1 or 2) connects via `/ws/player/{code}`.
    /// May be called multiple times if a player disconnects and reconnects.
    ///
    /// **Contract:**
    /// - `slot` is 0-indexed (0 = player 1, 1 = player 2).
    /// - Default implementation is a no-op. Override only if you need join-triggered logic.
    ///
    /// **Return:** Nothing (unit).
    ///
    /// **Do NOT:** start game logic here — wait for `on_calibration_complete`.
    fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}

    /// Called when a player's WebSocket disconnects from the room.
    ///
    /// **Called when:** Each time a player's connection closes (graceful or network drop).
    ///
    /// **Contract:**
    /// - `slot` is 0-indexed (0 = player 1, 1 = player 2).
    /// - Default implementation is a no-op.
    /// - Do not emit `RoundOver` here — use `ctx.room.solo_mode` in `on_tick` for
    ///   walk-over logic if needed.
    ///
    /// **Return:** Nothing (unit).
    ///
    /// **Do NOT:** clear calibration state here — calibration persists for the room lifetime (FIX-01).
    fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}

    /// Called after the engine records a player's calibration velocity.
    ///
    /// **Called when:** After a player sends `CalibrationDone` from the mobile client,
    /// and the engine has stored `reference_velocity` on the player slot.
    /// Called once per player per room session (calibration persists through rematches, FIX-01).
    ///
    /// **Contract:**
    /// - `slot` is 0-indexed. `ref_vel` is in metres per second (typical range 0.5–15.0).
    /// - Default implementation is a no-op.
    /// - Boxing clamps `ref_vel` to [0.5, 15.0] before storing (D-08).
    /// - Dance ignores this entirely — the signal still serves as "player is ready to start".
    ///
    /// **Return:** Nothing (unit).
    ///
    /// **Do NOT:** clear existing calibration data in `on_round_reset` — it must survive
    /// rematches. Only `init_state` starts with zero calibration data.
    fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}

    /// Called after a round ends and before the next round starts.
    ///
    /// **Called when:** After the engine broadcasts `MsgRoundEnd` and increments the win
    /// counter. Triggered by a `RoundOver` event returned from `on_tick`.
    ///
    /// **Contract:**
    /// - Clear ONLY round-scoped state (HP, cooldowns, combo counters, score accumulators,
    ///   beat counters, round flags).
    /// - Do NOT clear calibration data (`reference_velocity`/`ref_vel`) — it persists
    ///   for the full room session (FIX-01 regression: clearing it was the original bug
    ///   in `server/rooms.py:64`).
    ///
    /// **Return:** Nothing (unit).
    ///
    /// **Do NOT:** emit events here — the return type is `()`. If you need to broadcast
    /// a rematch message, emit `GameEvent::Broadcast` in `on_tick` on the first tick of
    /// the new round.
    fn on_round_reset(&self, _state: &mut dyn Any) {}

    /// Returns the game type string for wire protocol and room metadata.
    /// Default "unknown" — engine is never broken by a plugin that omits this.
    /// Override to return a stable ASCII identifier (e.g., "boxing", "dance").
    fn game_type(&self) -> &'static str { "unknown" }

    /// Returns false if this game does not require pose calibration before match start.
    /// Engine skips the calibration_start / calibration_done handshake when false.
    /// Default true — preserves existing boxing behavior with no override required.
    fn requires_calibration(&self) -> bool { true }

    /// Returns a JSON snapshot of current game state for a late-joining spectator.
    /// Called once on spectator WS connect during an active match.
    /// Return None if no mid-match state is meaningful (e.g., before first round starts).
    fn spectator_snapshot(&self, _state: &dyn Any) -> Option<serde_json::Value> { None }

    /// Returns the initial HP per player for this game mode.
    /// Used by the engine to set RoomState.hp at creation and reset between rounds (WR-01).
    /// Default 800 matches the canonical boxing value.
    /// Override in boxing plugin to return self.config.hp.
    fn initial_hp(&self) -> u32 { 800 }

    /// Returns the current per-player HP after the most recent on_tick, or None if
    /// this game has no HP concept (e.g. dance). The plugin is the source of truth
    /// for HP — it's the one that subtracts damage in `on_tick`. The engine calls
    /// this method once per tick to mirror that value into `RoomState.hp` for
    /// MsgGameState broadcasts and MsgRoundEnd.final_hp.
    ///
    /// Without this hook, the engine had to either re-subtract damage from
    /// GameEvent::Hit (which double-counted, draining the spectator HP bar at
    /// 2× the rate of actual gameplay) or downcast the plugin state by concrete
    /// type (couples engine to plugin internals).
    fn current_hp(&self, _state: &dyn Any) -> Option<[u32; 2]> { None }
}
