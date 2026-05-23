import type { LobbyState } from '../hooks/useSpectatorSocket'

interface WaitingOverlayProps {
  lobbyState: LobbyState
}

function PlayerSlot({ connected, player }: { connected: boolean; player: 1 | 2 }) {
  return (
    <div className={`waiting-slot${connected ? ' waiting-slot-ready' : ''} waiting-slot-p${player}`}>
      <div className="waiting-slot-figure">
        <svg viewBox="0 0 60 100" fill="none" aria-hidden>
          <circle cx="30" cy="14" r="10" fill="currentColor" opacity={connected ? 1 : 0.25} />
          <rect x="16" y="26" width="28" height="34" rx="4" fill="currentColor" opacity={connected ? 1 : 0.25} />
          <rect x="4" y="28" width="10" height="26" rx="4" fill="currentColor" opacity={connected ? 1 : 0.25} />
          <rect x="46" y="28" width="10" height="26" rx="4" fill="currentColor" opacity={connected ? 1 : 0.25} />
          <rect x="18" y="62" width="10" height="30" rx="4" fill="currentColor" opacity={connected ? 1 : 0.25} />
          <rect x="32" y="62" width="10" height="30" rx="4" fill="currentColor" opacity={connected ? 1 : 0.25} />
        </svg>
        {!connected && <div className="waiting-pulse-ring" />}
      </div>
      <div className="waiting-slot-label">P{player}</div>
      <div className={`waiting-slot-status${connected ? ' ready' : ''}`}>
        {connected ? 'Connected' : 'Waiting…'}
      </div>
    </div>
  )
}

export function WaitingOverlay({ lobbyState }: WaitingOverlayProps) {
  return (
    <div className="waiting-overlay">
      <div className="waiting-title">SPECTRE</div>
      <div className="waiting-slots">
        <PlayerSlot connected={lobbyState.p1} player={1} />
        <div className="waiting-vs">VS</div>
        <PlayerSlot connected={lobbyState.p2} player={2} />
      </div>
      <div className="waiting-hint">
        {!lobbyState.p1 && !lobbyState.p2
          ? 'Waiting for players to join'
          : !lobbyState.p1 || !lobbyState.p2
          ? 'Waiting for second player'
          : 'Both players connected — calibrating…'}
      </div>
    </div>
  )
}
