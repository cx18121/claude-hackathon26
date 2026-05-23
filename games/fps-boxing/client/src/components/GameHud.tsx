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
  lastRoundEnd: RoundEnd | null;
  roundWins: [number, number];  // accumulated [p1Wins, p2Wins] across all rounds
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
  roundWins,
  onRematch,
}: GameHudProps) {
  // T-14-04-01: clamp HP percentage to prevent negative or >100% bars from malformed server data
  const playerPct = Math.max(0, Math.min(100, (playerHp / 800) * 100));
  const opponentPct = Math.max(0, Math.min(100, (opponentHp / 800) * 100));

  // T-14-04-03: guard against NaN/Infinity from server
  const timerDisplay = isFinite(roundTimer) && roundTimer >= 0 ? Math.ceil(roundTimer) : 0;

  // Low HP at ≤20% (160/800) — pulse animation, no color change
  const playerLow = playerHp <= 160;
  const opponentLow = opponentHp <= 160;

  // HP fill color class based on actual player slot
  const playerFillColor  = playerSlot === 1 ? 'hp-bar-fill--p1-color' : 'hp-bar-fill--p2-color';
  const opponentFillColor = playerSlot === 1 ? 'hp-bar-fill--p2-color' : 'hp-bar-fill--p1-color';

  // Accumulated wins for each side (from perspective of this player)
  const myWins  = roundWins[playerSlot - 1];
  const oppWins = roundWins[playerSlot === 1 ? 1 : 0];
  const showWins = myWins > 0 || oppWins > 0;

  // Round end overlay (shown between rounds, hidden when matchEnd takes over)
  const showRoundEnd = lastRoundEnd !== null && matchEnd === null;
  let roundEndResultText = 'DRAW';
  let roundEndResultMod = 'round-end-result--draw';
  if (lastRoundEnd !== null && lastRoundEnd.winner !== null) {
    if (lastRoundEnd.winner === playerSlot) {
      roundEndResultText = 'YOU WIN';
      roundEndResultMod = 'round-end-result--win';
    } else {
      roundEndResultText = 'OPPONENT WINS';
      roundEndResultMod = 'round-end-result--lose';
    }
  }

  // Match end
  const isWinner = matchEnd?.winner === playerSlot;

  return (
    <div className="game-hud">
      {/* Player HP bar (left side) */}
      <div className="hp-bar-container hp-bar-container--p1">
        <div className="hp-bar-label">YOU</div>
        <div className="hp-bar-track">
          <div
            className={`hp-bar-fill ${playerFillColor}${playerLow ? ' hp-bar-fill--low' : ''}`}
            style={{ width: `${playerPct}%` }}
          />
        </div>
      </div>

      {/* Round timer (center) */}
      <div className="round-timer-wrapper">
        <div className="round-timer">{timerDisplay}</div>
        {showWins && (
          <div className="win-counter">
            <span className={playerSlot === 1 ? 'win-counter--p1' : 'win-counter--p2'}>
              {'●'.repeat(myWins)}{'○'.repeat(Math.max(0, 3 - myWins))}
            </span>
            {' '}
            <span className={playerSlot === 1 ? 'win-counter--p2' : 'win-counter--p1'}>
              {'●'.repeat(oppWins)}{'○'.repeat(Math.max(0, 3 - oppWins))}
            </span>
          </div>
        )}
      </div>

      {/* Opponent HP bar (right side) */}
      <div className="hp-bar-container hp-bar-container--p2">
        <div className="hp-bar-label">OPP</div>
        <div className="hp-bar-track">
          <div
            className={`hp-bar-fill ${opponentFillColor}${opponentLow ? ' hp-bar-fill--low' : ''}`}
            style={{ width: `${opponentPct}%` }}
          />
        </div>
      </div>

      {/* Round end overlay — shown between rounds */}
      {showRoundEnd && (
        <div className="round-end-overlay">
          <div className="round-end-heading">ROUND {roundNumber}</div>
          <div className={`round-end-result ${roundEndResultMod}`}>
            {roundEndResultText}
          </div>
        </div>
      )}

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
