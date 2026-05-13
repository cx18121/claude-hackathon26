---
phase: 13-mediapipe-calibration
plan: "02"
subsystem: fps-calibration
tags:
  - calibration
  - velocity
  - react-hooks
  - tdd
dependency_graph:
  requires:
    - "13-01"  # fps/ scaffold + usePose + useOneEuroFilter
  provides:
    - fps/src/lib/velocity.ts
    - fps/src/hooks/useCalibration.ts
    - fps/src/components/CalibrationScreen.tsx
  affects:
    - fps/src/App.tsx  # will import CalibrationScreen in plan 03
tech_stack:
  added: []
  patterns:
    - "Verbatim copy of mobile/ velocity utility into fps/ (zero divergence risk)"
    - "performance.now() spy pattern for deterministic frame-timing in tests"
    - "vi.spyOn module-level export pattern for mocking useCalibration in component tests"
key_files:
  created:
    - fps/src/lib/velocity.ts
    - fps/src/lib/velocity.test.ts
    - fps/src/hooks/useCalibration.ts
    - fps/src/hooks/useCalibration.test.ts
    - fps/src/components/CalibrationScreen.tsx
    - fps/src/components/CalibrationScreen.test.tsx
  modified: []
decisions:
  - "Merged worktree branch onto main (fast-forward) to gain fps/ directory, which was added in phases 12-13-01 after the worktree was created"
  - "Symlinked fps/node_modules from main repo into worktree to avoid re-installing 3998-package tree"
  - "Rewrote useCalibration tests to mock performance.now() (following mobile/src/hooks/useCalibration.test.ts pattern) — deterministic frame timing is required for punch velocity simulation in jsdom"
  - "useCalibration import path (../lib/velocity) is identical in both mobile/ and fps/ directory structures — no change required"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-13"
  tasks_completed: 3
  files_created: 6
---

# Phase 13 Plan 02: CalibrationScreen + velocity + useCalibration Summary

**One-liner:** Calibration layer for fps/ — velocity utility copied from mobile/, useCalibration state machine adapted (import path only), CalibrationScreen with video preview + stage-driven UI; 20 new tests all green.

## Tasks Completed

| # | Task | Commit | Tests |
|---|------|--------|-------|
| 1 (RED) | Failing tests for velocity.ts | f71a552 | 6 failing |
| 1 (GREEN) | velocity.ts copied verbatim from mobile/ | 77ae69f | 6 passing |
| 2 (RED) | Failing tests for useCalibration | d11fdfa | 7 failing |
| 2 (GREEN) | useCalibration adapted from mobile/ | 386d5f1 | 7 passing |
| 3 (RED) | Failing tests for CalibrationScreen | be85093 | 7 failing |
| 3 (GREEN) | CalibrationScreen implemented | 0fba0f2 | 7 passing |

## Artifacts

### fps/src/lib/velocity.ts
Verbatim copy of `mobile/src/lib/velocity.ts`. Exports: `LANDMARK` constants, `TimedFrame` interface, `computeWristVelocity`, `computeWristPeakSpeed`, `smoothKeypoints`. Imports from `@shared/protocol` (not mobile/).

### fps/src/hooks/useCalibration.ts
Adapted from `mobile/src/hooks/useCalibration.ts` with no logic changes. The import path `../lib/velocity` is identical in both `mobile/src/hooks/` and `fps/src/hooks/` so no change was required. Stage machine: idle → tpose (30 stable frames) → punches (3 peak wrist velocity measurements) → neutral (60 still frames) → done (onComplete called with average of 3 peaks).

### fps/src/components/CalibrationScreen.tsx
Props: `stream: MediaStream | null`, `keypoints: PoseKeypoint[] | null`, `onCalibrationDone: (referenceVelocity: number) => void`. Uses `useCalibration` internally. Renders: `<video autoPlay playsInline muted>` with stream wired via useEffect; instruction text; tpose panel (visibility hint + progress %); punches panel (N/3 counter); neutral panel (progress bar).

## Test Results

```
Test Files  10 passed (10)
Tests       65 passed (65)
```

All 65 fps/ tests pass, including the 20 new tests from this plan.

## Deviations from Plan

### Infrastructure Fix (not a deviation per plan rules)
**Found during:** Task 1 (first attempt)
**Issue:** The worktree `worktree-agent-ad6865e306ed1fcd8` was branched off a commit predating fps/ directory (phases 12+13-01 were merged to main after this worktree was created). The worktree checkout had no fps/ directory.
**Fix:** Fast-forward merged `refs/heads/main` into the worktree branch (no conflicts — fps/ was new). Symlinked `fps/node_modules` from the main repo path into the worktree path to avoid reinstalling 3998 packages.
**Impact:** None on implementation — all 6 plan tasks executed cleanly after the merge.

### Test Rewrite for Test 2 (useCalibration)
**Rule:** Rule 1 (bug — initial test approach didn't work)
**Found during:** Task 2 GREEN
**Issue:** Initial useCalibration tests used raw `performance.now()` without mocking. In jsdom, frame rerenders within a test run at near-identical timestamps, making `dtMs ≈ 0` and causing all velocity calculations to return 0. Punch detection tests failed despite the implementation being correct.
**Fix:** Rewrote tests following the `mobile/src/hooks/useCalibration.test.ts` pattern: spy on `performance.now()`, increment `mockNow` by `FRAME_DT_MS` (33ms) before each feed. The RED commit `d11fdfa` had the structurally-correct failing tests; the GREEN commit `386d5f1` includes both the fixed tests and the implementation.
**Files modified:** `fps/src/hooks/useCalibration.test.ts`

## Verification

```bash
# Import path checks
grep 'from.*shared' fps/src/lib/velocity.ts
# → import type { PoseKeypoint } from '@shared/protocol';

grep 'from.*lib/velocity' fps/src/hooks/useCalibration.ts
# → } from '../lib/velocity';

grep 'useCalibration' fps/src/components/CalibrationScreen.tsx
# → import { useCalibration } from '../hooks/useCalibration';
# → const cal = useCalibration({

# MsgCalibrationDone uses reference_velocity (not arm_reach)
grep 'reference_velocity' shared/protocol.ts
# → reference_velocity: number;

# Full test suite
# Test Files  10 passed (10)
# Tests       65 passed (65)
```

## TDD Gate Compliance

All three tasks followed RED → GREEN gate sequence:
1. `test(13-02): add failing tests for fps/src/lib/velocity` (f71a552) → `feat(13-02): copy velocity.ts` (77ae69f)
2. `test(13-02): add failing tests for useCalibration` (d11fdfa) → `feat(13-02): adapt useCalibration` (386d5f1)
3. `test(13-02): add failing tests for CalibrationScreen` (be85093) → `feat(13-02): implement CalibrationScreen` (0fba0f2)

## Self-Check

Files created:
- fps/src/lib/velocity.ts: FOUND
- fps/src/lib/velocity.test.ts: FOUND
- fps/src/hooks/useCalibration.ts: FOUND
- fps/src/hooks/useCalibration.test.ts: FOUND
- fps/src/components/CalibrationScreen.tsx: FOUND
- fps/src/components/CalibrationScreen.test.tsx: FOUND

Commits:
- f71a552: FOUND
- 77ae69f: FOUND
- d11fdfa: FOUND
- 386d5f1: FOUND
- be85093: FOUND
- 0fba0f2: FOUND

## Self-Check: PASSED
