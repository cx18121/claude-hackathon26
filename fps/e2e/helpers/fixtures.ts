import { spawn, type ChildProcess, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const APP_DIR = resolve(__dirname, '..', '..');
const ENGINE_DIR = resolve(REPO_ROOT, 'engine');
const DIST_DIR = resolve(APP_DIR, 'dist-e2e');

// Allow CI / local override of engine bin. Default: cargo run --release.
const ENGINE_CMD = process.env.SPECTRE_ENGINE_BIN
  ? { cmd: process.env.SPECTRE_ENGINE_BIN, args: [] as string[] }
  : { cmd: 'cargo', args: ['run', '--release', '-q', '-p', 'engine-core'] };

interface EngineProcess {
  port: number;
  proc: ChildProcess;
  stop: () => Promise<void>;
  httpBase: string;
  wsBase: string;
}

interface StaticServer {
  port: number;
  server: Server;
  stop: () => Promise<void>;
  baseUrl: string;
}

export async function startEngine(): Promise<EngineProcess> {
  const port = await pickPort();
  const proc = spawn(ENGINE_CMD.cmd, ENGINE_CMD.args, {
    cwd: ENGINE_DIR,
    env: { ...process.env, PORT: String(port), RUST_LOG: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stderr?.on('data', (buf: Buffer) => {
    const line = buf.toString();
    if (/error|panicked|warn/i.test(line)) {
      // eslint-disable-next-line no-console
      console.error(`[engine:${port}] ${line.trimEnd()}`);
    }
  });

  await waitForHttp(`http://127.0.0.1:${port}/`, 60_000);

  const stop = async () => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      await new Promise<void>((res) => {
        proc.once('exit', () => res());
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
          res();
        }, 3_000);
      });
    }
  };

  return {
    port,
    proc,
    stop,
    httpBase: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
  };
}

let buildDone = false;

// Builds the fps app once per worker into dist-e2e/ with base "/" so the
// static server can serve it from root without a path prefix. Idempotent.
async function ensureBuild() {
  if (buildDone) return;
  const start = Date.now();
  const res = spawnSync(
    'npx',
    ['vite', 'build', '--base', '/', '--outDir', 'dist-e2e', '--logLevel', 'warn'],
    { cwd: APP_DIR, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
  );
  if (res.status !== 0) {
    throw new Error(
      `fps build failed (exit ${res.status}):\n${res.stderr?.toString()}\n${res.stdout?.toString()}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`[fixtures] fps build done in ${Date.now() - start}ms`);
  buildDone = true;
}

export async function startStaticServer(): Promise<StaticServer> {
  await ensureBuild();
  const port = await pickPort();
  const root = DIST_DIR;

  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const safePath = normalize(urlPath).replace(/^\/+/, '');
      let filePath = join(root, safePath);
      try {
        const s = await stat(filePath);
        if (s.isDirectory()) filePath = join(filePath, 'index.html');
      } catch {
        // Fall through; readFile will fail next and we'll 404.
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

  return {
    port,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function contentType(p: string): string {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return;
    } catch (e) {
      lastErr = e;
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

async function pickPort(): Promise<number> {
  const sock = createNetServer();
  return new Promise<number>((res, rej) => {
    sock.unref();
    sock.on('error', rej);
    sock.listen(0, '127.0.0.1', () => {
      const port = (sock.address() as { port: number }).port;
      sock.close(() => res(port));
    });
  });
}
