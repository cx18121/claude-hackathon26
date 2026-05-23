import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { startEngine, startStaticServer } from './helpers/fixtures';

// Drives the overlay through a real match shape:
//   1. POST /rooms — create a boxing room
//   2. Open the overlay against /ws/spectator/{room}
//   3. Open WS as P1 + P2, send join (solo:false both), send calibration_done
//      both → engine should fire match_start, then game_state ticks
//   4. Assert HudLayer is visible AND HP bars are rendered with width > 0
//
// This is the test that would have caught:
//   - gameType filtering that hides HUD for fps_boxing
//   - HP fields not present on game_state
//   - any regression where match_start fires but game_state never broadcasts

test.describe('overlay HUD during a live match', () => {
  let stopEngine: (() => Promise<void>) | null = null;
  let stopStatic: (() => Promise<void>) | null = null;
  let httpBase = '';
  let wsBase = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    const [engine, server] = await Promise.all([startEngine(), startStaticServer()]);
    stopEngine = engine.stop;
    stopStatic = server.stop;
    httpBase = engine.httpBase;
    wsBase = engine.wsBase;
    baseUrl = server.baseUrl;
  });

  test.afterAll(async () => {
    await Promise.allSettled([stopEngine?.(), stopStatic?.()]);
  });

  test('boxing room: HP bars render with width once game_state ticks arrive', async ({ page }) => {
    const room = await createRoom(httpBase, 'boxing');

    await page.goto(
      `${baseUrl}/?server=${encodeURIComponent(wsBase)}&room=${encodeURIComponent(room)}`,
    );

    // Spawn two raw-WS "players" that mirror the real client handshake enough
    // to drive the server through to match_start.
    const p1 = await openAndJoin(`${wsBase}/ws/player/${room}`, 1);
    const p2 = await openAndJoin(`${wsBase}/ws/player/${room}`, 2);

    // Both clients receive calibration_start; respond with calibration_done so
    // the engine starts the game loop and begins broadcasting game_state.
    await Promise.all([
      p1.waitForType('calibration_start', 5_000),
      p2.waitForType('calibration_start', 5_000),
    ]);
    p1.send({ type: 'calibration_done', reference_velocity: 2.5 });
    p2.send({ type: 'calibration_done', reference_velocity: 2.5 });

    // Within a couple of seconds the HUD should be in the DOM. The "P1" label
    // is rendered unconditionally inside HudLayer, so its presence proves the
    // gating chain (gameType === 'boxing') worked.
    await expect(page.locator('.hud-band')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.hud-p1-name .hud-label')).toHaveText('P1');
    await expect(page.locator('.hud-p2-name .hud-label')).toHaveText('P2');

    // Both HP bars start at 100% — assert their rendered width is > 50% of
    // the track. If MAX_HP gets desynced from the server's initial_hp the
    // bars start at <13%, which would visibly trip this threshold.
    const widths = await readHpFillWidthPercents(page);
    expect(widths.p1, `P1 HP fill at start: ${JSON.stringify(widths)}`).toBeGreaterThan(50);
    expect(widths.p2, `P2 HP fill at start: ${JSON.stringify(widths)}`).toBeGreaterThan(50);

    await p1.close();
    await p2.close();
  });
});

async function createRoom(httpBase: string, game: string): Promise<string> {
  const res = await fetch(`${httpBase}/rooms?game=${encodeURIComponent(game)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /rooms failed: ${res.status}`);
  const data = (await res.json()) as { room_code?: string };
  if (!data.room_code) throw new Error('POST /rooms returned no room_code');
  return data.room_code;
}

interface PlayerHandle {
  ws: WebSocket;
  send: (msg: unknown) => void;
  close: () => Promise<void>;
  waitForType: (type: string, timeoutMs: number) => Promise<Record<string, unknown>>;
}

async function openAndJoin(url: string, slot: 1 | 2): Promise<PlayerHandle> {
  const ws = new WebSocket(url);
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<{
    type: string;
    resolve: (m: Record<string, unknown>) => void;
    timer: NodeJS.Timeout;
  }> = [];

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    queue.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === msg.type) {
        clearTimeout(waiters[i].timer);
        waiters[i].resolve(msg);
        waiters.splice(i, 1);
      }
    }
  });

  const send = (m: unknown) => ws.send(JSON.stringify(m));

  send({ type: 'join', room_code: '', player_slot: slot, solo: false });

  return {
    ws,
    send,
    close: () => new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once('close', () => resolve());
      ws.close();
    }),
    waitForType: (type, timeoutMs) => {
      const existing = queue.find((m) => m.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${type} (saw: ${queue.map((m) => m.type).join(',')})`)),
          timeoutMs,
        );
        waiters.push({ type, resolve, timer });
      });
    },
  };
}

async function readHpFillWidthPercents(page: Page): Promise<{ p1: number; p2: number }> {
  return page.evaluate(() => {
    const fillRect = (sel: string): number => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return 0;
      const trackRect = el.parentElement?.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (!trackRect || trackRect.width === 0) return 0;
      return (elRect.width / trackRect.width) * 100;
    };
    return {
      p1: fillRect('.hp-fill-p1'),
      p2: fillRect('.hp-fill-p2'),
    };
  });
}
