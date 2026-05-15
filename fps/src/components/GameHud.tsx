import './GameHud.css';
import type { RoundEnd } from '../hooks/useGameSocket';

// GML-03: Bot match is supported via existing socket phase routing. When only one player joins an fps_boxing room, the server's bot logic (FPSBoxingPlugin) handles the opponent. No client changes needed for bot support.

interface GameHudProps {
  playerHp: number;         // 0..800
  opponentHp: number;       // 0..800
  roundTimer: number;       // seconds remaining (float — display as Math.ceil)
  matchEnd: { winner: 1 | 2 } | null;
  playerSlot: 1 | 2;
  roundNumber: number;
  lastRoundEnd: RoundEnd | null;   // for win counter dots
  onRematch: () => void;
}

export function GameHud({
  playerHp,
  opponentHp,
  roundTimer,
  matchEnd,
  playerSlot,
  roundNumber,
  lastRoundEnd,
  onRematch,
}: GameHudProps) {
  // T-14-04-01: clamp HP percentage to prevent negative or >100% bars from malformed server data
  const playerPct = Math.max(0, Math.min(100, (playerHp / 800) * 100));
  const opponentPct = Math.max(0, Math.min(100, (opponentHp / 800) * 100));

  // T-14-04-03: guard against NaN/Infinity from server
  const timerDisplay = isFinite(roundTimer) && roundTimer >= 0 ? Math.ceil(roundTimer) : 0;

  // Win counter dots — show filled dot for winner of last round, empty for other
  const p1WonLastRound = lastRoundEnd?.winner === 1;
  const p2WonLastRound = lastRoundEnd?.winner === 2;
  // Show dots only if we have at least round 2 context (after first round ends)
  const showDots = roundNumber > 1 || lastRoundEnd !== null;

  // Determine if the player is the match winner (for WIN vs LOSE display)
  const isWinner = matchEnd?.winner === playerSlot;

  return (
    <div className="game-hud">
      {/* Player HP bar (left side) */}
      <div className="hp-bar-container hp-bar-container--p1">
        <div className="hp-bar-label">YOU</div>
        <div className="hp-bar-track">
          <div
            className={`hp-bar-fill${playerHp <= 400 ? ' hp-bar-fill--low' : ''}`}
            style={{ width: `${playerPct}%` }}
          />
        </div>
      </div>

      {/* Round timer (center) */}
      <div className="round-timer-wrapper">
        <div className="round-timer">{timerDisplay}</div>
        {showDots && (
          <div className="win-counter">
            {(playerSlot === 1 ? p1WonLastRound : p2WonLastRound) ? '●' : '○'}
            {' '}
            {(playerSlot === 1 ? p2WonLastRound : p1WonLastRound) ? '●' : '○'}
          </div>
        )}
      </div>

      {/* Opponent HP bar (right side) */}
      <div className="hp-bar-container hp-bar-container--p2">
        <div className="hp-bar-label">OPP</div>
        <div className="hp-bar-track">
          <div
            className={`hp-bar-fill${opponentHp <= 400 ? ' hp-bar-fill--low' : ''}`}
            style={{ width: `${opponentPct}%` }}
          />
        </div>
      </div>

      {/* Match end overlay — rendered only when matchEnd !== null */}
      {matchEnd !== null && (
        <div className="match-end-overlay">
          <div className={`match-end-result${isWinner ? ' match-end-result--win' : ' match-end-result--lose'}`}>
            {isWinner ? 'WIN' : 'LOSE'}
          </div>
          <button className="rematch-button" onClick={onRematch}>
            REMATCH
          </button>
        </div>
      )}
    </div>
  );
}
