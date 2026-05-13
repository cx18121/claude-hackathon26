import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  InboundServerMsg,
  MsgYouWereHit,
  OutboundMobileMsg,
} from '@shared/protocol';

export type SocketStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type GamePhase = 'lobby' | 'calibration' | 'match' | 'ended';

export interface RoundEnd {
  winner: 1 | 2 | null;
  final_hp: [number, number];
}

export interface MatchEnd {
  winner: 1 | 2;
}

export interface UseGameSocketResult {
  status: SocketStatus;
  opponentConnected: boolean;
  phase: GamePhase;
  // Authoritative slot the server assigned to this connection (set on
  // 'joined'). The server's WS handler picks the first open slot regardless
  // of the value the client sent in 'join', so we cannot trust the locally
  // chosen slot to match what the server uses for hit attribution and
  // win/lose messaging. UI must use this once it's set.
  assignedSlot: 1 | 2 | null;
  gameType: string | null;
  lastHit: { region: string; damage: number } | null;
  highLatency: boolean;
  rttMs: number;
  roundNumber: number;
  lastRoundEnd: RoundEnd | null;
  matchEnd: MatchEnd | null;
  errorMessage: string | null;
  errorCode: 'unreachable' | 'room_not_found' | 'slot_taken' | null;
  send: (msg: OutboundMobileMsg) => void;
  connect: (serverUrl: string, roomCode: string, playerSlot: 1 | 2) => void;
  disconnect: () => void;
  // Mobile drives its own phase transitions because the current server build
  // does not emit calibration_start / match_start. These setters let the
  // calibration hook advance the local phase as the user progresses.
  setPhase: (phase: GamePhase) => void;
  playAgain: () => Promise<void>;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 500;
const HIT_FLASH_MS = 1500;

export function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('ws://')) {
    return 'http://' + trimmed.slice('ws://'.length).replace(/\/$/, '');
  }
  if (trimmed.startsWith('wss://')) {
    return 'https://' + trimmed.slice('wss://'.length).replace(/\/$/, '');
  }
  return 'http://' + trimmed.replace(/\/$/, '');
}

export function normalizeWsUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('http://')) {
    return 'ws://' + trimmed.slice('http://'.length).replace(/\/$/, '');
  }
  if (trimmed.startsWith('https://')) {
    return 'wss://' + trimmed.slice('https://'.length).replace(/\/$/, '');
  }
  // Bare host:port
  return 'ws://' + trimmed.replace(/\/$/, '');
}

interface ConnectionArgs {
  serverUrl: string;
  roomCode: string;
  playerSlot: 1 | 2;
}

export function useGameSocket(): UseGameSocketResult {
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
  // Ref to the latest open() implementation so the close handler's
  // reconnect path always invokes the current closure rather than a
  // stale one captured at WS creation time.
  const openRef = useRef<() => void>(() => {});

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

      case 'you_were_hit': {
        const hit: MsgYouWereHit = msg;
        setLastHit({ region: hit.region, damage: hit.damage });
        if (hitClearTimerRef.current !== null) {
          window.clearTimeout(hitClearTimerRef.current);
        }
        hitClearTimerRef.current = window.setTimeout(() => {
          setLastHit(null);
          hitClearTimerRef.current = null;
        }, HIT_FLASH_MS);
        break;
      }

      case 'player_disconnected':
        setOpponentConnected(false);
        // If the opponent leaves before the match starts, drop back to the lobby.
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

      // game_state goes to spectators only; mobile ignores it if it ever arrives.
      default:
        break;
    }
  }, [send]);

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
      // Send join for protocol completeness; current server ignores its body
      // and assigns the slot itself based on first open. The 'joined'
      // response carries the authoritative slot.
      send({
        type: 'join',
        room_code: args.roomCode,
        player_slot: args.playerSlot,
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
      // Auto-reconnect on unexpected close. Use the ref so we always invoke
      // the latest open() closure rather than a stale capture.
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

  // Keep the openRef in sync with the latest open closure.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const playAgain = useCallback(async () => {
    const args = connectionArgsRef.current;
    if (!args) return;
    const base = normalizeHttpUrl(args.serverUrl);
    await fetch(`${base}/rooms/${encodeURIComponent(args.roomCode)}/rematch`, { method: 'POST' });
  }, []);

  const connect = useCallback(
    (serverUrl: string, roomCode: string, playerSlot: 1 | 2) => {
      connectionArgsRef.current = { serverUrl, roomCode, playerSlot };
      reconnectAttemptsRef.current = 0;
      open();
    },
    [open],
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
    disconnect,
    setPhase,
    playAgain,
  };
}
