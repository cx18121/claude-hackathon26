---
phase: 14-three-js-renderer-game-loop
plan: 01
subsystem: fps-renderer
tags: [three-js, webgl, game-loop, arm-geometry, toon-shading, fps-boxing]
dependency_graph:
  requires: []
  provides:
    - fps/src/lib/coordinateMap.ts (keypointToWorld, WORLD_SCALE)
    - fps/src/lib/armGeometry.ts (buildArmSegment, updateArmSegment)
    - fps/src/hooks/useGameRenderer.ts (Three.js lifecycle, dual-scene render loop)
    - fps/src/components/GameRenderer.tsx (thin React canvas mount)
  affects:
    - fps/src/hooks/useGameSocket.ts (added lastFpsState, lastFpsHit fields)
    - fps/src/App.tsx (showMatch branch now renders GameRenderer)
tech_stack:
  added:
    - three@^0.184.0
    - "@types/three@^0.184.1"
  patterns:
    - dual-scene depth separation (clearDepth between world and arms passes)
    - OutlineEffect for MeshToonMaterial toon outlines (backface inflation)
    - refs-not-state for Three.js lifecycle in React hooks
    - prop-to-ref sync to avoid stale closures in setAnimationLoop
key_files:
  created:
    - fps/src/lib/coordinateMap.ts
    - fps/src/lib/armGeometry.ts
    - fps/src/hooks/useGameRenderer.ts
    - fps/src/components/GameRenderer.tsx
  modified:
    - fps/package.json (added three + @types/three)
    - fps/index.html (Anton Google Font preconnect/stylesheet)
    - fps/src/hooks/useGameSocket.ts (lastFpsState, lastFpsHit)
    - fps/src/App.tsx (GameRenderer in showMatch branch)
    - fps/src/App.test.tsx (mock GameRenderer, fix socket mock)
decisions:
  - "Import MsgFpsState/MsgFpsHit from @shared/protocol (already defined there), not from .claude/worktrees/shared/ — avoids duplicated types"
  - "Handle fps_state/fps_hit in default branch of handleMessage switch since InboundServerMsg union does not include them — avoids TS2678 error without modifying shared protocol"
  - "Cap anchorOffset at (0, -0.25*WORLD_SCALE, -0.4*WORLD_SCALE) — ASSUMED A4, tune with live webcam"
  - "Use void dt in animation loop to suppress noUnusedLocals TS error — dt will be used in Plan 14-02 spring physics"
metrics:
  duration_minutes: 5
  completed_date: "2026-05-15T04:59:29Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 9
---

# Phase 14 Plan 01: Three.js Setup + Arm Geometry Summary

Three.js installed and wired with dual-scene toon-shaded arm rendering: player arms (MeshToonMaterial + OutlineEffect) in an arms-only scene pass; opponent arms in the world scene; `clearDepth()` between passes for FPR-04 depth separation.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Install three.js, add Anton font, extend useGameSocket with fps_state/fps_hit | 3a659b6 |
| 2 | Create coordinateMap.ts and armGeometry.ts utility modules | 058f2a2 |
| 3 | Implement useGameRenderer hook, GameRenderer component, wire App.tsx | abb4eb9 |

## What Was Built

