import { test, expect } from '@playwright/test';
import { startEngine, startStaticServer } from './helpers/fixtures';

// Full vertical slice: real engine + real built mobile app + headless chromium
// with a fake camera stream. Catches the class of bugs that don't show up
// until everything is wired together (the original pose worker prod regression
// + the solo gate + the camera fit changes).

test.describe('solo flow against a real engine', () => {
  let stopEngine: (() => Promise<void>) | null = null;
  let stopStatic: (() => Promise<void>) | null = null;
  let httpBase = '';
  let baseUrl = '';

  test.beforeAll(async () => {
    const [engine, server] = await Promise.all([startEngine(), startStaticServer()]);
    stopEngine = engine.stop;
    stopStatic = server.stop;
    httpBase = engine.httpBase;
    baseUrl = server.baseUrl;
  });

  test.afterAll(async () => {
    await Promise.allSettled([stopEngine?.(), stopStatic?.()]);
  });

  test('Play Solo button creates a room, joins, and reaches the calibration overlay', async ({ page, context }) => {
    // Grant camera so getUserMedia resolves with the chromium fake-device stream.
    await context.grantPermissions(['camera'], { origin: baseUrl });

    // Surface page-side errors so a failed worker init doesn't masquerade as a
    // UI timeout.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${baseUrl}/`);
    await expect(page.getByRole('heading', { name: 'Spectre' })).toBeVisible();

    // The connection screen needs a server URL before Play Solo is enabled.
    // Use the engine's HTTP base; useGameSocket normalises http→ws internally.
    const serverUrl = httpBase.replace(/^http/, 'ws');
    await page.getByLabel('Server URL').fill(serverUrl);

    const soloBtn = page.getByRole('button', { name: /play solo/i });
    await expect(soloBtn).toBeEnabled();
    await soloBtn.click();

    // The "READY" overlay appears once phase === 'calibration' AND model is ready.
    // This single assertion proves: room created, WS connected, solo flag honored
    // by server, calibration_start received, pose worker loaded.
    await expect(page.getByRole('button', { name: 'READY' })).toBeVisible({ timeout: 60_000 });

    expect(pageErrors, `page errors during solo flow: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
