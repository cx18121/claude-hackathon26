import { useRef, useEffect } from 'react';
import type { PoseKeypoint } from '@shared/protocol';
import type { UseGameSocketResult } from '../hooks/useGameSocket';
import { useGameRenderer } from '../hooks/useGameRenderer';

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
 */
export function GameRenderer({ smoothedKeypoints, socket, playerSlot }: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);

  // guardStateRef exposed for Plan 14-04 damage reduction wiring — unused here
  const { guardStateRef: _guardStateRef, triggerFlashRef } = useGameRenderer(
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
    </div>
  );
}
