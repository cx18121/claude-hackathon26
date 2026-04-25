import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  InboundServerMsg,
  MsgYouWereHit,
  OutboundMobileMsg,
} from '../protocol';

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
  lastHit: { region: string; damage: number } | null;
  highLatency: boolean;
  rttMs: number;
  roundNumber: number;
  lastRoundEnd: RoundEnd | null;
  matchEnd: MatchEnd | null;
  errorMessage: string | null;
  send: (msg: OutboundMobileMsg) => void;
  connect: () => void;
  disconnect: () => void;
  // Mobile drives its own phase transitions because the current server build
  // does not emit calibration_start / match_start. These setters let the
  // calibration hook advance the local phase as the user progresses.
  setPhase: (phase: GamePhase) => void;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 500;
const HIT_FLASH_MS = 1500;

function normalizeWsUrl(input: string): string {
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

export function useGameSocket(
  serverUrl: string,
  roomCode: string,
  playerSlot: 1 | 2,
): UseGameSocketResult {
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [assignedSlot, setAssignedSlot] = useState<1 | 2 | null>(null);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [lastHit, setLastHit] = useState<{ region: string; damage: number } | null>(null);
  const [highLatency, setHighLatency] = useState(false);
  const [rttMs, setRttMs] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [lastRoundEnd, setLastRoundEnd] = useState<RoundEnd | null>(null);
  const [matchEnd, setMatchEnd] = useState<MatchEnd | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const hitClearTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const rttSamplesRef = useRef<number[]>([]);

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
        // The server assigns the slot itself (first open). Store the
        // authoritative value so the UI doesn't show "P2" while the server
        // attributes our hits and HP to slot 1.
        setAssignedSlot(msg.player_slot);
        // Server doesn't send calibration_start in current sprint, so begin
        // calibration as soon as we're joined. Calibration UX itself waits
        // for the user to initiate movement.
        setPhase('calibration');
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
        setPhase('calibration');
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
    if (!serverUrl || !roomCode) return;

    intentionalCloseRef.current = false;
    setErrorMessage(null);
    setStatus('connecting');

    const base = normalizeWsUrl(serverUrl);
    const url = `${base}/ws/player/${encodeURIComponent(roomCode)}`;

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
      // Send join for protocol completeness; current server ignores its body.
      send({ type: 'join', room_code: roomCode, player_slot: playerSlot });

      pingTimerRef.current = window.setInterval(() => {
        send({ type: 'ping', t: performance.now() });
      }, PING_INTERVAL_MS);
    });

    ws.addEventListener('message', (ev) => handleMessage(ev.data as string));

    ws.addEventListener('error', () => {
      setStatus('error');
      setErrorMessage('Connection error');
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
        setErrorMessage('Room is full.');
        return;
      }
      if (ev.code === 4004) {
        setStatus('error');
        setErrorMessage('Room not found.');
        return;
      }
      // Auto-reconnect on unexpected close
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        setStatus('connecting');
        reconnectTimerRef.current = window.setTimeout(() => {
          open();
        }, RECONNECT_DELAY_MS);
      } else {
        setStatus('error');
        setErrorMessage('Could not reconnect.');
      }
    });
  }, [serverUrl, roomCode, playerSlot, send, handleMessage]);

  const close = useCallback(() => {
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
    phase,
    lastHit,
    highLatency,
    rttMs,
    roundNumber,
    lastRoundEnd,
    matchEnd,
    errorMessage,
    send,
    connect: open,
    disconnect: close,
    setPhase,
  };
}
