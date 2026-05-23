import { useCallback } from 'react';
import {
  useGameSocketBase,
  type UseGameSocketBase,
  type ConnectionArgs,
} from '@shared/client/useGameSocket';
import { normalizeHttpUrl } from '@shared/client/wsUrl';

// Re-export types the rest of the mobile app depends on, so call sites
// can keep importing from `./useGameSocket` rather than the shared module.
export type {
  SocketStatus,
  GamePhase,
  RoundEnd,
  MatchEnd,
} from '@shared/client/useGameSocket';

export interface UseGameSocketResult extends UseGameSocketBase {
  /**
   * Creates a fresh boxing room on the server and connects to it as solo P1.
   * Returns the room code (caller persists it for the UI) or throws on failure.
   */
  connectSolo: (serverUrl: string) => Promise<string>;
}

export function useGameSocket(): UseGameSocketResult {
  // Mobile sends the user-controlled solo flag through to the server so
  // the engine's intended_solo latch picks it up. Never rely on
  // `!P2.connected` to mean "solo" — the intent has to be in the join
  // message or a transient disconnect flips the room to bot mode.
  const base = useGameSocketBase({
    joinSolo: (args: ConnectionArgs) => args.solo,
    onAppMessage: (msg, helpers) => {
      // fps_boxing equivalent of you_were_hit — mirror its flash pattern
      // so a mobile player can still see damage feedback when participating
      // in an fps room.
      if (msg.type === 'fps_hit') {
        helpers.flashHit(msg.punch_type, msg.damage);
      }
    },
  });

  const connectSolo = useCallback(
    async (serverUrl: string): Promise<string> => {
      // Create a fresh boxing room then connect to it as P1 with solo=true.
      // Surface fetch failures so the UI can show a meaningful error instead
      // of silently doing nothing.
      const baseUrl = normalizeHttpUrl(serverUrl);
      const res = await fetch(`${baseUrl}/rooms?game=boxing`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Server refused room creation (status ${res.status})`);
      }
      const data = (await res.json()) as { room_code?: string };
      if (!data.room_code) {
        throw new Error('Server returned no room_code');
      }
      base.connectWith({
        serverUrl,
        roomCode: data.room_code,
        playerSlot: 1,
        solo: true,
      });
      return data.room_code;
    },
    [base],
  );

  return { ...base, connectSolo };
}
