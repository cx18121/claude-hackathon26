import { useEffect, useRef, useState } from 'react'
import type {
  HpPair,
  MsgDanceBeat,
  MsgDanceScore,
  MsgGameState,
  MsgPlayerDisconnected,
  MsgPoseUpdate,
  PoseKeypoint,
  ServerMessage,
  PlayerSlot,
} from '@shared/protocol'

export interface RoundState {
  number: number
  phase: 'waiting' | 'active' | 'ended'
  winner?: PlayerSlot
  finalHp?: HpPair
}

// Per-player pose snapshot. The renderer reads this every Pixi frame and
// extrapolates forward from `next` using the (next - prev) velocity, so the
// overlay can render poses that are *ahead* of the last network packet
// instead of one full network interval behind it.
export interface PlayerPoseState {
  prev: PoseKeypoint[] | null
  next: PoseKeypoint[] | null
  // performance.now() timestamp at which `next` arrived locally.
  lastArrivalMs: number
  // EWMA of recent inter-arrival gaps. Used to normalize the forward
  // extrapolation factor so prediction speed scales with the actual mobile
  // send rate (which can vary with device, battery, throttling).
  expectedIntervalMs: number
}

export interface PoseStream {
  players: [PlayerPoseState, PlayerPoseState]
}

export interface LobbyState { p1: boolean; p2: boolean }

export interface MatchStats {
  damage: [number, number]
  hits: [number, number]
  rounds: number
  winner: PlayerSlot
}

interface SpectatorSocketState {
  gameState: MsgGameState | null
  roundState: RoundState | null
  matchWinner: PlayerSlot | null
  matchStats: MatchStats | null
  wins: [number, number]
  maxWins: number
  lobbyState: LobbyState
  connected: boolean
  disconnectedPlayer: PlayerSlot | null
  poseStreamRef: React.MutableRefObject<PoseStream>
  socket: WebSocket | null
  gameType: 'boxing' | 'fps_boxing' | 'dance' | null
  danceScores: [number, number]
  danceBeat: { beat: number; totalBeats: number; targetPose: Array<[number, number, number, number]> } | null
}

const DEFAULT_POSE_INTERVAL_MS = 16
const POSE_INTERVAL_EWMA_ALPHA = 0.1

function makePlayerPoseState(): PlayerPoseState {
  return {
    prev: null,
    next: null,
    lastArrivalMs: 0,
    expectedIntervalMs: DEFAULT_POSE_INTERVAL_MS,
  }
}

function makePoseStream(): PoseStream {
  return { players: [makePlayerPoseState(), makePlayerPoseState()] }
}

function toWebSocketBase(url: string) {
  if (url.startsWith('https://')) {
    return `wss://${url.slice('https://'.length)}`.replace(/\/$/, '')
  }

  if (url.startsWith('http://')) {
    return `ws://${url.slice('http://'.length)}`.replace(/\/$/, '')
  }

  return url.replace(/\/$/, '')
}

function spectatorUrl(serverUrl: string, roomCode: string) {
  return `${toWebSocketBase(serverUrl)}/ws/spectator/${encodeURIComponent(roomCode)}`
}

type IncomingMessage = ServerMessage | MsgPlayerDisconnected | MsgPoseUpdate

function isIncomingMessage(value: unknown): value is IncomingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  )
}

