import { test, expect } from '@playwright/test';
import { startEngine, startStaticServer } from './helpers/fixtures';

// Overlay is the spectator view — pure WS consumer, no camera, no MediaPipe.
// The bug class to guard against: a deserialization or render crash when the
// engine sends valid protocol messages. The "Waiting for players to join"
// text only appears once useSpectatorSocket has both connected AND received
// the initial lobby_update broadcast, so this single assertion verifies the
// full read path is wired up correctly.

test.describe('overlay render smoke', () => {
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

  test('overlay loads, connects to engine, shows waiting screen with no errors', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const roomCode = await createRoom(httpBase);

    await page.goto(
      `${baseUrl}/?server=${encodeURIComponent(wsBase)}&room=${encodeURIComponent(roomCode)}`,
    );

    // SPECTRE title appears once the WaitingOverlay renders, which requires
    // roundState.phase === 'waiting' (set by useSpectatorSocket's initial
    // state) AND no gameState/matchWinner. If JS crashed during mount this
    // wouldn't render.
    await expect(page.getByText('SPECTRE', { exact: true })).toBeVisible({ timeout: 15_000 });

    // With an empty fresh room both slots are unfilled — the hint should
    // confirm that copy is on screen (proves lobby_update was received and
    // applied to React state, not just the static initial render).
    await expect(page.getByText(/Waiting for players to join|Waiting for second player/)).toBeVisible({
      timeout: 10_000,
    });

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    // Filter out a known-benign WebGL warning some chromium versions log when
    // PixiCanvas mounts a software-rendered context in headless mode.
    const meaningfulConsoleErrors = consoleErrors.filter(
      (e) => !/WebGL|GPU/i.test(e),
    );
    expect(meaningfulConsoleErrors, `console.error: ${meaningfulConsoleErrors.join(' | ')}`).toEqual([]);
  });
});

async function createRoom(httpBase: string): Promise<string> {
  const res = await fetch(`${httpBase}/rooms?game=boxing`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /rooms failed: ${res.status}`);
  const data = (await res.json()) as { room_code?: string };
  if (!data.room_code) throw new Error(`POST /rooms returned no room_code`);
  return data.room_code;
}
