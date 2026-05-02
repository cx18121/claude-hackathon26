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
/// Y-up: positive Y = above hip centre; negative Y = below hip centre.
#[derive(Clone, Debug)]
pub struct PoseKeypoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub visibility: f64,
}

/// A single pose frame delivered to the plugin via TickContext.
/// Timestamp is in seconds (matches MsgPoseFrame.timestamp from protocol.rs).
#[derive(Clone, Debug)]
pub struct PoseFrame {
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}

// ---------------------------------------------------------------------------
// Body region classification (BOX-03: 9 regions)
// ---------------------------------------------------------------------------

/// Nine body regions for hit classification.
/// Use `to_wire()` for JSON wire format (snake_case). Do NOT use `format!("{:?}", r).to_lowercase()`
/// as Debug emits PascalCase which collapses to concatenated lowercase (CR-05).
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

/// All side-effects a plugin can produce in a single tick.
/// Engine dispatches these after on_tick returns (D-02: events-only messaging).
/// CommentaryHint is a no-op in Phase 2; v2 commentary engine will consume it.
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

/// Per-tick timing information passed to the plugin.
pub struct TickInfo {
    /// Monotonically increasing tick counter (incremented each 60Hz tick).
    pub tick: u64,
    /// Seconds elapsed since round start (after warmup).
    pub elapsed_secs: f64,
    /// Seconds remaining in the current round.
    pub remaining_secs: f64,
}

/// Read-only view of a player slot, passed to the plugin via RoomView.
pub struct SlotView {
    /// True if the player's WebSocket is currently connected.
    pub connected: bool,
    /// None until the player submits CalibrationDone.
    pub reference_velocity: Option<f64>,
}

/// Read-only view of the room state, passed to the plugin via TickContext.
/// Plugin uses this to detect solo/bot mode (D-04): slots[1].connected == false.
pub struct RoomView {
    pub slots: [SlotView; 2],
    /// True if the match started in solo/bot mode (WR-01: set once at CalibrationDone, not re-derived per tick).
    pub solo_mode: bool,
}

/// All inputs delivered to the plugin for one 60Hz tick.
/// frames[0] = slot 1 released pose frames; frames[1] = slot 2 released pose frames.
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
    /// Create initial per-room plugin state. Called once per room creation.
    /// The returned box must be `'static + Send` — store only owned data.
    fn init_state(&self) -> Box<dyn Any + Send>;

    /// Called every 60Hz tick during the live round phase (after warmup).
    /// Returns a vec of side-effects; engine dispatches them after this returns.
    /// This is a pure function: inputs in, events out. No network calls, no async.
    fn on_tick(&self, ctx: &TickContext, state: &mut dyn Any) -> Vec<GameEvent>;

    /// Returns the number of round wins required to win the match (CR-02).
    /// Default: 2. Override in your plugin to use config-driven values.
    fn max_wins(&self) -> u32 { 2 }

    /// Called when a player's WebSocket connects to the room.
    fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}

    /// Called when a player's WebSocket disconnects from the room.
    fn on_player_leave(&self, _slot: u8, _state: &mut dyn Any) {}

    /// Called after the engine stores reference_velocity on PlayerSlot.
    /// Plugin stores a clamped copy in plugin state for use in hit detection.
    fn on_calibration_complete(&self, _slot: u8, _ref_vel: f64, _state: &mut dyn Any) {}

    /// Called after RoundOver is broadcast and wins are incremented.
    /// Plugin clears ONLY round-scoped state (HP, cooldowns, combos).
    /// Must NOT clear reference_velocity — FIX-01.
    fn on_round_reset(&self, _state: &mut dyn Any) {}
}
