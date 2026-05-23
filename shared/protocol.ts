// Wire protocol mirrored by hand from engine/engine-core/src/protocol.rs.
//
// The Rust side derives `#[derive(TS)]` per struct and writes one .ts file
// per type into shared/bindings/ (verify after editing the
// Rust struct: `cd engine && cargo test`). This consolidated file
// re-states those interfaces so the frontends can import a single
// `@shared/protocol` module, and also adds the discriminated unions
// (InboundServerMsg, ServerMessage) — those are deliberately NOT
// ts-rs-derived because they are TypeScript-only constructs (the Rust
// dispatcher uses `serde(tag = "type")` enums instead).
//
// Drift protection: every Msg* struct in protocol.rs is exercised by a
// fixture-backed roundtrip test in tests/protocol_roundtrip.rs, so a
// shape change on the Rust side surfaces immediately. Keep the
// interfaces below in sync with the per-type files under
// shared/bindings/ whenever you touch the Rust side.

export type PlayerSlot = 1 | 2;
export type HpPair = [number, number];

export interface PoseKeypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

// ============================================================================
// Mobile -> Server
// ============================================================================

export interface MsgJoin {
  type: "join";
  room_code: string;
  player_slot: 1 | 2;
  // Set true for solo-vs-bot sessions. When absent or false the server treats
  // the room as two-player and waits for P2 instead of auto-starting solo
  // mode the moment P1 is the only connected player.
  solo?: boolean;
}

export interface MsgPoseFrame {
  type: "pose_frame";
  timestamp: number;
  keypoints: PoseKeypoint[];
}

export interface MsgCalibrationDone {
  type: "calibration_done";
  reference_velocity: number;
}

export interface MsgPing {
  type: "ping";
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
  game_type: string;
}

export interface MsgPong {
  type: "pong";
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

// ============================================================================
// Server -> Overlay
// ============================================================================

export interface HitEvent {
  player: 1 | 2;
  region: string;
  damage: number;
  position: Position;
}

export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  wins: [number, number];  // FIX-02: wins counter prevents overlay desync on reconnect
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
  remaining_time: number;
  max_wins: number;
}

// Pushed to spectators the moment a pose_frame arrives — decoupled from
// the 60 Hz game-state tick so the overlay renders at mobile capture rate.
export interface MsgPoseUpdate {
  type: "pose_update";
  player: 1 | 2;
  keypoints: PoseKeypoint[];
}

// Commentator messages (server -> overlay only).
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
  mime: string;
  audio_b64: string;
}

export interface MsgCommentaryEnd {
  type: "commentary_end";
  id: number;
}

export interface MsgLobbyUpdate {
  type: "lobby_update";
  p1: boolean;
  p2: boolean;
  // Identifies the game running in the room ("boxing", "fps_boxing", "dance").
  // The spectator overlay uses this to pick which HUD to render — without it,
  // gameType stays null on the client and the HUD is silently disabled.
  // The Rust side keeps `#[serde(default)]` as a forwards-compat shim for
  // legacy fixtures, but the server always emits this field today.
  game_type: string;
}

export interface MsgRematchStart {
  type: "rematch_start";
}

// Spectator snapshot sent on connect for an in-progress dance round.
// Mirrors `MsgDanceSnapshot` in protocol.rs (also in
// shared/bindings/MsgDanceSnapshot.ts). Locked against drift by
// msg_dance_snapshot_roundtrip in protocol_roundtrip.rs.
export interface MsgDanceSnapshot {
  type: "dance_snapshot";
  game_type: "dance";
  beat: number;
  scores: [number, number];
}

// Dance game messages (server -> mobile and spectator overlay)
export interface MsgDanceBeat {
  type: "dance_beat";
  beat: number;
  total_beats: number;
  /** Per-keypoint data as [x, y, z, visibility]. */
  target_pose: Array<[number, number, number, number]>;
}

export interface MsgDanceScore {
  type: "dance_score";
  beat: number;
  /** Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0]. */
  scores: [number, number];
}

// FPS Boxing game messages (server -> mobile, Phase 10: FPSP-03, FPSP-04)
export interface MsgFpsState {
  type: "fps_state";
  left_shoulder: PoseKeypoint;
  right_shoulder: PoseKeypoint;
  left_elbow: PoseKeypoint;
  right_elbow: PoseKeypoint;
  left_wrist: PoseKeypoint;
  right_wrist: PoseKeypoint;
  /** HP for both players: [player_1_hp, player_2_hp]. */
  hp: [number, number];
  /** Seconds remaining in the current round. ≤ 0.0 when time expires. */
  round_timer: number;
}

export interface MsgFpsHit {
  type: "fps_hit";
  /** Punch type: "cross", "body_shot", "kick", or "blocked". */
  punch_type: string;
  damage: number;
}

export type InboundServerMsg =
  | MsgJoined
  | MsgPing
  | MsgPong
  | MsgCalibrationStart
  | MsgMatchStart
  | MsgYouWereHit
  | MsgPlayerDisconnected
  | MsgRoundStart
  | MsgRoundEnd
  | MsgMatchEnd
  | MsgRematchStart
  | MsgGameState
  | MsgPoseUpdate
  | MsgDanceBeat
  | MsgDanceScore
  | MsgFpsState
  | MsgFpsHit
  | MsgCommentaryStart
  | MsgCommentaryText
  | MsgCommentaryAudio
  | MsgCommentaryEnd;

export type ServerMessage =
  | MsgJoined
  | MsgLobbyUpdate
  | MsgGameState
  | MsgPoseUpdate
  | MsgRoundStart
  | MsgRoundEnd
  | MsgMatchEnd
  | MsgRematchStart
  | MsgPlayerDisconnected
  | MsgDanceBeat
  | MsgDanceScore
  | MsgDanceSnapshot
  | MsgCommentaryStart
  | MsgCommentaryText
  | MsgCommentaryAudio
  | MsgCommentaryEnd;
