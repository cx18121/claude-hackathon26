import { useRef } from 'react';
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
 */
export function GameRenderer({ smoothedKeypoints, socket, playerSlot }: GameRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // guardStateRef exposed for Plan 14-04 damage reduction wiring — unused here
  const { guardStateRef: _guardStateRef } = useGameRenderer(containerRef, smoothedKeypoints, socket, playerSlot);
  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />;
}
