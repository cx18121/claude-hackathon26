import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboundServerMsg, OutboundMobileMsg } from '../protocol';
import { normalizeHttpUrl, normalizeWsUrl } from './wsUrl';

// =====================================================================
// Shared player-socket lifecycle for `mobile` and `fps` apps.
//
// Responsibilities:
//   - WebSocket open/close/auto-reconnect (with max-attempt backoff)
//   - 500ms client pings + RTT median over a 10-sample window
//   - Close-code handling (4000 slot-taken, 4004 room-not-found)
//   - The 11 message cases shared between both apps:
//       joined, pong, ping, calibration_start, match_start, you_were_hit,
//       player_disconnected, round_start, round_end, match_end,
//       rematch_start
//   - `playAgain()` POST to /rooms/{code}/rematch
//
// App-specific behavior (the deltas between mobile and fps) goes through:
//   - `joinSolo` config: mobile passes the user-controlled solo flag; fps
//     always returns false (no solo mode in fps).
//   - `onAppMessage` config: extra message types unique to the app
//     (mobile's `fps_hit` mirroring, fps's `fps_state` / `fps_hit` state).
//
// Helpers exposed to `onAppMessage`:
//   - `flashHit(region, damage)`: reuse the built-in hit-clear timer for
//     any hit-like message. Avoids the previous pattern where fps_hit
//     copy-pasted the timer logic from you_were_hit.
// =====================================================================

export type SocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type GamePhase = 'lobby' | 'calibration' | 'match' | 'ended';

export interface RoundEnd {
  winner: 1 | 2 | null;
  final_hp: [number, number];
}

export interface MatchEnd {
  winner: 1 | 2;
}

export interface ConnectionArgs {
  serverUrl: string;
  roomCode: string;
  playerSlot: 1 | 2;
  solo: boolean;
}

export interface GameSocketHelpers {
  /** Show a hit-flash for HIT_FLASH_MS, replacing any in-flight timer. */
  flashHit: (region: string, damage: number) => void;
}

export interface UseGameSocketBaseConfig {
  /**
   * Returns the `solo` flag to send in the join message. Mobile lets the
   * user pick (returns args.solo); fps hardcodes false (no solo mode).
   */
  joinSolo: (args: ConnectionArgs) => boolean;
  /**
   * Called ONLY for message types the base hook does not handle itself —
   * the shared cases (joined/pong/ping/calibration_start/match_start/
   * you_were_hit/player_disconnected/round_start/round_end/match_end/
   * rematch_start) are processed by the base and never forwarded here.
   * Use this for additive types like `fps_state`, `fps_hit`, etc.
   *
   * Helpers provided so app dispatchers can reuse base-owned state
   * machinery (e.g. `flashHit` shares the hit-clear timer used by
   * `you_were_hit`).
   */
  onAppMessage?: (msg: InboundServerMsg, helpers: GameSocketHelpers) => void;
}

