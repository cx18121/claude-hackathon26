export interface PoseKeypoint {
  x: number
  y: number
  z: number
  visibility: number
}

export type PlayerSlot = 1 | 2
export type HpPair = [number, number]

export interface MsgJoin {
  type: 'join'
  room_code: string
  player_slot: PlayerSlot
}

export interface MsgPoseFrame {
  type: 'pose_frame'
  timestamp: number
  keypoints: PoseKeypoint[]
}

export interface MsgCalibrationDone {
  type: 'calibration_done'
  reference_velocity: number
}

export interface MsgPing {
  type: 'ping'
  t: number
}

export interface MsgJoined {
  type: 'joined'
  room_code: string
  player_slot: PlayerSlot
  opponent_connected: boolean
}

export interface MsgPong {
  type: 'pong'
  t: number
}

export interface MsgCalibrationStart {
  type: 'calibration_start'
}

export interface MsgMatchStart {
  type: 'match_start'
}

export interface MsgYouWereHit {
  type: 'you_were_hit'
  region: string
  damage: number
}

export interface HitEvent {
  player: PlayerSlot
  region: string
  damage: number
  position: { x: number; y: number; z: number }
}

export interface MsgGameState {
  type: 'game_state'
  tick: number
  hp: HpPair
  poses: [PoseKeypoint[], PoseKeypoint[]]
  recent_hits: HitEvent[]
  high_latency: boolean
  remaining_time?: number
}

export interface MsgRoundStart {
  type: 'round_start'
  round_number: number
}

export interface MsgRoundEnd {
  type: 'round_end'
  winner: PlayerSlot
  final_hp: HpPair
}

export interface MsgMatchEnd {
  type: 'match_end'
  winner: PlayerSlot
}

export interface MsgPlayerDisconnected {
  type: 'player_disconnected'
  player: PlayerSlot
}

export type ServerMessage =
  | MsgGameState
  | MsgRoundStart
  | MsgRoundEnd
  | MsgMatchEnd
  | MsgPlayerDisconnected
