---
phase: 09-dance-frontend
plan: "03"
subsystem: ui
tags: [pixi, canvas, animation, skeleton, dance, websocket]

# Dependency graph
requires:
  - phase: 09-01
    provides: danceBeatRef plumbing in App.tsx and useSpectatorSocket dance state
provides:
  - Ghost skeleton rendering in PixiCanvas with fade animation driven by dance_beat events
  - drawTargetPoseSkeleton helper function using CONNECTIONS bone pairs and flip=-1 projection
  - skeletonGfx Graphics object lifecycle (create, animate, destroy) inside Pixi ticker
affects:
  - 09-04 (RoundOverlay dance mode, which uses same PixiCanvas)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pixi ticker fade animation: phase state machine (idle/fade-out/fade-in) + performance.now() interpolation — no gsap"
    - "skeletonFadeRef: MutableRef mutation for hot-path animation state; never setState inside ticker"
    - "Visibility gate pattern: skip keypoint/bone if visibility < 0.5 (from targetPose[n][3])"

key-files:
  created: []
  modified:
    - overlay/src/components/PixiCanvas.tsx

key-decisions:
  - "flip=-1 applied to all target pose X coordinates — same as live player silhouettes so ghost matches mirror orientation"
  - "skeletonGfx added to skeletonContainer (not a new container) so ghost renders at same z-level depth as player layers"
  - "fade-out uses ease-out-quart (1-t^4) for natural deceleration; fade-in is linear for snappier appearance"
  - "New beat only triggers fade cycle when phase === idle — prevents queuing multiple fades on rapid beat events"

patterns-established:
  - "Phase state machine for Pixi fade: idle → fade-out (150ms) → redraw → fade-in (150ms) → idle"
  - "Alpha set on Graphics object directly (skeletonGfx.alpha), not via stroke/fill alpha parameter"

requirements-completed: [DIMPL-03]

# Metrics
duration: 12min
completed: 2026-05-10
---

# Phase 9 Plan 03: Dance Target Pose Ghost Skeleton Summary

**Pixi ticker ghost skeleton rendering for dance_beat target_pose with 150ms ease-out fade cycle using CONNECTIONS bone pairs and flip=-1 mirror projection**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-10T00:00:00Z
- **Completed:** 2026-05-10T00:12:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `danceBeatRef` prop to `PixiCanvas` enabling dance beat data to flow from App.tsx into the Pixi ticker
- Implemented `drawTargetPoseSkeleton` helper that renders 35 bone pairs + keypoints from `target_pose` using same flip=-1 coordinate math as live player silhouettes
- Implemented fade-out (150ms ease-out-quart) → redraw → fade-in (150ms linear) animation state machine running entirely in the Pixi ticker, no gsap
- Added proper cleanup: `skeletonGfx.destroy()` and `skeletonFadeRef` reset in useEffect cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Add danceBeatRef prop, skeletonGfx, drawTargetPoseSkeleton, and ticker fade logic** - `9422ea5` (feat)

## Files Created/Modified

- `overlay/src/components/PixiCanvas.tsx` - Added CONNECTIONS import, danceBeatRef prop, SKELETON_COLOR/SKELETON_ALPHA constants, drawTargetPoseSkeleton function, skeletonFadeRef, skeletonGfx lifecycle, and ticker fade logic

## Decisions Made

- Used `width / 2` as centerX for the ghost skeleton (canvas center) rather than a player-side offset — the target pose is a single shared pose shown at center screen
- Reused `w` and `h` variables already declared in the ticker handler for canvas dimensions
- Placed `skeletonGfx` after `playerLayersRef.current` setup so ghost renders on top of both player containers within `skeletonContainer`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled cleanly on first attempt.

## Known Stubs

None - the ghost skeleton reads from `danceBeatRef.current` which is wired from `danceBeat` state in App.tsx (implemented in plan 09-01). No hardcoded empty values flow to rendering.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced. The `targetPose` data path (server → danceBeatRef → ticker → draw calls) was in scope per the plan's threat model and mitigated via:
- Visibility gate: `visibility < 0.5` skips invalid keypoints
- Bounds guard: `!kpA || !kpB` before bone draw prevents crashes on malformed arrays
- DoS mitigation: fade-only-when-idle prevents animation queue exhaustion on rapid beats

## Self-Check

- [x] `overlay/src/components/PixiCanvas.tsx` exists and modified
- [x] Commit `9422ea5` exists in git log
- [x] `drawTargetPoseSkeleton` present in PixiCanvas.tsx
- [x] `CONNECTIONS` imported from `../lib/skeleton`
- [x] `* scale * -1` flip present in drawTargetPoseSkeleton
- [x] `skeletonGfx.alpha = 0` on init
- [x] `skeletonGfx.destroy()` in cleanup
- [x] No gsap import in PixiCanvas.tsx
- [x] TypeScript compiles without errors (excluding expected RoundOverlay 09-04 errors)

## Self-Check: PASSED

## Next Phase Readiness

- Plan 09-03 complete: ghost skeleton rendering is ready for use by spectators when dance_beat events arrive
- Plan 09-04 (RoundOverlay dance mode) can proceed independently — it does not depend on PixiCanvas changes
- App.tsx needs `danceBeatRef` passed to `<PixiCanvas>` (implemented in 09-01); confirm 09-01 agent has wired this prop

---
*Phase: 09-dance-frontend*
*Completed: 2026-05-10*
