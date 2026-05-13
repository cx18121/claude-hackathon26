---
phase: 13-mediapipe-calibration
plan: "03"
subsystem: fps-frontend
tags: [react, hooks, websocket, calibration, pose-pipeline]
dependency_graph:
  requires:
    - "13-01"  # usePose + useOneEuroFilter
    - "13-02"  # CalibrationScreen + useCalibration + velocity
  provides:
    - App.tsx extended with pose pipeline + calibration routing
    - MsgCalibrationDone wired via socket.send
  affects:
    - fps/src/App.tsx
    - fps/src/components/CalibrationScreen.tsx
tech_stack:
  added: []
  patterns:
    - App-level hook placement for cross-phase reuse (usePose called in App, not CalibrationScreen)
    - Phase-driven screen routing (socket.phase drives showCalibration/showMatch)
    - Optional videoRef prop for parent-to-child ref sharing
key_files:
  created: []
  modified:
    - fps/src/App.tsx
    - fps/src/components/CalibrationScreen.tsx
    - fps/src/App.test.tsx
decisions:
  - "usePose called unconditionally at App level (not inside CalibrationScreen) so Phase 14 game loop can reuse the same hook instance without spawning a second Worker"
  - "videoRef created in App and passed down as optional prop to CalibrationScreen; CalibrationScreen falls back to internal ref when prop absent (preserves backward compat with existing tests)"
  - "showMatch uses socket.phase === 'match' condition (not screen === 'game') to align with server-driven phase transitions"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-13T15:57:35Z"
  tasks_completed: 1
  files_modified: 3
---

# Phase 13 Plan 03: App.tsx Wiring Summary

Wire the full pose pipeline into App.tsx and add phase-driven routing for calibration and match screens.

## What Was Built

**App.tsx extensions:**

1. `usePose(videoRef, cameraReady, workerRef)` — called unconditionally at App level. `workerRef` comes from `useWarmup()`. `cameraReady` is true when `screen !== 'permission' && screen !== 'warmup' && warmupStatus === 'ready'`.

2. `useOneEuroFilter(pose.keypoints)` — chains off usePose output to smooth worldLandmarks before they reach CalibrationScreen.

3. Phase routing:
   - `showCalibration = screen === 'waiting' && socket.phase === 'calibration'` → renders `<CalibrationScreen>`
   - `showMatch = screen === 'waiting' && socket.phase === 'match'` → renders `<div id="game-canvas-root" />`

4. `onCalibrationDone` handler sends `{ type: 'calibration_done', reference_velocity: refVel }` via `socket.send`. No `arm_reach` field anywhere.

**CalibrationScreen.tsx surgical update:**
- Added optional `videoRef?: React.RefObject<HTMLVideoElement | null>` prop
- Component uses external ref when provided, falls back to internal ref otherwise
- All 7 existing CalibrationScreen tests continue to pass (no external ref provided in those tests)

## Tests

- 6 new App.test.tsx tests: phase routing (calibration/lobby/match), MsgCalibrationDone shape (reference_velocity not arm_reach), usePose workerRef identity, useOneEuroFilter chaining
- Total: 71 tests pass (65 prior + 6 new)

## TDD Gate Compliance

- RED commit: `e1bac1b` — `test(13-03): add failing tests for App.tsx phase routing + calibration wiring` (5/6 tests failing before implementation)
- GREEN commit: `4bb016c` — `feat(13-03): wire usePose+useOneEuroFilter+CalibrationScreen into App.tsx` (all 6 tests pass)

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree merge required**
- Found during: Setup
- Issue: Worktree branch was based on an older commit (pre-fps/) and did not contain the `fps/` directory or Phase 13 Plan 01-02 work
- Fix: `git merge main` fast-forwarded the worktree branch to include all prior work
- Impact: None — no code conflicts, clean fast-forward

**Pre-existing TypeScript errors (out of scope — deferred):**
- `fps/src/hooks/useCalibration.test.ts` has ~15 TS2345 type errors that pre-exist in main and are not caused by this plan's changes
- These do not affect vitest test execution (71/71 pass) but do cause `npm run build` to emit errors from that file
- Logged to deferred-items for a follow-up fix

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. MsgCalibrationDone is sent over the existing WebSocket connection already covered by T-13-03-01 in the plan's threat model. TypeScript's `OutboundMobileMsg` union enforces `reference_velocity` at compile time — `arm_reach` would be a type error.

## Self-Check

- [x] `fps/src/App.tsx` modified and contains all 4 additions
- [x] `fps/src/components/CalibrationScreen.tsx` modified with optional videoRef prop
- [x] `fps/src/App.test.tsx` created with 6 tests
- [x] RED commit: e1bac1b
- [x] GREEN commit: 4bb016c
- [x] 71 tests pass (`npx vitest run`)
- [x] No new TypeScript errors in modified files

## Self-Check: PASSED
