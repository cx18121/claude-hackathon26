import type { SocketStatus } from '../hooks/useGameSocket';

interface StatusBarProps {
  status: SocketStatus;
  roomCode: string;
  rttMs: number;
  fps: number;
  highLatency: boolean;
  playerSlot: 1 | 2;
  opponentConnected: boolean;
  isSolo?: boolean;
}

const dotColor: Record<SocketStatus, string> = {
  disconnected: '#666',
  connecting: '#e7c84d',
  connected: '#3ecf6e',
  error: '#e25b5b',
};

export function StatusBar({
  status,
  roomCode,
  rttMs,
  fps,
  highLatency,
  playerSlot,
  opponentConnected,
  isSolo = false,
}: StatusBarProps) {
  const opponentLabel = isSolo
    ? 'BOT'
    : opponentConnected
    ? 'P' + (playerSlot === 1 ? 2 : 1)
    : 'waiting...';

  return (
    <>
      <div className="status-bar">
        <div className="status-left">
          <span
            className="status-dot"
            style={{ background: dotColor[status] }}
            aria-label={status}
          />
          <span className={`status-slot slot-${playerSlot}`}>P{playerSlot}</span>
          <span className="status-vs">vs</span>
          <span className="status-opponent">{opponentLabel}</span>
        </div>
        <div className="status-center">{roomCode}</div>
        <div className="status-right">
          <span>{rttMs}ms</span>
          <span>{fps}fps</span>
        </div>
      </div>
      {highLatency ? (
        <div className="latency-banner">
          High latency -- match may feel laggy
        </div>
      ) : null}
    </>
  );
}
