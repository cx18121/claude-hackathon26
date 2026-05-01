// Canonical protocol definitions for Shadow Fight.
// Server's protocol.py mirrors this file as Pydantic models.
// Mobile and overlay each import their own copy to avoid cross-package paths.

export type PlayerSlot = 1 | 2;
export type HpPair = [number, number];

export interface PoseKeypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

// ============================================================================
// Mobile -> Server
// ============================================================================

export interface MsgJoin {
  type: "join";
  room_code: string;
  player_slot: 1 | 2;
}

export interface MsgPoseFrame {
  type: "pose_frame";
  timestamp: number; // seconds
  keypoints: PoseKeypoint[]; // always 33
}

export interface MsgCalibrationDone {
  type: "calibration_done";
  reference_velocity: number;
}

export interface MsgPing {
  type: "ping";
  t: number;
}

export interface MsgPong {
  type: "pong";
  t: number;
}

export type OutboundMobileMsg =
  | MsgJoin
  | MsgPoseFrame
  | MsgCalibrationDone
  | MsgPing
  | MsgPong;

// ============================================================================
// Server -> Mobile
// ============================================================================

export interface MsgJoined {
  type: "joined";
  room_code: string;
  player_slot: 1 | 2;
  opponent_connected: boolean;
}

export interface MsgPongFromServer {
  type: "pong";
  t: number;
}

export interface MsgPingFromServer {
  type: "ping";
  t: number;
}

export interface MsgCalibrationStart {
  type: "calibration_start";
}

export interface MsgMatchStart {
  type: "match_start";
}

export interface MsgYouWereHit {
  type: "you_were_hit";
  region: string;
  damage: number;
}

export interface MsgPlayerDisconnected {
  type: "player_disconnected";
  player: 1 | 2;
}

export interface MsgRoundStart {
  type: "round_start";
  round_number: number;
}

export interface MsgRoundEnd {
  type: "round_end";
  winner: 1 | 2 | null;
  final_hp: [number, number];
}

export interface MsgMatchEnd {
  type: "match_end";
  winner: 1 | 2;
}

export interface HitEvent {
  player: 1 | 2;
  region: string;
  damage: number;
  position: { x: number; y: number; z: number };
}

export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
  remaining_time: number;
  max_wins: number;
}

// Pushed to spectators the moment a pose_frame arrives from a mobile client,
// decoupled from the 60Hz game-state tick so the overlay can render at the
// mobile capture rate (~60Hz) without waiting on the server tick.
export interface MsgPoseUpdate {
  type: "pose_update";
  player: 1 | 2;
  keypoints: PoseKeypoint[];
}

// Live commentator messages. Server -> overlay only.
export interface MsgCommentaryStart {
  type: "commentary_start";
  id: number;
}

export interface MsgCommentaryText {
  type: "commentary_text";
  id: number;
  delta: string;
}

export interface MsgCommentaryAudio {
  type: "commentary_audio";
  id: number;
  idx: number;
  mime: string; // "audio/mpeg"
  audio_b64: string; // base64-encoded mp3 from ElevenLabs
}

export interface MsgCommentaryEnd {
  type: "commentary_end";
  id: number;
}

export type InboundServerMsg =
  | MsgJoined
  | MsgPongFromServer
  | MsgPingFromServer
  | MsgCalibrationStart
  | MsgMatchStart
  | MsgYouWereHit
  | MsgPlayerDisconnected
  | MsgRoundStart
  | MsgRoundEnd
  | MsgMatchEnd
  | MsgGameState
  | MsgPoseUpdate
  | MsgCommentaryStart
  | MsgCommentaryText
  | MsgCommentaryAudio
  | MsgCommentaryEnd;

export type ServerMessage =
  | MsgGameState
  | MsgPoseUpdate
  | MsgRoundStart
  | MsgRoundEnd
  | MsgMatchEnd
  | MsgCommentaryStart
  | MsgCommentaryText
  | MsgCommentaryAudio
  | MsgCommentaryEnd;
