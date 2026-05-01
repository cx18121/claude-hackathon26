import type { CSSProperties } from 'react'
import type { HpPair, PlayerSlot } from '@shared/protocol'

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

function clampHp(v: number) { return Math.max(0, Math.min(MAX_HP, v)) }

function formatTime(s: number) {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
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

  const p1Style: CSSProperties = { width: `${p1Pct * 100}%` }
  const p2Style: CSSProperties = { width: `${p2Pct * 100}%` }

  return (
    <div className="hud-layer">
      {/* Main HUD band */}
      <div className="hud-band">
        {/* Name + wins row */}
        <div className="hud-names">
          <div className="hud-p1-name">
            <span className="hud-label">P1</span>
            <WinDots wins={wins[0]} maxWins={maxWins} player={1} />
          </div>
          <div className="hud-center-name">
            <div className="timer">{formatTime(remainingTime)}</div>
            <div className="round-label">Round {round}</div>
            <div className="room-pill">{connected ? roomCode : '···'}</div>
          </div>
          <div className="hud-p2-name">
            <WinDots wins={wins[1]} maxWins={maxWins} player={2} />
            <span className="hud-label">P2</span>
          </div>
        </div>

        {/* HP bars row */}
        <div className="hud-bars">
          <div className="hp-track">
            <div className={`hp-fill hp-fill-p1${p1Pct < 0.2 ? ' pulse' : ''}`} style={p1Style} />
          </div>
          <div className="hud-bars-sep" />
          <div className="hp-track">
            <div className={`hp-fill hp-fill-p2${p2Pct < 0.2 ? ' pulse' : ''}`} style={p2Style} />
          </div>
        </div>
      </div>

      {/* Banners */}
      {disconnectedPlayer !== null ? (
        <div className="hud-banner">
          Player {disconnectedPlayer} disconnected — reconnecting…
        </div>
      ) : highLatency ? (
        <div className="hud-banner">High latency</div>
      ) : null}
    </div>
  )
}
