---
phase: 12-fps-client-scaffold
plan: "03"
subsystem: fps-client
tags: [websocket, hook, waiting-screen, react, tdd]
dependency_graph:
  requires:
    - "12-01: fps/ Vite+React scaffold"
  provides:
    - "useGameSocket hook (WebSocket lifecycle, URL normalization)"
    - "WaitingScreen component (lobby waiting state UI)"
  affects:
    - "fps/src/hooks/useGameSocket.ts"
    - "fps/src/components/WaitingScreen.tsx"
tech_stack:
  added:
    - "vitest with jsdom environment for fps/"
    - "@testing-library/react cleanup in setup.ts"
  patterns:
    - "TDD: RED commit before GREEN commit for WaitingScreen"
    - "Copy-verbatim pattern: useGameSocket from mobile/ unchanged"
key_files:
  created:
    - fps/src/hooks/useGameSocket.ts
    - fps/src/hooks/useGameSocket.test.ts
    - fps/src/components/WaitingScreen.tsx
    - fps/src/components/WaitingScreen.test.tsx
    - fps/vitest.config.ts
    - fps/src/test/setup.ts
  modified: []
decisions:
  - "Copied useGameSocket verbatim from mobile/ — same wire protocol, no changes needed"
  - "Added cleanup() from @testing-library/react in setup.ts to prevent DOM leakage between tests"
  - "Created vitest.config.ts (missing from scaffold) with jsdom + @shared alias for fps/"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-13"
  tasks_completed: 2
  files_created: 6
---

# Phase 12 Plan 03: useGameSocket + WaitingScreen Summary

WebSocket hook copied verbatim from mobile/ and WaitingScreen component implemented with full TDD cycle (RED/GREEN).

## Tasks Completed

| # | Name | Commit | Result |
|---|------|--------|--------|
| 1 | Copy useGameSocket from mobile/ + URL tests | b5b4942 | 10 normalization tests pass |
| 2 (RED) | WaitingScreen failing tests | 402aa6c | 6 tests fail (component missing) |
| 2 (GREEN) | Implement WaitingScreen | faac183 | All 16 tests pass |

## What Was Built

**fps/src/hooks/useGameSocket.ts** — Verbatim copy of `mobile/src/hooks/useGameSocket.ts`. Exports: `useGameSocket`, `normalizeWsUrl`, `normalizeHttpUrl`, `SocketStatus`, `GamePhase`, `UseGameSocketResult`. Connects via `ws/player/{room}?slot={n}`, handles MsgJoin handshake, ping/pong, opponentConnected state, player_disconnected, calibration_start, reconnect with MAX_RECONNECT_ATTEMPTS=5.

**fps/src/components/WaitingScreen.tsx** — Simple presentational component. Props: `roomCode: string`, `slot: 1 | 2`, `opponentConnected: boolean`. Renders room code, player slot, and status message ("Waiting for opponent..." / "Both players connected — starting...").

**fps/vitest.config.ts** — Test config with jsdom environment and @shared path alias (was missing from the plan 12-01 scaffold).

## Verification

```
Tests:  16 passed (10 normalizeWsUrl/normalizeHttpUrl + 6 WaitingScreen)
Build:  npm run build exits 0, no TypeScript errors
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing vitest.config.ts in fps/ scaffold**
- **Found during:** Task 1 (running npm test)
- **Issue:** fps/vite.config.ts had no test section; vitest had no jsdom environment configured
- **Fix:** Created fps/vitest.config.ts with jsdom environment, @shared alias, and setupFiles pointing to fps/src/test/setup.ts
- **Files modified:** fps/vitest.config.ts (created), fps/src/test/setup.ts (created)
- **Commit:** b5b4942

**2. [Rule 1 - Bug] DOM leakage between tests without cleanup**
- **Found during:** Task 2 GREEN (2 of 6 WaitingScreen tests failed with "Found multiple elements")
- **Issue:** @testing-library/react renders accumulate in jsdom between tests without explicit cleanup()
- **Fix:** Added `import { cleanup } from '@testing-library/react'` and `afterEach(() => cleanup())` in setup.ts
- **Files modified:** fps/src/test/setup.ts
- **Commit:** faac183

## Known Stubs

None — WaitingScreen is fully wired to its props; no hardcoded empty values.

## Threat Flags

None — no new network endpoints or trust boundaries beyond what the plan's threat model covers.

## Self-Check: PASSED

- [x] fps/src/hooks/useGameSocket.ts exists
- [x] fps/src/hooks/useGameSocket.test.ts exists (10 tests)
- [x] fps/src/components/WaitingScreen.tsx exists
- [x] fps/src/components/WaitingScreen.test.tsx exists (6 tests)
- [x] fps/vitest.config.ts exists
- [x] RED commit 402aa6c exists (failing tests)
- [x] GREEN commit faac183 exists (passing tests)
- [x] All 16 tests pass
- [x] npm run build exits 0
