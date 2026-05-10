---
phase: 09-dance-frontend
plan: 02
subsystem: ui
tags: [react, css, dance-hud, beat-indicator, pixi, overlay]

# Dependency graph
requires:
  - phase: 09-dance-frontend/09-01
    provides: useSpectatorSocket dance state fields (danceScores, danceBeat) and App.tsx routing

provides:
  - DanceHud React component (two-row HUD: beat indicator + score row)
  - CSS classes for dance HUD beat indicator and score row
  - CSS classes for dance match end overlay (dance-match-* classes)
  - CSS class for round flash subscores (round-flash-subscores)

affects: [09-03, 09-04, overlay-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Beat bar reflow trick: void el.offsetWidth between transition:0ms snap and drain transition"
    - "useRef for beat timing (lastBeatTimeRef, beatDurationMsRef) — no useState for high-frequency timing"
    - "Imperatively set CSS transitions in useEffect rather than declaring in CSS"

key-files:
  created:
    - overlay/src/components/DanceHud.tsx
  modified:
    - overlay/src/index.css

key-decisions:
  - "dance-beat-fill has no CSS transition — transition is set imperatively in JS to enable snap-then-drain cycle"
  - "beatDurationMsRef fallback is 500ms until two dance_beat events arrive to compute actual interval"
  - "connected prop accepted but prefixed _connected to satisfy TypeScript (unused in render, reserved for future latency banner)"
  - "Dance match end CSS appended alongside HUD CSS in same plan — both required by RoundOverlay (plan 09-04)"

patterns-established:
  - "Beat bar reflow: barEl.style.transition='width 0ms'; barEl.style.width='100%'; void barEl.offsetWidth; barEl.style.transition=`width ${ms}ms linear`; barEl.style.width='0%'"
  - "DanceHud reuses .hud-layer and .hud-band shell unchanged from HudLayer"
  - "Score display always toFixed(1); zero state 0.0"

requirements-completed: [DIMPL-02]

# Metrics
duration: 15min
completed: 2026-05-10
---

# Phase 09 Plan 02: Dance HUD Summary

**DanceHud component with two-row beat-indicator/score band, using void-reflow CSS animation trick for linear drain between dance_beat events**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-10T00:00:00Z
- **Completed:** 2026-05-10T00:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `DanceHud.tsx` with full beat bar useEffect (snap to 100% → reflow → linear drain)
- Appended all dance CSS classes to `index.css` (HUD + match end + subscores), no new color tokens
- Beat count label shows `N / total_beats` format; no-data state shows `— / —`
- Score format always `toFixed(1)`; zero state shows `0.0`

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DanceHud component** - `c63849c` (feat)
2. **Task 2: Add dance CSS classes to index.css** - `44e0ad4` (feat)

## Files Created/Modified
- `overlay/src/components/DanceHud.tsx` - Dance HUD component: two-row band with beat indicator and P1/P2 score display
- `overlay/src/index.css` - Appended dance-beat-*, dance-score-*, dance-match-*, round-flash-subscores CSS classes

## Decisions Made
- `connected` prop is accepted but aliased to `_connected` — it's in the props contract for future use (latency banner), but the current render doesn't branch on it.
- Dance match end CSS classes (`dance-match-*`) are included in this plan's CSS append because plan 09-04 (RoundOverlay) will consume them; centralizing all dance CSS here avoids split-file concerns.
- `beatDurationMsRef` starts at 500ms fallback — reasonable for a tempo of 120bpm; updates to real interval after first two beats.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

TypeScript verification via the worktree's own tsc was not possible (no node_modules in worktree). Verified using the main repo's tsc binary pointed at the worktree tsconfig, which produced only the expected cross-plan errors (DanceHud import unresolved in main repo before merge, danceBeatRef/gameType/danceScores from parallel wave plans). The DanceHud.tsx file itself is structurally and syntactically correct.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `DanceHud` export is available for `App.tsx` import (plan 09-01 wires this up)
- All dance CSS classes are in `index.css` ready for plan 09-04 (RoundOverlay dance content) to use
- No blockers for 09-03 (PixiCanvas skeleton) or 09-04 (RoundOverlay + CalibrationOverlay)

## Self-Check

- [x] `overlay/src/components/DanceHud.tsx` exists
- [x] `overlay/src/index.css` contains `dance-beat-indicator`
- [x] Commits `c63849c` and `44e0ad4` exist in git log
- [x] No new CSS custom property variables in appended block

## Self-Check: PASSED

---
*Phase: 09-dance-frontend*
*Completed: 2026-05-10*