**Task 1 — Dependencies + Socket Extension:**
- `three@^0.184.0` and `@types/three@^0.184.1` installed to `fps/`
- Anton Google Font linked in `fps/index.html` for match-end overlay (UI-SPEC D-05)
- `useGameSocket` extended with `lastFpsState: MsgFpsState | null` and `lastFpsHit: MsgFpsHit | null`
- Message handling in `default` branch of switch (since `InboundServerMsg` union doesn't include FPS messages)
- T-14-01-01 mitigation: hp array guard before setting lastFpsState

**Task 2 — Coordinate + Geometry Utilities:**
- `keypointToWorld(kp, scale)`: flips X, Y, Z from MediaPipe world-space to Three.js; Y flip marked [ASSUMED A2]
- `WORLD_SCALE = 2.5`: starting scale constant for arm keypoints
- `buildArmSegment(rTop, rBot, mat)`: creates `CylinderGeometry(length=1.0)` — no per-frame geometry rebuild
- `updateArmSegment(mesh, from, to)`: midpoint + scale.y + lookAt + rotateX(PI/2); T-14-01-03 NaN guard

**Task 3 — Renderer Hook + Component + Wiring:**
- `useGameRenderer`: single WebGLRenderer, worldScene + armsScene, PerspectiveCamera for each
- MeshToonMaterial: 2-band DataTexture gradient, NearestFilter for sharp toon band; P1=orange, P2=blue
- OutlineEffect wraps arms pass only (Pitfall 6 avoided)
- Dual-scene render: `clear()` → `render(worldScene)` → `clearDepth()` → `outlineEffect.render(armsScene)`
- `autoClear = false` (Pitfall 3 avoided), stale closure avoided via latestKeypointsRef/latestSocketRef (Pitfall 1 avoided)
- T-14-01-02: dt capped at 50ms; T-14-01-04: cleanup disposes renderer on unmount
- `GameRenderer.tsx`: thin wrapper, delegates to `useGameRenderer` (CalibrationScreen pattern)
- `App.tsx` showMatch branch: `<GameRenderer smoothedKeypoints socket playerSlot />` replaces placeholder div

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fps_state/fps_hit not in InboundServerMsg union**
- **Found during:** Task 1
- **Issue:** The `handleMessage` switch is typed over `InboundServerMsg` which doesn't include `fps_state` or `fps_hit`. Adding cases directly caused TS2678.
- **Fix:** Handle in `default` branch with runtime type narrowing (`raw.type === 'fps_state'`)
- **Files modified:** `fps/src/hooks/useGameSocket.ts`
- **Commit:** 3a659b6

**2. [Rule 1 - Bug] App.test.tsx mock missing new socket fields + stale game-canvas-root assertion**
- **Found during:** Task 3
- **Issue:** Adding `lastFpsState`/`lastFpsHit` to `UseGameSocketResult` broke the App.test.tsx mock. Replacing `<div id="game-canvas-root">` with `<GameRenderer>` broke the test assertion.
- **Fix:** Added fields to mock object; added `GameRenderer` component mock; updated test assertion to use `data-testid="game-renderer"`
- **Files modified:** `fps/src/App.test.tsx`
- **Commits:** 3a659b6, abb4eb9

**3. [Rule 2 - Missing Critical] Pre-existing useCalibration.test.ts TypeScript errors**
- **Found during:** Task 1 verification
- **Issue:** `useCalibration.test.ts` has pre-existing TS2345 errors that cause `tsc -b` to fail, but `npx vite build` succeeds (Vite ignores test files). These errors existed before this plan.
- **Decision:** Out of scope per deviation rules SCOPE BOUNDARY. Documented in deferred items.

## Known Stubs

- `anchorOffset = new THREE.Vector3(0, -0.25*WORLD_SCALE, -0.4*WORLD_SCALE)` — shoulder anchor [ASSUMED A4], tune against live webcam
- Y flip in `keypointToWorld` (`-kp.y`) — [ASSUMED A2], verify against live webcam in Plan 14-01b Task 1 spike

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-14-01-01 | hp array guard before `setLastFpsState` in handleMessage default branch |
| T-14-01-02 | dt capped at 50ms (`Math.min(dt, 0.05)`) in animation loop |
| T-14-01-03 | `isFinite` guard in `updateArmSegment` — returns early on NaN/Infinity |
| T-14-01-04 | Cleanup in useEffect return: `setAnimationLoop(null)`, `dispose()`, `removeChild()` |

## Self-Check: PASSED

Files created:
- fps/src/lib/coordinateMap.ts: FOUND
- fps/src/lib/armGeometry.ts: FOUND
- fps/src/hooks/useGameRenderer.ts: FOUND
- fps/src/components/GameRenderer.tsx: FOUND

Commits:
- 3a659b6: FOUND (Task 1)
- 058f2a2: FOUND (Task 2)
- abb4eb9: FOUND (Task 3)

Build: `npx vite build` exits 0, 36 modules transformed.
Tests: `npx vitest run src/App.test.tsx` — 6/6 pass.
