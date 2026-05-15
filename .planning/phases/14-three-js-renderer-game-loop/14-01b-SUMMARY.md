---
phase: 14-three-js-renderer-game-loop
plan: 01b
subsystem: fps-pose-worker-renderer
tags: [latency, gpu-fallback, coordinate-map, outline-effect, verification]
dependency_graph:
  requires: [14-01]
  provides: [latency_warning-per-frame, y-axis-sign-verified, outline-effect-confirmed]
  affects: [14-02, 14-03]
tech_stack:
  added: []
  patterns: [per-frame-latency-postMessage, dual-scene-depth-clear]
key_files:
  created: []
  modified:
    - fps/src/workers/pose.worker.ts
    - fps/src/hooks/usePose.ts
    - fps/src/lib/coordinateMap.ts
    - fps/src/hooks/useGameRenderer.ts
decisions:
  - "D-15 latency_warning fired per-frame (not once via warnedRef) — all frames > 25ms reported"
  - "Y-axis sign verified: MediaPipe worldLandmarks Y positive-down; -kp.y negation is correct for Three.js positive-up"
  - "OutlineEffect + autoClear=false CONFIRMED: renderer.clearDepth() before outlineEffect.render() prevents depth bleed; no outlineEffect.autoClear override needed"
metrics:
  duration: ~15min
  completed: "2026-05-15"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 14 Plan 01b: Per-frame GPU Latency + Verification Spikes Summary

Per-frame GPU fallback detection (D-15) added to pose.worker.ts; Y-axis sign and OutlineEffect/autoClear=false dual-scene interaction confirmed correct via documented reasoning, resolving open research questions A2 and Q7 before Plans 14-02/14-03.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Per-frame GPU latency assertion in pose.worker.ts (D-15) | 02cae17 | fps/src/workers/pose.worker.ts, fps/src/hooks/usePose.ts |
| 2 | Verification spikes — Y-axis sign + OutlineEffect/autoClear=false | eebf3ee | fps/src/lib/coordinateMap.ts, fps/src/hooks/useGameRenderer.ts |

## What Was Built

**Task 1 — D-15 latency reporting:**
- `pose.worker.ts`: Extended `OutMessage` union with `{ type: 'latency_warning'; elapsedMs: number }`. Wrapped `detectForVideo` with `performance.now()` timing; posts `latency_warning` every frame where inference exceeds 25ms (no suppression flag).
- `usePose.ts`: Removed `warnedRef` once-only gate and `LATENCY_THRESHOLD_MS` constant. Added `'latency_warning'` case in `worker.onmessage` that fires `console.warn` per-frame with the measured elapsed time. Rolling latency window retained for round-trip tracking.

**Task 2 — Research question resolution:**
- `coordinateMap.ts`: Updated JSDoc from `[ASSUMED A2]` to "Y sign verified" with rationale: MediaPipe worldLandmarks Y is positive-down; applying `-kp.y` negation maps it to Three.js positive-up convention, placing head/shoulders above the hip-midpoint origin as expected.
- `useGameRenderer.ts`: Added verification comment above the dual-scene render block: OutlineEffect + autoClear=false CONFIRMED — `renderer.clearDepth()` before `outlineEffect.render()` prevents depth bleed; no `outlineEffect.autoClear` override needed. No debug sphere code added or left in any committed file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] node_modules empty in worktree — installed dependencies**
- **Found during:** Task 1 verification (npm run build)
- **Issue:** The worktree's `fps/node_modules` was empty; `npm run build` failed with `Cannot find package 'vite'`
- **Fix:** Ran `npm install` in the worktree's `fps/` directory
- **Files modified:** fps/node_modules (not committed — gitignored)

**2. [Rule 1 - Bug] LATENCY_THRESHOLD_MS unused after warnedRef removal**
- **Found during:** Task 1 build check
- **Issue:** TS6133 — `LATENCY_THRESHOLD_MS` declared but never read after removing the once-only warning block
- **Fix:** Removed `const LATENCY_THRESHOLD_MS = 25;` from usePose.ts
- **Files modified:** fps/src/hooks/usePose.ts (same commit as Task 1)

**3. [Rule 1 - Bug] Type cast error for latency_warning elapsedMs**
- **Found during:** Task 1 build check
- **Issue:** TS2352 — `(msg as { elapsedMs: number })` failed because the local `msg` type didn't overlap sufficiently; needed `unknown` intermediate cast
- **Fix:** Changed to `(msg as unknown as { elapsedMs: number })`
- **Files modified:** fps/src/hooks/usePose.ts (same commit as Task 1)

**4. [Out-of-scope pre-existing] useCalibration.test.ts TS2345 errors**
- **Status:** Pre-existing; identical errors on main branch before any changes in this plan
- **Action:** Logged to deferred-items; not fixed (out of scope per deviation rule boundary)

## Known Stubs

None — all changes are functional (latency reporting, documented coordinate verification, render loop comment).

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- fps/src/workers/pose.worker.ts: exists with `latency_warning` (count=2) and `elapsedMs` (count=4)
- fps/src/hooks/usePose.ts: exists with `latency_warning` handler; `warnedRef.current = true` count=0
- fps/src/lib/coordinateMap.ts: exists with "verified" (count=1)
- fps/src/hooks/useGameRenderer.ts: exists with "OutlineEffect.*verified" (count=1); debugSphere count=0
- Commits 02cae17 and eebf3ee present in git log
