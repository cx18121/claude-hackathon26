interface MatchEndScreenProps {
  winner: 1 | 2;
  playerSlot: 1 | 2;
  onPlayAgain: () => void;
}

export function MatchEndScreen({ winner, playerSlot, onPlayAgain }: MatchEndScreenProps) {
  const youWon = winner === playerSlot;
  return (
    <div className="match-end">
      <div className={`match-end-title ${youWon ? 'win' : 'lose'}`}>
        {youWon ? 'Victory' : 'Defeat'}
      </div>
      <button className="big-button" onClick={onPlayAgain}>
        Play again
      </button>
    </div>
  );
}
