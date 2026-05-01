import type { CSSProperties } from 'react'
import type { HpPair, PlayerSlot } from '../protocol'

interface HudLayerProps {
  connected: boolean
  disconnectedPlayer: PlayerSlot | null
  highLatency: boolean
  hp: HpPair
  wins: [number, number]
  maxWins: number
  remainingTime: number
  round: number
  roomCode: string
}

const MAX_HP = 800

function clampHp(value: number): number {
  return Math.max(0, Math.min(MAX_HP, value))
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function WinDots({ wins, maxWins, player }: { wins: number; maxWins: number; player: 1 | 2 }) {
  return (
    <div className="win-dots">
      {Array.from({ length: maxWins }).map((_, i) => (
        <div key={i} className={`win-dot${i < wins ? ` filled-p${player}` : ''}`} />
      ))}
    </div>
  )
}

export function HudLayer({
  connected,
  disconnectedPlayer,
  highLatency,
  hp,
  wins,
  maxWins,
  remainingTime,
  round,
  roomCode,
}: HudLayerProps) {
  const p1Pct = clampHp(hp[0]) / MAX_HP
  const p2Pct = clampHp(hp[1]) / MAX_HP
  const p1Low = p1Pct < 0.2
  const p2Low = p2Pct < 0.2

  const p1FillStyle: CSSProperties = { width: `${p1Pct * 100}%` }
  const p2FillStyle: CSSProperties = { width: `${p2Pct * 100}%` }

  return (
    <div className="hud-layer">
      <div className="top-bar">
        <div className="hp-wrap">
          <div className="player-label">Player 1</div>
          <WinDots wins={wins[0]} maxWins={maxWins} player={1} />
          <div className="hp-track">
            <div className={`hp-fill hp-fill-p1${p1Low ? ' pulse' : ''}`} style={p1FillStyle} />
          </div>
        </div>
        <div className="timer-stack">
          <div className="timer">{formatTime(remainingTime)}</div>
          <div className="round-label">Round {round}</div>
        </div>
        <div className="hp-wrap hp-wrap-right">
          <div className="player-label">Player 2</div>
          <WinDots wins={wins[1]} maxWins={maxWins} player={2} />
          <div className="hp-track">
            <div className={`hp-fill hp-fill-p2${p2Low ? ' pulse' : ''}`} style={p2FillStyle} />
          </div>
        </div>
      </div>
      <div className={`connection-pill${connected ? ' is-connected' : ''}`}>
        {connected ? roomCode : 'Connecting...'}
      </div>
      {disconnectedPlayer !== null ? (
        <div className="latency-banner">
          Player {disconnectedPlayer} disconnected — waiting for reconnect
        </div>
      ) : highLatency ? (
        <div className="latency-banner">High latency detected</div>
      ) : null}
    </div>
  )
}
