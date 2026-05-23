use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Embedded types (no discriminator field)
// ============================================================================

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
pub struct Position {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct HitEvent {
    pub player: u8,
    pub region: String,
    pub damage: f64,
    pub position: Position,
}

// ============================================================================
// Inbound messages: Mobile -> Server
// ============================================================================

fn default_type_join() -> String {
    "join".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgJoin {
    #[serde(rename = "type", default = "default_type_join")]
    #[ts(type = "\"join\"")]
    pub msg_type: String,
    pub room_code: String,
    pub player_slot: u8,
    // Set true for solo-vs-bot sessions. Default false means the server
    // treats the room as two-player and waits for P2.
    #[serde(default)]
    pub solo: bool,
}

fn default_type_pose_frame() -> String {
    "pose_frame".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPoseFrame {
    #[serde(rename = "type", default = "default_type_pose_frame")]
    #[ts(type = "\"pose_frame\"")]
    pub msg_type: String,
    pub timestamp: f64,
    pub keypoints: Vec<PoseKeypoint>,
}

fn default_type_calibration_done() -> String {
    "calibration_done".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCalibrationDone {
    #[serde(rename = "type", default = "default_type_calibration_done")]
    #[ts(type = "\"calibration_done\"")]
    pub msg_type: String,
    pub reference_velocity: f64,
}

fn default_type_ping() -> String {
    "ping".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPing {
    #[serde(rename = "type", default = "default_type_ping")]
    #[ts(type = "\"ping\"")]
    pub msg_type: String,
    pub t: f64,
}

fn default_type_pong() -> String {
    "pong".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPong {
    #[serde(rename = "type", default = "default_type_pong")]
    #[ts(type = "\"pong\"")]
    pub msg_type: String,
    pub t: f64,
}

// ============================================================================
// Outbound messages: Server -> Mobile
// ============================================================================

fn default_game_type_unknown() -> String { "unknown".to_string() }

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgJoined {
    #[serde(rename = "type")]
    #[ts(type = "\"joined\"")]
    pub msg_type: String,
    pub room_code: String,
    pub player_slot: u8,
    pub opponent_connected: bool,
    #[serde(default = "default_game_type_unknown")]
    pub game_type: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCalibrationStart {
    #[serde(rename = "type")]
    #[ts(type = "\"calibration_start\"")]
    pub msg_type: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgMatchStart {
    #[serde(rename = "type")]
    #[ts(type = "\"match_start\"")]
    pub msg_type: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgYouWereHit {
    #[serde(rename = "type")]
    #[ts(type = "\"you_were_hit\"")]
    pub msg_type: String,
    pub region: String,
    pub damage: f64,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPlayerDisconnected {
    #[serde(rename = "type")]
    #[ts(type = "\"player_disconnected\"")]
    pub msg_type: String,
    pub player: u8,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRoundStart {
    #[serde(rename = "type")]
    #[ts(type = "\"round_start\"")]
    pub msg_type: String,
    pub round_number: u32,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRoundEnd {
    #[serde(rename = "type")]
    #[ts(type = "\"round_end\"")]
    pub msg_type: String,
    /// null means draw; 1 or 2 is the winning player
    pub winner: Option<u8>,
    pub final_hp: (u32, u32),
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgMatchEnd {
    #[serde(rename = "type")]
    #[ts(type = "\"match_end\"")]
    pub msg_type: String,
    pub winner: u8,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRematchStart {
    #[serde(rename = "type")]
    #[ts(type = "\"rematch_start\"")]
    pub msg_type: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceBeat {
    #[serde(rename = "type")]
    #[ts(type = "\"dance_beat\"")]
    pub msg_type: String,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub beat: u64,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub total_beats: u64,
    /// Per-keypoint data as [x, y, z, visibility]. Matches the json!() payload from
    /// DancePlugin::on_tick: `[kp.x, kp.y, kp.z, kp.visibility]` per keypoint.
    pub target_pose: Vec<[f64; 4]>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceScore {
    #[serde(rename = "type")]
    #[ts(type = "\"dance_score\"")]
    pub msg_type: String,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub beat: u64,
    /// Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0].
    pub scores: [f64; 2],
}

// ============================================================================
// Commentary stream (server -> overlay only)
//
// The commentator task in src/commentator.rs serializes these via
// serde_json::to_string instead of raw format!() — same drift-prevention
// pattern as MsgDanceSnapshot. Roundtrip tests in tests/protocol_roundtrip.rs
// keep the wire shape locked.
// ============================================================================

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCommentaryStart {
    #[serde(rename = "type")]
    #[ts(type = "\"commentary_start\"")]
    pub msg_type: String,
    pub id: u32,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCommentaryText {
    #[serde(rename = "type")]
    #[ts(type = "\"commentary_text\"")]
    pub msg_type: String,
    pub id: u32,
    pub delta: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCommentaryAudio {
    #[serde(rename = "type")]
    #[ts(type = "\"commentary_audio\"")]
    pub msg_type: String,
    pub id: u32,
    pub idx: u32,
    pub mime: String,
    pub audio_b64: String,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCommentaryEnd {
    #[serde(rename = "type")]
    #[ts(type = "\"commentary_end\"")]
    pub msg_type: String,
    pub id: u32,
}

/// Spectator snapshot sent on connect for an in-progress dance round.
/// Emitted by `DancePlugin::spectator_snapshot`. Lives next to the other
/// dance messages so the TS binding stays on the same ts-rs generation
/// path instead of drifting as a hand-written entry in shared/protocol.ts.
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceSnapshot {
    #[serde(rename = "type")]
    #[ts(type = "\"dance_snapshot\"")]
    pub msg_type: String,
    /// Always "dance" — kept explicit so spectators can pre-narrow on it
    /// before applying the rest of the fields.
    pub game_type: String,
    #[ts(type = "number")]  // override bigint → number to match the other dance messages
    pub beat: u64,
    /// Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0].
    pub scores: [f64; 2],
}

// ============================================================================
// Outbound messages: Server -> Overlay
// ============================================================================

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgGameState {
    #[serde(rename = "type")]
    #[ts(type = "\"game_state\"")]
    pub msg_type: String,
    pub tick: u64,
    pub hp: (u32, u32),
    /// FIX-02: wins counter in snapshot prevents overlay desync on reconnect
    pub wins: (u32, u32),
    pub poses: (Vec<PoseKeypoint>, Vec<PoseKeypoint>),
    pub recent_hits: Vec<HitEvent>,
    pub high_latency: bool,
    pub remaining_time: f64,
    pub max_wins: u32,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPoseUpdate {
    #[serde(rename = "type")]
    #[ts(type = "\"pose_update\"")]
    pub msg_type: String,
    pub player: u8,
    pub keypoints: Vec<PoseKeypoint>,
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgLobbyUpdate {
    #[serde(rename = "type")]
    #[ts(type = "\"lobby_update\"")]
    pub msg_type: String,
    pub p1: bool,
    pub p2: bool,
    /// Identifies the game running in this room ("boxing", "fps_boxing",
    /// "dance"). The spectator overlay uses this to pick which HUD to render
    /// (HudLayer for boxing-like games, DanceHud for dance) — without it,
    /// gameType stays null on the client and no HUD shows.
    #[serde(default)]
    pub game_type: String,
}

// ============================================================================
// Inbound discriminated union for WebSocket message dispatch
// NOTE: Do NOT derive TS on this enum — TypeScript side uses hand-maintained
// discriminated unions in shared/protocol.ts.
// ============================================================================

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum InboundMobileMsg {
    #[serde(rename = "join")]
    Join(MsgJoin),
    #[serde(rename = "pose_frame")]
    PoseFrame(MsgPoseFrame),
    #[serde(rename = "calibration_done")]
    CalibrationDone(MsgCalibrationDone),
    #[serde(rename = "ping")]
    Ping(MsgPing),
    #[serde(rename = "pong")]
    Pong(MsgPong),
}

// ============================================================================
// FPS Boxing messages (Phase 10: FPSP-03, FPSP-04)
// ============================================================================

/// Per-tick state broadcast for fps_boxing rooms.
/// Sent to each player containing their OPPONENT's 6 arm landmarks, both HP values, and round timer.
/// Two separate SendToPlayer events per tick — player 0 gets player 1's landmarks; player 1 gets player 0's.
/// Uses protocol::PoseKeypoint (has Serialize) NOT plugin_trait::PoseKeypoint (no Serialize).
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgFpsState {
    #[serde(rename = "type")]
    #[ts(type = "\"fps_state\"")]
    pub msg_type: String,
    pub left_shoulder: PoseKeypoint,
    pub right_shoulder: PoseKeypoint,
    pub left_elbow: PoseKeypoint,
    pub right_elbow: PoseKeypoint,
    pub left_wrist: PoseKeypoint,
    pub right_wrist: PoseKeypoint,
    /// HP for both players: (player_1_hp, player_2_hp). Tuple renders as [number, number] in TypeScript.
    pub hp: (u32, u32),
    /// Seconds remaining in the current round. ≤ 0.0 when time expires.
    pub round_timer: f64,
}

/// Hit notification for fps_boxing rooms.
/// Sent via SendToPlayer to the RECEIVING player only (not the attacker).
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgFpsHit {
    #[serde(rename = "type")]
    #[ts(type = "\"fps_hit\"")]
    pub msg_type: String,
    /// Punch type string: "cross", "body_shot", "kick", or "blocked".
    /// Uses same string enum convention as boxing protocol (D-06).
    pub punch_type: String,
    pub damage: u32,
}
