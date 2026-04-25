import type { CSSProperties } from 'react'
import type { HpPair, PlayerSlot } from '../protocol'

interface HudLayerProps {
  connected: boolean
  disconnectedPlayer: PlayerSlot | null
  highLatency: boolean
  hp: HpPair
  remainingTime: number
  round: number
  roomCode: string
}

function clampHp(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function hpBackground(value: number): string {
  return `hsl(${(clampHp(value) / 100) * 120}, 80%, 48%)`
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const secs = safe % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function HudLayer({
  connected,
  disconnectedPlayer,
  highLatency,
  hp,
  remainingTime,
  round,
  roomCode,
}: HudLayerProps) {
  const p1Width = `${clampHp(hp[0])}%`
  const p2Width = `${clampHp(hp[1])}%`
  const p1Display = Math.max(0, Math.round(hp[0]))
  const p2Display = Math.max(0, Math.round(hp[1]))

  const p1FillStyle: CSSProperties = {
    width: p1Width,
    background: hpBackground(hp[0]),
  }

  const p2FillStyle: CSSProperties = {
    width: p2Width,
    background: hpBackground(hp[1]),
    left: 'auto',
    right: 0,
  }

  return (
    <div className="hud-layer">
      <div className="top-bar">
        <div className="hp-wrap">
          <div className="player-label">P1</div>
          <div className="hp-track">
            <div className="hp-fill" style={p1FillStyle} />
            <div className="hp-number">{p1Display}</div>
          </div>
        </div>
        <div className="timer-stack">
          <div className="timer">{formatTime(remainingTime)}</div>
          <div className="round-label">Round {round} / 3</div>
        </div>
        <div className="hp-wrap hp-wrap-right">
          <div className="player-label">P2</div>
          <div className="hp-track">
            <div className="hp-fill" style={p2FillStyle} />
            <div className="hp-number">{p2Display}</div>
          </div>
        </div>
      </div>
      <div className={`connection-pill${connected ? ' is-connected' : ''}`}>
        {connected ? `Room ${roomCode}` : `Connecting to ${roomCode}...`}
      </div>
      {disconnectedPlayer !== null ? (
        <div className="latency-banner">
          Player {disconnectedPlayer} disconnected - waiting for reconnect
        </div>
      ) : highLatency ? (
        <div className="latency-banner">
          High latency detected - match may feel laggy
        </div>
      ) : null}
    </div>
  )
}
