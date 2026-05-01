import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../lib/sfx';
import type { MatchStats } from '../hooks/useSpectatorSocket';
import type { RoundState } from '../hooks/useSpectatorSocket';
import type { PlayerSlot } from '@shared/protocol';

interface RoundOverlayProps {
  roundState: RoundState | null;
  matchWinner: PlayerSlot | null;
  matchStats: MatchStats | null;
  serverUrl: string;
  roomCode: string;
}

export function RoundOverlay({ roundState, matchWinner, matchStats, serverUrl, roomCode }: RoundOverlayProps) {
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const flashKeyRef = useRef(0);
  const [startRound, setStartRound] = useState<number | null>(null);
  const [endRound, setEndRound] = useState<number | null>(null);
  const [endWinner, setEndWinner] = useState<PlayerSlot | null>(null);
  const [rematching, setRematching] = useState(false);

  const lastStartRoundRef = useRef<number | null>(null);
  const lastEndKeyRef = useRef<string | null>(null);
  const matchWinnerPlayedRef = useRef<PlayerSlot | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const countdownTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!roundState) return;
    if (
      roundState.phase === 'active' &&
      lastStartRoundRef.current !== roundState.number
    ) {
      lastStartRoundRef.current = roundState.number;
      setStartRound(roundState.number);
      setRematching(false);

      countdownTimersRef.current.forEach(id => window.clearTimeout(id));
      countdownTimersRef.current = [];
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);

      setCountdown('3');
      countdownTimersRef.current.push(window.setTimeout(() => setCountdown('2'), 1000));
      countdownTimersRef.current.push(window.setTimeout(() => setCountdown('1'), 2000));
      countdownTimersRef.current.push(window.setTimeout(() => {
        setCountdown('FIGHT!');
        sfx.play('round_bell');
      }, 3000));
      countdownTimersRef.current.push(window.setTimeout(() => {
        setCountdown(null);
        setShowStart(true);
        startTimerRef.current = window.setTimeout(() => {
          setShowStart(false);
          startTimerRef.current = null;
        }, 2000);
      }, 3800));
    }
  }, [roundState]);

  useEffect(() => {
    if (!roundState) return;
    if (roundState.phase === 'ended' && roundState.winner !== undefined) {
      const key = `${roundState.number}-${roundState.winner}`;
      if (lastEndKeyRef.current !== key) {
        lastEndKeyRef.current = key;
        setEndRound(roundState.number);
        setEndWinner(roundState.winner);
        setShowEnd(true);
        sfx.play('round_end');
        flashKeyRef.current += 1;
        setShowFlash(true);
        window.setTimeout(() => setShowFlash(false), 450);

        if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
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
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current);
      if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
      countdownTimersRef.current.forEach(id => window.clearTimeout(id));
    };
  }, []);

  const handleRematch = useCallback(async () => {
    if (rematching) return;
    setRematching(true);
    try {
      const base = serverUrl
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/$/, '');
      await fetch(`${base}/rooms/${encodeURIComponent(roomCode)}/rematch`, { method: 'POST' });
    } catch {
      setRematching(false);
    }
  }, [rematching, serverUrl, roomCode]);

  const hasStart = showStart && startRound !== null;
  const hasEnd = showEnd && endRound !== null && endWinner !== null;
  const hasMatch = matchWinner !== null;

  if (!countdown && !hasStart && !hasEnd && !hasMatch) return null;

  return (
    <>
      {showFlash && (
        <div key={`flash-${flashKeyRef.current}`} className="round-end-flash" />
      )}
      {countdown && (
        <div key={countdown} className="round-flash">
          {countdown}
        </div>
      )}
      {!countdown && hasStart && (
        <div key={`round-start-${startRound}`} className="round-flash">
          ROUND {startRound}
        </div>
      )}
      {hasEnd && (
        <div key={`round-end-${endRound}-${endWinner}`} className="round-flash">
          ROUND {endRound} — P{endWinner} WINS
        </div>
      )}
      {hasMatch && (
        <div className="match-end-overlay">
          <div className="ko-text">K.O.</div>
          <div className="match-end-title">
            PLAYER {matchWinner} WINS
          </div>
          {matchStats && (
            <div className="match-stats">
              <div className="match-stats-col match-stats-col-p1">
                <div className="match-stat">
                  <span className="match-stat-value p1">
                    {matchStats.damage[0].toLocaleString()}
                  </span>
                  <span className="match-stat-label">DAMAGE</span>
                </div>
                <div className="match-stat">
                  <span className="match-stat-value p1">{matchStats.hits[0]}</span>
                  <span className="match-stat-label">HITS</span>
                </div>
              </div>
              <div className="match-stats-sep" />
              <div className="match-stats-col match-stats-col-p2">
                <div className="match-stat">
                  <span className="match-stat-value p2">
                    {matchStats.damage[1].toLocaleString()}
                  </span>
                  <span className="match-stat-label">DAMAGE</span>
                </div>
                <div className="match-stat">
                  <span className="match-stat-value p2">{matchStats.hits[1]}</span>
                  <span className="match-stat-label">HITS</span>
                </div>
              </div>
              <div className="match-stats-footer">
                {matchStats.rounds} {matchStats.rounds === 1 ? 'ROUND' : 'ROUNDS'}
              </div>
            </div>
          )}
          <button
            className="rematch-btn"
            type="button"
            onClick={handleRematch}
            disabled={rematching}
          >
            {rematching ? 'REMATCHING…' : 'REMATCH'}
          </button>
        </div>
      )}
    </>
  );
}
