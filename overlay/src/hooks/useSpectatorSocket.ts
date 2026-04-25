import { useEffect, useRef, useState } from 'react'
import type {
  HpPair,
  MsgGameState,
  MsgPlayerDisconnected,
  ServerMessage,
  PlayerSlot,
} from '../protocol'

export interface RoundState {
  number: number
  phase: 'waiting' | 'active' | 'ended'
  winner?: PlayerSlot
  finalHp?: HpPair
}

interface SpectatorSocketState {
  gameState: MsgGameState | null
  roundState: RoundState | null
  matchWinner: PlayerSlot | null
  connected: boolean
  disconnectedPlayer: PlayerSlot | null
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

type IncomingMessage = ServerMessage | MsgPlayerDisconnected

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
  const [connected, setConnected] = useState(false)
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<PlayerSlot | null>(
    null,
  )
  const roundNumberRef = useRef(1)

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | null = null

    const connect = () => {
      socket = new WebSocket(spectatorUrl(serverUrl, roomCode))

      socket.addEventListener('open', () => {
        if (!closed) {
          setConnected(true)
        }
      })

      socket.addEventListener('message', (event) => {
        let parsed: unknown

        try {
          parsed = JSON.parse(String(event.data))
        } catch {
          return
        }

        if (!isIncomingMessage(parsed)) {
          return
        }

        if (parsed.type === 'game_state') {
          setGameState(parsed)
          setDisconnectedPlayer(null)
          return
        }

        if (parsed.type === 'round_start') {
          roundNumberRef.current = parsed.round_number
          setMatchWinner(null)
          setRoundState({ number: parsed.round_number, phase: 'active' })
          return
        }

        if (parsed.type === 'round_end') {
          setRoundState({
            number: roundNumberRef.current,
            phase: 'ended',
            winner: parsed.winner,
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

      socket.addEventListener('close', () => {
        if (closed) {
          return
        }

        setConnected(false)
        reconnectTimer = window.setTimeout(connect, 1000)
      })

      socket.addEventListener('error', () => {
        socket?.close()
      })
    }

    connect()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [roomCode, serverUrl])

  return { connected, disconnectedPlayer, gameState, matchWinner, roundState }
}
