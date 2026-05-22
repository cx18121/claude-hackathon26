import { test, expect } from '@playwright/test';
import { readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './helpers/fixtures';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// The pose worker pulled MediaPipe WASM and a 5MB model down before reporting
// ready in our local smoke run; CDN cold-fetches can push this higher.
const WORKER_INIT_TIMEOUT_MS = 60_000;

test.describe('pose worker smoke', () => {
  let serverStop: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let injectedPath = '';

  test.beforeAll(async () => {
    const server = await startStaticServer();
    serverStop = server.stop;
    baseUrl = server.baseUrl;

    // Find the hashed worker filename inside dist-e2e/assets/ and write a
    // minimal HTML page that boots the worker and posts init. We inject this
    // page into the served dist so the worker URL stays same-origin.
    const distDir = resolve(__dirname, '..', 'dist-e2e');
    const assets = await readdir(join(distDir, 'assets'));
    const workerFile = assets.find((f) => /^pose\.worker-.+\.js$/.test(f));
    if (!workerFile) throw new Error(`no pose.worker-*.js in dist-e2e/assets/: ${assets.join(', ')}`);

    injectedPath = join(distDir, 'worker-smoke.html');
    await writeFile(injectedPath, smokeHtml(workerFile));
  });

  test.afterAll(async () => {
    if (injectedPath) await rm(injectedPath, { force: true });
    await serverStop?.();
  });

  test('worker reaches type:"ready" against MediaPipe CDN', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${baseUrl}/worker-smoke.html`);
    await page.waitForFunction(
      () => (window as unknown as { __smoke?: { status: string } }).__smoke?.status &&
        (window as unknown as { __smoke: { status: string } }).__smoke.status !== 'pending',
      undefined,
      { timeout: WORKER_INIT_TIMEOUT_MS },
    );

    const state = await page.evaluate(
      () => (window as unknown as { __smoke: { status: string; detail: string | null } }).__smoke,
    );

    expect(state.status, `worker error detail: ${state.detail ?? 'none'}`).toBe('ready');
    // MediaPipe writes setup info via the JS-side stderr → console.log channel,
    // not console.error, so any error-level message is a real failure surface.
    expect(consoleErrors, 'console.error during worker init').toEqual([]);
  });
});

function smokeHtml(workerFile: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>worker smoke</title></head>
<body><pre id="log">starting…</pre>
<script>
const log = document.getElementById('log');
const append = (s) => { log.textContent += '\\n' + s; };
window.__smoke = { status: 'pending', detail: null };

try {
  const w = new Worker('./assets/${workerFile}');
  append('worker spawned');
  w.onmessage = (e) => {
    append('msg: ' + JSON.stringify(e.data));
    if (e.data && e.data.type === 'ready') {
      window.__smoke = { status: 'ready', detail: null };
    } else if (e.data && e.data.type === 'error') {
      window.__smoke = { status: 'error', detail: e.data.message };
    }
  };
  w.onerror = (e) => {
    append('worker error: ' + e.message);
    window.__smoke = { status: 'error', detail: 'onerror: ' + e.message };
  };
  w.postMessage({
    type: 'init',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
    modelUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  });
  append('init posted');
} catch (err) {
  append('spawn threw: ' + err.message);
  window.__smoke = { status: 'error', detail: 'spawn: ' + err.message };
}
</script>
</body></html>`;
}
