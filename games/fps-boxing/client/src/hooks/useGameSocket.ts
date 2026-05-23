import { useState } from 'react';
import type { MsgFpsHit, MsgFpsState } from '@shared/protocol';
import {
  useGameSocketBase,
  type UseGameSocketBase,
} from '@shared/client/useGameSocket';

// Re-export types the rest of the fps app depends on, so call sites can
// keep importing from `./useGameSocket` rather than the shared module.
export type {
  SocketStatus,
  GamePhase,
  RoundEnd,
  MatchEnd,
} from '@shared/client/useGameSocket';

export interface UseGameSocketResult extends UseGameSocketBase {
  lastFpsState: MsgFpsState | null;
  lastFpsHit: MsgFpsHit | null;
}

export function useGameSocket(): UseGameSocketResult {
  const [lastFpsState, setLastFpsState] = useState<MsgFpsState | null>(null);
  const [lastFpsHit, setLastFpsHit] = useState<MsgFpsHit | null>(null);

  const base = useGameSocketBase({
    // fps never enters solo/bot mode — there's no in-app affordance for
    // it. Hardcode false so the engine's intended_solo latch stays off.
    joinSolo: () => false,
    onAppMessage: (msg) => {
      if (msg.type === 'fps_state') {
        // T-14-01-01: guard hp array before storing to prevent tampered server messages.
        if (Array.isArray(msg.hp) && msg.hp.length >= 2) {
          setLastFpsState(msg);
        }
      } else if (msg.type === 'fps_hit') {
        setLastFpsHit(msg);
      }
    },
  });

  return { ...base, lastFpsState, lastFpsHit };
}
