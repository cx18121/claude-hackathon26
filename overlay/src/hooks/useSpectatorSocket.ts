import { useEffect, useRef, useState } from 'react'
import type {
  HpPair,
  MsgGameState,
  MsgPlayerDisconnected,
  MsgPoseUpdate,
  PoseKeypoint,
  ServerMessage,
  PlayerSlot,
} from '../protocol'

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

interface SpectatorSocketState {
  gameState: MsgGameState | null
  roundState: RoundState | null
  matchWinner: PlayerSlot | null
  wins: [number, number]
  connected: boolean
  disconnectedPlayer: PlayerSlot | null
  // Stable across renders. PixiCanvas reads this every frame instead of
  // re-rendering React on each pose update.
  poseStreamRef: React.MutableRefObject<PoseStream>
  // Live socket — exposed so other hooks (commentary subtitle, audio) can
  // attach passive `message` listeners without owning their own connection.
  socket: WebSocket | null
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
  const [wins, setWins] = useState<[number, number]>([0, 0])
  const [connected, setConnected] = useState(false)
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<PlayerSlot | null>(
    null,
  )
  const roundNumberRef = useRef(1)
  const poseStreamRef = useRef<PoseStream>(makePoseStream())
  const [socket, setSocket] = useState<WebSocket | null>(null)

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

        if (parsed.type === 'game_state') {
          setGameState(parsed)
          setDisconnectedPlayer(null)
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
          return
        }

        if (parsed.type === 'player_disconnected') {
          setDisconnectedPlayer(parsed.player)
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
    wins,
    roundState,
    poseStreamRef,
    socket,
  }
}
