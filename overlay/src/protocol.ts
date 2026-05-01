// Local copy of shared/protocol.ts — keep in sync if the canonical file changes.
// Self-contained so this package can build without access to the repo root.

export type PlayerSlot = 1 | 2;
export type HpPair = [number, number];

export interface PoseKeypoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
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

export interface MsgPoseUpdate {
  type: "pose_update";
  player: 1 | 2;
  keypoints: PoseKeypoint[];
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

export interface MsgPlayerDisconnected {
  type: "player_disconnected";
  player: 1 | 2;
}

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
