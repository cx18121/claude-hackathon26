import { useEffect, useRef, useState } from 'react';
import { sfx } from '../lib/sfx';
import type { RoundState } from '../hooks/useSpectatorSocket';
import type { PlayerSlot } from '../protocol';

interface RoundOverlayProps {
  roundState: RoundState | null;
  matchWinner: PlayerSlot | null;
}

export function RoundOverlay({ roundState, matchWinner }: RoundOverlayProps) {
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [startRound, setStartRound] = useState<number | null>(null);
  const [endRound, setEndRound] = useState<number | null>(null);
  const [endWinner, setEndWinner] = useState<PlayerSlot | null>(null);

  const lastStartRoundRef = useRef<number | null>(null);
  const lastEndKeyRef = useRef<string | null>(null);
  const matchWinnerPlayedRef = useRef<PlayerSlot | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roundState) {
      return;
    }

    if (
      roundState.phase === 'active' &&
      lastStartRoundRef.current !== roundState.number
    ) {
      lastStartRoundRef.current = roundState.number;
      setStartRound(roundState.number);
      setShowStart(true);
      sfx.play('round_bell');

      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
      }
      startTimerRef.current = window.setTimeout(() => {
        setShowStart(false);
        startTimerRef.current = null;
      }, 2000);
    }
  }, [roundState]);

  useEffect(() => {
    if (!roundState) {
      return;
    }

    if (roundState.phase === 'ended' && roundState.winner !== undefined) {
      const key = `${roundState.number}-${roundState.winner}`;
      if (lastEndKeyRef.current !== key) {
        lastEndKeyRef.current = key;
        setEndRound(roundState.number);
        setEndWinner(roundState.winner);
        setShowEnd(true);
        sfx.play('round_end');

        if (endTimerRef.current !== null) {
          window.clearTimeout(endTimerRef.current);
        }
        endTimerRef.current = window.setTimeout(() => {
          setShowEnd(false);
          endTimerRef.current = null;
        }, 2200);
      }
    }
  }, [roundState]);

  useEffect(() => {
    if (matchWinner !== null && matchWinnerPlayedRef.current !== matchWinner) {
      matchWinnerPlayedRef.current = matchWinner;
      sfx.play('match_win');
    } else if (matchWinner === null) {
      matchWinnerPlayedRef.current = null;
    }
  }, [matchWinner]);

  useEffect(() => {
    return () => {
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
      }
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current);
      }
    };
  }, []);

  const hasStart = showStart && startRound !== null;
  const hasEnd = showEnd && endRound !== null && endWinner !== null;
  const hasMatch = matchWinner !== null;

  if (!hasStart && !hasEnd && !hasMatch) {
    return null;
  }

  return (
    <>
      {hasStart && (
        <div key={`round-start-${startRound}`} className="round-flash">
          ROUND {startRound}
        </div>
      )}
      {hasEnd && (
        <div key={`round-end-${endRound}-${endWinner}`} className="round-flash">
          ROUND {endRound} - P{endWinner} WINS
        </div>
      )}
      {hasMatch && (
        <div className="match-end-overlay">
          <div className="match-end-title">
            PLAYER {matchWinner} WINS THE MATCH
          </div>
          <div className="match-end-subtitle">Refresh to spectate again</div>
        </div>
      )}
    </>
  );
}
