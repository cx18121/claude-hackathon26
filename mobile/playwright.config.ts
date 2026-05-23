import { defineConfig, devices } from '@playwright/test';

// CI gives flaky tests one retry; locally we want first-run failures to surface.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // The full slice (engine + vite preview + browser) needs more than the 30s default
  // when CI cold-starts cargo and chromium concurrently.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // engine and preview ports are shared resources
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  // Two browser engines: chromium (Android/desktop Chrome signal) and webkit
  // (same engine as iOS Safari, so failures here are the best non-device
  // proxy for the iOS bugs we ship). Solo-flow uses chromium's
  // --use-fake-device-for-media-stream flag, which webkit doesn't expose, so
  // it's chromium-only; worker-smoke and two-player-gate don't need a camera
  // and run on both engines.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
      testIgnore: /solo-flow\.spec\.ts/,
    },
  ],
});
