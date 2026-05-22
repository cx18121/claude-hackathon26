import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { startEngine } from './helpers/fixtures';

// Regression for the "P1 punches alone, P2 stuck on Waiting" bug. Server
// behaviour: a join WITHOUT solo: true must not fire calibration_start until
// P2 has also joined. A join WITH solo: true must fire it immediately for
// slot 0 only. Both shapes verified here against a real running engine.

test.describe('server-side solo gate', () => {
  let stopEngine: (() => Promise<void>) | null = null;
  let httpBase = '';
  let wsBase = '';

  test.beforeAll(async () => {
    const engine = await startEngine();
    stopEngine = engine.stop;
    httpBase = engine.httpBase;
    wsBase = engine.wsBase;
  });

  test.afterAll(async () => {
    await stopEngine?.();
  });

  test('two-player join: P1 alone receives no calibration_start; both receive it after P2 joins', async () => {
    const roomCode = await createRoom(httpBase, 'boxing');

    const p1 = openPlayer(`${wsBase}/ws/player/${roomCode}`);
    p1.send({ type: 'join', room_code: roomCode, player_slot: 1, solo: false });

    // Drain for 1s — server must NOT send calibration_start while P1 is alone.
    const earlyMsgs = await p1.collectFor(1_000);
    expect(
      earlyMsgs.find((m) => m.type === 'calibration_start'),
      `regression: P1 received premature calibration_start: ${JSON.stringify(earlyMsgs)}`,
    ).toBeUndefined();

    const p2 = openPlayer(`${wsBase}/ws/player/${roomCode}`);
    p2.send({ type: 'join', room_code: roomCode, player_slot: 2, solo: false });

    // Both should now see calibration_start within a few seconds.
    const p1Cal = await p1.waitForType('calibration_start', 5_000);
    const p2Cal = await p2.waitForType('calibration_start', 5_000);
    expect(p1Cal.type).toBe('calibration_start');
    expect(p2Cal.type).toBe('calibration_start');

    await p1.close();
    await p2.close();
  });

  test('solo join: P1 with solo:true receives calibration_start immediately', async () => {
    const roomCode = await createRoom(httpBase, 'boxing');

    const p1 = openPlayer(`${wsBase}/ws/player/${roomCode}`);
    p1.send({ type: 'join', room_code: roomCode, player_slot: 1, solo: true });

    const cal = await p1.waitForType('calibration_start', 5_000);
    expect(cal.type).toBe('calibration_start');

    await p1.close();
  });
});

async function createRoom(httpBase: string, game: string): Promise<string> {
  const res = await fetch(`${httpBase}/rooms?game=${encodeURIComponent(game)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /rooms failed: ${res.status}`);
  const data = (await res.json()) as { room_code?: string };
  if (!data.room_code) throw new Error(`POST /rooms returned no room_code: ${JSON.stringify(data)}`);
  return data.room_code;
}

interface RawMsg { type: string; [k: string]: unknown }

interface PlayerHandle {
  ws: WebSocket;
  send: (msg: unknown) => void;
  close: () => Promise<void>;
  // Read every message arriving within `ms` after the call.
  collectFor: (ms: number) => Promise<RawMsg[]>;
  // Wait for the next message with the given `type`. Rejects on timeout.
  waitForType: (type: string, timeoutMs: number) => Promise<RawMsg>;
}

function openPlayer(url: string): PlayerHandle {
  const ws = new WebSocket(url);
  const queue: RawMsg[] = [];
  const waiters: Array<{ type: string; resolve: (m: RawMsg) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  ws.on('message', (data) => {
    let msg: RawMsg;
    try { msg = JSON.parse(data.toString()) as RawMsg; } catch { return; }
    queue.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === msg.type) {
        clearTimeout(waiters[i].timer);
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  const send = (msg: unknown) => {
    // Ensure the socket is open before sending — opening is async.
    opened.then(() => ws.send(JSON.stringify(msg))).catch(() => { /* swallow; tests will time out on missing reply */ });
  };

  const collectFor = (ms: number) =>
    new Promise<RawMsg[]>((resolve) => {
      const before = queue.length;
      setTimeout(() => resolve(queue.slice(before)), ms);
    });

  const waitForType = (type: string, timeoutMs: number) => {
    // First check the queue — the message may already have arrived.
    const existing = queue.find((m) => m.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise<RawMsg>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for type=${type} in ${timeoutMs}ms (saw: ${queue.map((m) => m.type).join(',')})`)),
        timeoutMs,
      );
      waiters.push({ type, resolve, reject, timer });
    });
  };

  const close = () =>
    new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once('close', () => resolve());
      ws.close();
    });

  return { ws, send, close, collectFor, waitForType };
}
