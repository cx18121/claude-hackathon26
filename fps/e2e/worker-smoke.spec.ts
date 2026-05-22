import { test, expect } from '@playwright/test';
import { readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './helpers/fixtures';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const WORKER_INIT_TIMEOUT_MS = 60_000;

// fps/ has its own pose worker that shares the same MediaPipe loader code
// path as mobile/. The pose-worker bug (type:'module' + classic-script
// importScripts loader) hit BOTH apps in prod simultaneously; this test
// guards fps independently of mobile.

test.describe('fps pose worker smoke', () => {
  let serverStop: (() => Promise<void>) | null = null;
  let baseUrl = '';
  let injectedPath = '';

  test.beforeAll(async () => {
    const server = await startStaticServer();
    serverStop = server.stop;
    baseUrl = server.baseUrl;

    const distDir = resolve(__dirname, '..', 'dist-e2e');
    const assets = await readdir(join(distDir, 'assets'));
    const workerFile = assets.find((f) => /^pose\.worker-.+\.js$/.test(f));
    if (!workerFile) throw new Error(`no pose.worker-*.js in fps dist-e2e/assets/: ${assets.join(', ')}`);

    injectedPath = join(distDir, 'worker-smoke.html');
    await writeFile(injectedPath, smokeHtml(workerFile));
  });

  test.afterAll(async () => {
    if (injectedPath) await rm(injectedPath, { force: true });
    await serverStop?.();
  });

  test('fps worker reaches type:"ready" against MediaPipe CDN', async ({ page }) => {
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

    expect(state.status, `fps worker error detail: ${state.detail ?? 'none'}`).toBe('ready');
    expect(consoleErrors, 'console.error during fps worker init').toEqual([]);
  });
});

function smokeHtml(workerFile: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>fps worker smoke</title></head>
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
