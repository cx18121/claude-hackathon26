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

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgJoined {
    #[serde(rename = "type", default = "default_type_joined")]
    pub msg_type: String,
    pub room_code: String,
    pub player_slot: u8,
    pub opponent_connected: bool,
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
