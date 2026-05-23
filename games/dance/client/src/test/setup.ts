// Vitest setup: shared mocks for browser APIs jsdom doesn't provide.

import { afterEach } from 'vitest';
import '@testing-library/jest-dom';

// performance.now is provided by jsdom but at module init we sometimes
// import code that captures it; ensure it's defined.
if (!('performance' in globalThis) || typeof globalThis.performance.now !== 'function') {
  // @ts-expect-error narrow runtime polyfill
  globalThis.performance = { now: () => Date.now() };
}

afterEach(() => {
  // No global cleanup needed yet; placeholder for future hook unmount checks.
});
