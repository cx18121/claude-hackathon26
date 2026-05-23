// AUTO-GENERATED from shared/bindings/*.ts + shared/protocol.unions.ts.tmpl.
// Do not edit by hand — re-run scripts/regen-protocol.sh after changing
// either engine/engine-core/src/protocol.rs or
// shared/protocol.unions.ts.tmpl.
//
// The per-type interfaces below come from ts-rs (`#[derive(TS)]` in the
// Rust source). The unions and aliases at the bottom come from the
// template file because ts-rs can't emit cross-struct discriminated
// unions.


export type HitEvent = { player: 1 | 2, region: string, damage: number, position: Position, };

export type MsgCalibrationDone = { type: "calibration_done", reference_velocity: number, };

export type MsgCalibrationStart = { type: "calibration_start", };

export type MsgCommentaryAudio = { type: "commentary_audio", id: number, idx: number, mime: string, audio_b64: string, };

export type MsgCommentaryEnd = { type: "commentary_end", id: number, };

export type MsgCommentaryStart = { type: "commentary_start", id: number, };

export type MsgCommentaryText = { type: "commentary_text", id: number, delta: string, };

export type MsgDanceBeat = { type: "dance_beat", beat: number, total_beats: number, 
/**
 * Per-keypoint data as [x, y, z, visibility]. Matches the json!() payload from
 * DancePlugin::on_tick: `[kp.x, kp.y, kp.z, kp.visibility]` per keypoint.
 */
target_pose: Array<[number, number, number, number]>, };

export type MsgDanceScore = { type: "dance_score", beat: number, 
/**
 * Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0].
 */
scores: [number, number], };

/**
 * Spectator snapshot sent on connect for an in-progress dance round.
 * Emitted by `DancePlugin::spectator_snapshot`. Lives next to the other
 * dance messages so the TS binding stays on the same ts-rs generation
 * path instead of drifting as a hand-written entry in shared/protocol.ts.
 */
export type MsgDanceSnapshot = { type: "dance_snapshot", 
/**
 * Always "dance" — kept explicit so spectators can pre-narrow on it
 * before applying the rest of the fields.
 */
game_type: string, beat: number, 
/**
 * Cumulative similarity scores for [player_1, player_2]. Range [0.0, 1.0].
 */
scores: [number, number], };

/**
 * Hit notification for fps_boxing rooms.
 * Sent via SendToPlayer to the RECEIVING player only (not the attacker).
 */
export type MsgFpsHit = { type: "fps_hit", 
/**
 * Punch type string: "cross", "body_shot", "kick", or "blocked".
 * Uses same string enum convention as boxing protocol (D-06).
 */
punch_type: string, damage: number, };

/**
 * Per-tick state broadcast for fps_boxing rooms.
 * Sent to each player containing their OPPONENT's 6 arm landmarks, both HP values, and round timer.
 * Two separate SendToPlayer events per tick — player 0 gets player 1's landmarks; player 1 gets player 0's.
 * Uses protocol::PoseKeypoint (has Serialize) NOT plugin_trait::PoseKeypoint (no Serialize).
 */
export type MsgFpsState = { type: "fps_state", left_shoulder: PoseKeypoint, right_shoulder: PoseKeypoint, left_elbow: PoseKeypoint, right_elbow: PoseKeypoint, left_wrist: PoseKeypoint, right_wrist: PoseKeypoint, 
/**
 * HP for both players: (player_1_hp, player_2_hp). Tuple renders as [number, number] in TypeScript.
 */
hp: [number, number], 
/**
 * Seconds remaining in the current round. ≤ 0.0 when time expires.
 */
round_timer: number, };

export type MsgGameState = { type: "game_state", tick: number, hp: [number, number], 
/**
 * FIX-02: wins counter in snapshot prevents overlay desync on reconnect
 */
wins: [number, number], poses: [Array<PoseKeypoint>, Array<PoseKeypoint>], recent_hits: Array<HitEvent>, high_latency: boolean, remaining_time: number, max_wins: number, };

export type MsgJoin = { type: "join", room_code: string, player_slot: 1 | 2, solo: boolean, };

export type MsgJoined = { type: "joined", room_code: string, player_slot: 1 | 2, opponent_connected: boolean, game_type: string, };

export type MsgLobbyUpdate = { type: "lobby_update", p1: boolean, p2: boolean, 
/**
 * Identifies the game running in this room ("boxing", "fps_boxing",
 * "dance"). The spectator overlay uses this to pick which HUD to render
 * (HudLayer for boxing-like games, DanceHud for dance) — without it,
 * gameType stays null on the client and no HUD shows.
 */
game_type: string, };

export type MsgMatchEnd = { type: "match_end", winner: 1 | 2, };

export type MsgMatchStart = { type: "match_start", };

export type MsgPing = { type: "ping", t: number, };

export type MsgPlayerDisconnected = { type: "player_disconnected", player: 1 | 2, };

export type MsgPong = { type: "pong", t: number, };

export type MsgPoseFrame = { type: "pose_frame", timestamp: number, keypoints: Array<PoseKeypoint>, };

export type MsgPoseUpdate = { type: "pose_update", player: 1 | 2, keypoints: Array<PoseKeypoint>, };

export type MsgRematchStart = { type: "rematch_start", };

export type MsgRoundEnd = { type: "round_end", 
/**
 * null means draw; 1 or 2 is the winning player
 */
winner: 1 | 2 | null, final_hp: [number, number], };

export type MsgRoundStart = { type: "round_start", round_number: number, };

export type MsgYouWereHit = { type: "you_were_hit", region: string, damage: number, };

export type PoseKeypoint = { x: number, y: number, z: number, visibility: number, };

export type Position = { x: number, y: number, z: number, };



// ----------------------------------------------------------------------------
// Hand-maintained aliases + discriminated unions
//
// ts-rs cannot emit these — the unions need literal-type narrowing across
// individual message structs, which lives entirely on the TypeScript side.
// Edit this file (NOT the generated shared/protocol.ts) and re-run
// `scripts/regen-protocol.sh` to publish.
// ----------------------------------------------------------------------------

export type PlayerSlot = 1 | 2;
export type HpPair = [number, number];

// Mobile -> Server
export type OutboundMobileMsg =
  | MsgJoin
  | MsgPoseFrame
  | MsgCalibrationDone
  | MsgPing
  | MsgPong;

// Everything the engine can push to a player WebSocket. mobile/ and fps/
// dispatch off this union; spectator-only messages (game_state, pose_update,
// commentary_*) also arrive here on the same socket and are ignored by the
// shared message switch in useGameSocketBase.
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

// Everything the engine can push to a spectator overlay WebSocket. Distinct
// from InboundServerMsg because spectators never get join handshake or
// per-player hit events — they get game_state ticks and lobby state instead.
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
