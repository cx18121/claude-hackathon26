interface WaitingScreenProps {
  roomCode: string;
  slot: 1 | 2;
  opponentConnected: boolean;
}

export function WaitingScreen({ roomCode, slot, opponentConnected }: WaitingScreenProps) {
  return (
    <div className="waiting-screen">
      <h1 className="title">SPECTRE</h1>
      <p className="waiting-room-code">{roomCode}</p>
      <p className="waiting-slot">Player {slot}</p>
      <p className="waiting-status">
        {opponentConnected
          ? 'Both players connected — starting...'
          : 'Waiting for opponent...'}
      </p>
    </div>
  );
}