export function useSpectatorSocket(
  serverUrl: string,
  roomCode: string,
): SpectatorSocketState {
  const [gameState, setGameState] = useState<MsgGameState | null>(null)
  const [roundState, setRoundState] = useState<RoundState | null>({
    number: 1,
    phase: 'waiting',
  })
  const [matchWinner, setMatchWinner] = useState<PlayerSlot | null>(null)
  const [matchStats, setMatchStats] = useState<MatchStats | null>(null)
  const [wins, setWins] = useState<[number, number]>([0, 0])
  const [maxWins, setMaxWins] = useState<number>(2)
  const [lobbyState, setLobbyState] = useState<LobbyState>({ p1: false, p2: false })
  const [connected, setConnected] = useState(false)
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<PlayerSlot | null>(
    null,
  )
  const [gameType, setGameType] = useState<'boxing' | 'fps_boxing' | 'dance' | null>(null)
  const [danceScores, setDanceScores] = useState<[number, number]>([0, 0])
  const [danceBeat, setDanceBeat] = useState<{ beat: number; totalBeats: number; targetPose: Array<[number, number, number, number]> } | null>(null)
  const roundNumberRef = useRef(1)
  const poseStreamRef = useRef<PoseStream>(makePoseStream())
  const [socket, setSocket] = useState<WebSocket | null>(null)

  // Running accumulators — refs to avoid re-renders on every game_state tick.
  const damageAccRef = useRef<[number, number]>([0, 0])
  const hitsAccRef = useRef<[number, number]>([0, 0])
  const roundsPlayedRef = useRef<number>(0)
  const lastStatTickRef = useRef<number>(-1)

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    let activeSocket: WebSocket | null = null

    const connect = () => {
      activeSocket = new WebSocket(spectatorUrl(serverUrl, roomCode))
      setSocket(activeSocket)

      activeSocket.addEventListener('open', () => {
        if (!closed) {
          setConnected(true)
        }
      })

      activeSocket.addEventListener('message', (event) => {
        let parsed: unknown

        try {
          parsed = JSON.parse(String(event.data))
        } catch {
          return
        }

        // Handle messages not in the ServerMessage union before type-narrowing.
        if (typeof parsed === 'object' && parsed !== null) {
          const rawType = (parsed as Record<string, unknown>).type
          if (rawType === 'joined') {
            const gt = (parsed as { game_type?: string }).game_type
            if (gt === 'boxing' || gt === 'fps_boxing' || gt === 'dance') setGameType(gt)
            return
          }
          if (rawType === 'dance_snapshot') {
            const snap = parsed as { scores?: [number, number] }
            if (snap.scores) setDanceScores([snap.scores[0], snap.scores[1]])
            return
          }
        }

        if (!isIncomingMessage(parsed)) {
          return
        }

        if (parsed.type === 'pose_update') {
          // Hot path: ~120 messages/sec (60Hz x 2 players). Mutate the ref
          // in place — no setState, no re-render. PixiCanvas's ticker will
          // pick this up on the next frame.
          const slotIdx = parsed.player - 1
          const player = poseStreamRef.current.players[slotIdx]
          const now = performance.now()
          if (player.lastArrivalMs > 0) {
            const delta = now - player.lastArrivalMs
            if (delta > 0 && Number.isFinite(delta)) {
              player.expectedIntervalMs =
                player.expectedIntervalMs * (1 - POSE_INTERVAL_EWMA_ALPHA) +
                delta * POSE_INTERVAL_EWMA_ALPHA
            }
          }
          player.prev = player.next
          player.next = parsed.keypoints
          player.lastArrivalMs = now
          return
        }

        if (parsed.type === 'lobby_update') {
          setLobbyState({ p1: parsed.p1, p2: parsed.p2 })
          // lobby_update is the FIRST message every spectator receives, so
          // this is where we pick up the room's game_type. Without it the
          // HUD gates (gameType === 'boxing' / 'dance' / etc) never flip
          // and no HUD renders for the spectator at all.
          const gt = (parsed as { game_type?: string }).game_type
          if (gt === 'boxing' || gt === 'fps_boxing' || gt === 'dance') {
            setGameType(gt)
          }
          return
        }

        if (parsed.type === 'game_state') {
          setGameState(parsed)
          setMaxWins(parsed.max_wins ?? 2)
          setDisconnectedPlayer(null)
          // Accumulate damage/hits from this tick (deduplicated by tick number)
          if (parsed.recent_hits.length > 0 && parsed.tick > lastStatTickRef.current) {
            lastStatTickRef.current = parsed.tick
            for (const hit of parsed.recent_hits) {
              const idx = hit.player - 1
              damageAccRef.current[idx] += hit.damage
              hitsAccRef.current[idx]++
            }
          }
          return
        }

        if (parsed.type === 'round_start') {
          if (parsed.round_number === 1) setWins([0, 0])
          roundNumberRef.current = parsed.round_number
          setMatchWinner(null)
          setRoundState({ number: parsed.round_number, phase: 'active' })
          return
        }

        if (parsed.type === 'round_end') {
          if (parsed.winner !== null && parsed.winner !== undefined) {
            setWins(prev => {
              const next: [number, number] = [prev[0], prev[1]]
              next[(parsed.winner as 1 | 2) - 1]++
              return next
            })
          }
          roundsPlayedRef.current++
          setRoundState({
            number: roundNumberRef.current,
            phase: 'ended',
            winner: parsed.winner ?? undefined,
            finalHp: parsed.final_hp,
          })
          return
        }

        if (parsed.type === 'match_end') {
          setMatchWinner(parsed.winner)
          setMatchStats({
            damage: [damageAccRef.current[0], damageAccRef.current[1]],
            hits: [hitsAccRef.current[0], hitsAccRef.current[1]],
            rounds: roundsPlayedRef.current,
            winner: parsed.winner,
          })
          return
        }

        if (parsed.type === 'rematch_start') {
          setMatchWinner(null)
          setMatchStats(null)
          setGameState(null)
          setWins([0, 0])
          setRoundState({ number: 1, phase: 'waiting' })
          poseStreamRef.current = makePoseStream()
          damageAccRef.current = [0, 0]
          hitsAccRef.current = [0, 0]
          roundsPlayedRef.current = 0
          lastStatTickRef.current = -1
          setDanceScores([0, 0])
          setDanceBeat(null)
          return
        }

        if (parsed.type === 'player_disconnected') {
          setDisconnectedPlayer(parsed.player)
          return
        }

        if (parsed.type === 'dance_beat') {
          const msg = parsed as MsgDanceBeat
          setDanceBeat({ beat: msg.beat, totalBeats: msg.total_beats, targetPose: msg.target_pose })
          return
        }

        if (parsed.type === 'dance_score') {
          const msg = parsed as MsgDanceScore
          setDanceScores([msg.scores[0], msg.scores[1]])
          return
        }

        console.warn('useSpectatorSocket: unknown message type', parsed)
      })

      activeSocket.addEventListener('close', () => {
        if (closed) {
          return
        }

        setSocket(null)
        setConnected(false)
        reconnectTimer = window.setTimeout(connect, 1000)
      })

      activeSocket.addEventListener('error', () => {
        activeSocket?.close()
      })
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      activeSocket?.close()
      setSocket(null)
    }
  }, [roomCode, serverUrl])

  return {
    connected,
    disconnectedPlayer,
    gameState,
    matchWinner,
    matchStats,
    wins,
    maxWins,
    lobbyState,
    roundState,
    poseStreamRef,
    socket,
    gameType,
    danceScores,
    danceBeat,
  }
}
