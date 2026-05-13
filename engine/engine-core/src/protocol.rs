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
    pub msg_type: String,
    pub room_code: String,
    pub player_slot: u8,
}

fn default_type_pose_frame() -> String {
    "pose_frame".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPoseFrame {
    #[serde(rename = "type", default = "default_type_pose_frame")]
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
    pub msg_type: String,
    pub t: f64,
}

// ============================================================================
// Outbound messages: Server -> Mobile
// ============================================================================

fn default_type_joined() -> String {
    "joined".to_string()
}

fn default_game_type_unknown() -> String { "unknown".to_string() }

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgJoined {
    #[serde(rename = "type", default = "default_type_joined")]
    pub msg_type: String,
    pub room_code: String,
    pub player_slot: u8,
    pub opponent_connected: bool,
    #[serde(default = "default_game_type_unknown")]
    pub game_type: String,
}

fn default_type_calibration_start() -> String {
    "calibration_start".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgCalibrationStart {
    #[serde(rename = "type", default = "default_type_calibration_start")]
    pub msg_type: String,
}

fn default_type_match_start() -> String {
    "match_start".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgMatchStart {
    #[serde(rename = "type", default = "default_type_match_start")]
    pub msg_type: String,
}

fn default_type_you_were_hit() -> String {
    "you_were_hit".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgYouWereHit {
    #[serde(rename = "type", default = "default_type_you_were_hit")]
    pub msg_type: String,
    pub region: String,
    pub damage: f64,
}

fn default_type_player_disconnected() -> String {
    "player_disconnected".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPlayerDisconnected {
    #[serde(rename = "type", default = "default_type_player_disconnected")]
    pub msg_type: String,
    pub player: u8,
}

fn default_type_round_start() -> String {
    "round_start".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRoundStart {
    #[serde(rename = "type", default = "default_type_round_start")]
    pub msg_type: String,
    pub round_number: u32,
}

fn default_type_round_end() -> String {
    "round_end".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRoundEnd {
    #[serde(rename = "type", default = "default_type_round_end")]
    pub msg_type: String,
    /// null means draw; 1 or 2 is the winning player
    pub winner: Option<u8>,
    pub final_hp: (u32, u32),
}

fn default_type_match_end() -> String {
    "match_end".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgMatchEnd {
    #[serde(rename = "type", default = "default_type_match_end")]
    pub msg_type: String,
    pub winner: u8,
}

fn default_type_rematch_start() -> String {
    "rematch_start".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRematchStart {
    #[serde(rename = "type", default = "default_type_rematch_start")]
    pub msg_type: String,
}

fn default_type_dance_beat() -> String {
    "dance_beat".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceBeat {
    #[serde(rename = "type", default = "default_type_dance_beat")]
    pub msg_type: String,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub beat: u64,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub total_beats: u64,
    /// Per-keypoint data as [x, y, z, visibility]. Matches the json!() payload from
    /// DancePlugin::on_tick: `[kp.x, kp.y, kp.z, kp.visibility]` per keypoint.
    pub target_pose: Vec<[f64; 4]>,
}

fn default_type_dance_score() -> String {
    "dance_score".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceScore {
    #[serde(rename = "type", default = "default_type_dance_score")]
    pub msg_type: String,
    #[ts(type = "number")]  // WR-04: override bigint → number; shared/protocol.ts is authoritative
    pub beat: u64,
    /// Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0].
    pub scores: [f64; 2],
}

// ============================================================================
// Outbound messages: Server -> Overlay
// ============================================================================

fn default_type_game_state() -> String {
    "game_state".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgGameState {
    #[serde(rename = "type", default = "default_type_game_state")]
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

fn default_type_pose_update() -> String {
    "pose_update".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgPoseUpdate {
    #[serde(rename = "type", default = "default_type_pose_update")]
    pub msg_type: String,
    pub player: u8,
    pub keypoints: Vec<PoseKeypoint>,
}

fn default_type_lobby_update() -> String {
    "lobby_update".to_string()
}

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgLobbyUpdate {
    #[serde(rename = "type", default = "default_type_lobby_update")]
    pub msg_type: String,
    pub p1: bool,
    pub p2: bool,
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

fn default_type_fps_state() -> String {
    "fps_state".to_string()
}

/// Per-tick state broadcast for fps_boxing rooms.
/// Sent to each player containing their OPPONENT's 6 arm landmarks, both HP values, and round timer.
/// Two separate SendToPlayer events per tick — player 0 gets player 1's landmarks; player 1 gets player 0's.
/// Uses protocol::PoseKeypoint (has Serialize) NOT plugin_trait::PoseKeypoint (no Serialize).
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgFpsState {
    #[serde(rename = "type", default = "default_type_fps_state")]
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

fn default_type_fps_hit() -> String {
    "fps_hit".to_string()
}

/// Hit notification for fps_boxing rooms.
/// Sent via SendToPlayer to the RECEIVING player only (not the attacker).
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgFpsHit {
    #[serde(rename = "type", default = "default_type_fps_hit")]
    pub msg_type: String,
    /// Punch type string: "cross", "body_shot", "kick", or "blocked".
    /// Uses same string enum convention as boxing protocol (D-06).
    pub punch_type: String,
    pub damage: u32,
}