export interface UseGameSocketBase {
  status: SocketStatus;
  opponentConnected: boolean;
  /**
   * Authoritative slot the server assigned to this connection (set on
   * 'joined'). The server's WS handler picks the first open slot
   * regardless of the value the client sent in 'join', so we cannot trust
   * the locally chosen slot to match what the server uses for hit
   * attribution and win/lose messaging. UI must use this once it's set.
   */
  assignedSlot: 1 | 2 | null;
  gameType: string | null;
  phase: GamePhase;
  lastHit: { region: string; damage: number } | null;
  highLatency: boolean;
  rttMs: number;
  roundNumber: number;
  lastRoundEnd: RoundEnd | null;
  matchEnd: MatchEnd | null;
  errorMessage: string | null;
  errorCode: 'unreachable' | 'room_not_found' | 'slot_taken' | null;
  send: (msg: OutboundMobileMsg) => void;
  /**
   * Connect to a room. `solo` is forwarded to the `joinSolo` config so the
   * app decides whether it ends up in the join message. Defaults to false.
   */
  connect: (serverUrl: string, roomCode: string, playerSlot: 1 | 2, solo?: boolean) => void;
  /**
   * Connect with already-constructed args. Used by app-specific connect
   * variants (e.g. mobile's connectSolo that creates a room first).
   */
  connectWith: (args: ConnectionArgs) => void;
  disconnect: () => void;
  playAgain: () => Promise<void>;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 500;
const HIT_FLASH_MS = 1500;

// Shared cases the base handles itself. `onAppMessage` is still called for
// these (it can observe), but the base sets the state.
const SHARED_HANDLED_TYPES = new Set<string>([
  'joined', 'pong', 'ping',
  'calibration_start', 'match_start',
  'you_were_hit', 'player_disconnected',
  'round_start', 'round_end', 'match_end',
  'rematch_start',
]);

export function useGameSocketBase(config: UseGameSocketBaseConfig): UseGameSocketBase {
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [assignedSlot, setAssignedSlot] = useState<1 | 2 | null>(null);
  const [gameType, setGameType] = useState<string | null>(null);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [lastHit, setLastHit] = useState<{ region: string; damage: number } | null>(null);
  const [highLatency, setHighLatency] = useState(false);
  const [rttMs, setRttMs] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [lastRoundEnd, setLastRoundEnd] = useState<RoundEnd | null>(null);
  const [matchEnd, setMatchEnd] = useState<MatchEnd | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<'unreachable' | 'room_not_found' | 'slot_taken' | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const hitClearTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const rttSamplesRef = useRef<number[]>([]);
  const connectionArgsRef = useRef<ConnectionArgs | null>(null);
  // `open()` is referenced by the close-handler reconnect path. The ref
  // lets close handlers invoke the latest closure rather than a stale
  // capture made at WebSocket creation time.
  const openRef = useRef<() => void>(() => {});

  // Config callbacks captured in refs so we can keep `handleMessage`
  // stable across renders while still picking up new closures.
  const configRef = useRef(config);
  configRef.current = config;

  const send = useCallback((msg: OutboundMobileMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const clearTimers = () => {
    if (pingTimerRef.current !== null) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const flashHit = useCallback((region: string, damage: number) => {
    setLastHit({ region, damage });
    if (hitClearTimerRef.current !== null) {
      window.clearTimeout(hitClearTimerRef.current);
    }
    hitClearTimerRef.current = window.setTimeout(() => {
      setLastHit(null);
      hitClearTimerRef.current = null;
    }, HIT_FLASH_MS);
  }, []);

  const helpersRef = useRef<GameSocketHelpers>({ flashHit });
  helpersRef.current = { flashHit };

  const handleMessage = useCallback((raw: string) => {
    let msg: InboundServerMsg;
    try {
      msg = JSON.parse(raw) as InboundServerMsg;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'joined':
        setStatus('connected');
        setOpponentConnected(msg.opponent_connected);
        setAssignedSlot(msg.player_slot);
        setGameType(msg.game_type ?? null);
        // Stay in lobby until the server sends calibration_start (which it
        // only does once both players are connected).
        break;
      case 'pong': {
        const rtt = performance.now() - msg.t;
        rttSamplesRef.current.push(rtt);
        if (rttSamplesRef.current.length > 10) rttSamplesRef.current.shift();
        const sorted = [...rttSamplesRef.current].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        setRttMs(Math.round(median));
        setHighLatency(median > 150);
        break;
      }
      case 'ping':
        // Server-originated ping: echo back so the server can measure RTT.
        send({ type: 'pong', t: msg.t });
        break;
      case 'calibration_start':
        setOpponentConnected(true);
        setPhase('calibration');
        setMatchEnd(null);
        setLastRoundEnd(null);
        setRoundNumber(1);
        break;
      case 'match_start':
        setPhase('match');
        break;
      case 'you_were_hit':
        flashHit(msg.region, msg.damage);
        break;
      case 'player_disconnected':
        setOpponentConnected(false);
        setPhase(prev => (prev === 'lobby' || prev === 'calibration') ? 'lobby' : prev);
        break;
      case 'round_start':
        setRoundNumber(msg.round_number);
        setLastRoundEnd(null);
        break;
      case 'round_end':
        setLastRoundEnd({ winner: msg.winner, final_hp: msg.final_hp });
        break;
      case 'match_end':
        setMatchEnd({ winner: msg.winner });
        setPhase('ended');
        break;
      case 'rematch_start':
        setPhase('calibration');
        setMatchEnd(null);
        setLastRoundEnd(null);
        setRoundNumber(1);
        break;
    }

    // Hand off to app-specific dispatch for types the shared switch
    // doesn't handle (fps_state, fps_hit, etc.). We don't gate on
    // SHARED_HANDLED_TYPES — let the app observe everything if it wants.
    if (!SHARED_HANDLED_TYPES.has(msg.type)) {
      configRef.current.onAppMessage?.(msg, helpersRef.current);
    }
  }, [send, flashHit]);

  const open = useCallback(() => {
    const args = connectionArgsRef.current;
    if (!args || !args.serverUrl || !args.roomCode) return;

    intentionalCloseRef.current = false;
    setErrorMessage(null);
    setErrorCode(null);
    setStatus('connecting');

    const base = normalizeWsUrl(args.serverUrl);
    const url = `${base}/ws/player/${encodeURIComponent(args.roomCode)}?slot=${args.playerSlot}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      reconnectAttemptsRef.current = 0;
      send({
        type: 'join',
        room_code: args.roomCode,
        player_slot: args.playerSlot,
        solo: configRef.current.joinSolo(args),
      });
      pingTimerRef.current = window.setInterval(() => {
        send({ type: 'ping', t: performance.now() });
      }, PING_INTERVAL_MS);
    });

    ws.addEventListener('message', (ev) => handleMessage(ev.data as string));

    ws.addEventListener('error', () => {
      setStatus('error');
      setErrorMessage("Can't reach the server. Check your connection and try again.");
      setErrorCode('unreachable');
    });

    ws.addEventListener('close', (ev) => {
      clearTimers();
      wsRef.current = null;
      if (intentionalCloseRef.current) {
        setStatus('disconnected');
        return;
      }
      if (ev.code === 4000) {
        setStatus('error');
        setErrorMessage('That slot is already taken. Ask the host to assign you a different player slot.');
        setErrorCode('slot_taken');
        return;
      }
      if (ev.code === 4004) {
        setStatus('error');
        setErrorMessage(`Room ${args.roomCode} not found. Check the code or ask the host.`);
        setErrorCode('room_not_found');
        return;
      }
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        setStatus('connecting');
        reconnectTimerRef.current = window.setTimeout(() => {
          openRef.current();
        }, RECONNECT_DELAY_MS);
      } else {
        setStatus('error');
        setErrorMessage("Can't reach the server. Check your connection and try again.");
        setErrorCode('unreachable');
      }
    });
  }, [send, handleMessage]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const playAgain = useCallback(async () => {
    const args = connectionArgsRef.current;
    if (!args) return;
    const base = normalizeHttpUrl(args.serverUrl);
    try {
      const res = await fetch(`${base}/rooms/${encodeURIComponent(args.roomCode)}/rematch`, { method: 'POST' });
      if (!res.ok) {
        setErrorMessage(`Rematch failed (status ${res.status}). Try reconnecting.`);
        setErrorCode('unreachable');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Rematch failed');
      setErrorCode('unreachable');
    }
  }, []);

  const connectWith = useCallback((args: ConnectionArgs) => {
    connectionArgsRef.current = args;
    reconnectAttemptsRef.current = 0;
    open();
  }, [open]);

  const connect = useCallback(
    (serverUrl: string, roomCode: string, playerSlot: 1 | 2, solo: boolean = false) => {
      connectWith({ serverUrl, roomCode, playerSlot, solo });
    },
    [connectWith],
  );

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearTimers();
    if (hitClearTimerRef.current !== null) {
      window.clearTimeout(hitClearTimerRef.current);
      hitClearTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
    setStatus('disconnected');
    setPhase('lobby');
    setLastHit(null);
    setOpponentConnected(false);
    setAssignedSlot(null);
    setRttMs(0);
    setHighLatency(false);
    setMatchEnd(null);
    setLastRoundEnd(null);
    rttSamplesRef.current = [];
    connectionArgsRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearTimers();
      if (hitClearTimerRef.current !== null) {
        window.clearTimeout(hitClearTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return {
    status,
    opponentConnected,
    assignedSlot,
    gameType,
    phase,
    lastHit,
    highLatency,
    rttMs,
    roundNumber,
    lastRoundEnd,
    matchEnd,
    errorMessage,
    errorCode,
    send,
    connect,
    connectWith,
    disconnect,
    playAgain,
  };
}
