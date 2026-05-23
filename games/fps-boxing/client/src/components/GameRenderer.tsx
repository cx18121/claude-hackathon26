import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseKeypoint } from '@shared/protocol';
import type { UseGameSocketResult } from '../hooks/useGameSocket';
import { useGameRenderer } from '../hooks/useGameRenderer';
import { GameHud } from './GameHud';

interface GameRendererProps {
  smoothedKeypoints: PoseKeypoint[] | null;
  socket: UseGameSocketResult;
  playerSlot: 1 | 2;
}

/**
 * GameRenderer — thin React component that mounts the Three.js canvas.
 *
 * All Three.js logic lives in useGameRenderer. This component only provides
 * the container div ref and forwards props. Pattern: CalibrationScreen.tsx.
 *
 * Hit flash (HFB-04): #hit-flash div with CSS keyframe animation. triggerFlashRef
 * is set after mount so the Three.js animation loop can trigger DOM-side flashes.
 *
 * GameHud (GML-01, GML-02, HFB-02): absolute overlay above Three.js canvas.
 * HP values derived from socket.lastFpsState; guard-aware damage multiplier (GML-04).
 */
export function GameRenderer({ smoothedKeypoints, socket, playerSlot }: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);

  // Destructure both refs returned from useGameRenderer (Plan 14-02 + 14-04)
  const { guardStateRef, triggerFlashRef } = useGameRenderer(
    containerRef, smoothedKeypoints, socket, playerSlot,
  );

  // Wire triggerFlash implementation after mount (HFB-04)
  // Re-trigger pattern: remove class → force reflow → re-add class
  useEffect(() => {
    triggerFlashRef.current = () => {
      const el = flashRef.current;
      if (!el) return;
      el.classList.remove('flash-active');
      void el.offsetWidth; // force reflow so animation re-triggers
      el.classList.add('flash-active');
    };
  }, [triggerFlashRef]);

  // HUD state — React useState drives re-renders on socket updates
  const [playerHp, setPlayerHp] = useState(800);
  const [opponentHp, setOpponentHp] = useState(800);
  const [roundTimer, setRoundTimer] = useState(0);

  // Sync lastFpsState to HUD state
  useEffect(() => {
    if (!socket.lastFpsState) return;
    const playerIndex = playerSlot - 1;
    const opponentIndex = 1 - playerIndex;
    setPlayerHp(socket.lastFpsState.hp[playerIndex]);
    setOpponentHp(socket.lastFpsState.hp[opponentIndex]);
    setRoundTimer(socket.lastFpsState.round_timer);
  }, [socket.lastFpsState, playerSlot]);

  // GML-04: guard reduces displayed HP drain by 0.5x when guardStateRef.current.active is true
  // and punch is not already 'blocked' by server.
  const lastFpsHitRef = useRef<typeof socket.lastFpsHit>(null);
  useEffect(() => {
    const hit = socket.lastFpsHit;
    if (!hit || hit === lastFpsHitRef.current) return;
    lastFpsHitRef.current = hit;

    // GML-04: when guard is active, apply 0.5x multiplier to the damage
    // that would be reflected by the next MsgFpsState hp update.
    // We cannot stop the server from sending the real hp, so we speculatively
    // add back half the damage to the local playerHp until the next MsgFpsState
    // arrives and overwrites it. This produces a visible half-damage display
    // for ~1 server tick (~33ms) before the authoritative value arrives.
    if (guardStateRef.current.active && hit.punch_type !== 'blocked') {
      const guardedDamageRefund = hit.damage * 0.5;
      setPlayerHp((prev) => Math.min(800, prev + guardedDamageRefund));
    }
  }, [socket.lastFpsHit, guardStateRef]);

  // Rematch handler — playAgain() posts /rooms/:code/rematch which triggers
  // calibration_start from server, setting socket.phase to 'calibration'.
  // App.tsx already routes to CalibrationScreen when phase === 'calibration'.
  const handleRematch = useCallback(() => {
    void socket.playAgain();
  }, [socket]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {/* Hit-flash CSS keyframe animation (HFB-04) */}
      <style>{`
        @keyframes hit-flash-anim {
          0%   { opacity: 0.8; }
          100% { opacity: 0; }
        }
        .flash-active {
          animation: hit-flash-anim 120ms ease-out forwards;
        }
      `}</style>
      {/* Three.js canvas container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Hit flash overlay — rgba(255,255,255,0.35) per UI-SPEC --hit-flash token */}
      <div
        id="hit-flash"
        ref={flashRef}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.35)',
          pointerEvents: 'none',
          opacity: 0,
        }}
      />
      {/* GameHud — HUD overlay above Three.js canvas (GML-01, GML-02, HFB-02) */}
      <GameHud
        playerHp={playerHp}
        opponentHp={opponentHp}
        roundTimer={roundTimer}
        matchEnd={socket.matchEnd}
        playerSlot={playerSlot}
        roundNumber={socket.roundNumber}
        lastRoundEnd={socket.lastRoundEnd}
        onRematch={handleRematch}
      />
    </div>
  );
}
