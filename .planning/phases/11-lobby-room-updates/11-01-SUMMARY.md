---
phase: 11-lobby-room-updates
plan: 01
subsystem: ui
tags: [rust, axum, html, lobby, game-picker, fps-boxing]

# Dependency graph
requires:
  - phase: 10-fps-boxing-plugin
    provides: FPSBoxingPlugin registered in engine-core main.rs
provides:
  - FPS BOXING tile in LOBBY_HTML with correct CSS, button, and selectGame() reset
  - get_lobby_contains_fps_boxing_button test

affects:
  - 11-02-SUMMARY (depends on tile being present for room page to be reachable)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Game tile pattern: CSS class .selected-{game}, button id=tile-{game}, selectGame('{game}') handler"
    - "Three-tile flex layout auto-extends by adding button — no CSS grid change required"

key-files:
  created: []
  modified:
    - engine/engine-core/src/main.rs

key-decisions:
  - "fps_boxing selection CSS reuses --accent (warm red) since fps_boxing is a boxing variant"
  - "selectGame() resets ALL three tile class names to prevent stale selection state"
  - "TDD: wrote failing test first (RED), then made three surgical edits to LOBBY_HTML (GREEN)"

patterns-established:
  - "New game tiles: add CSS class, HTML button, and getElementById reset in selectGame() — three-place change"

requirements-completed: [LBY-01]

# Metrics
duration: 10min
completed: 2026-05-13
---

# Phase 11 Plan 01: FPS BOXING Lobby Tile Summary

**FPS BOXING tile added to LOBBY_HTML with .selected-fps_boxing CSS, tile-fps_boxing button, and three-way selectGame() reset**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-13T00:00:00Z
- **Completed:** 2026-05-13T00:00:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added `.selected-fps_boxing` CSS class (reuses `--accent` warm red, boxing variant)
- Added `<button id="tile-fps_boxing" onclick="selectGame('fps_boxing')">FPS BOXING</button>` to .game-picker
- Updated `selectGame()` to reset all three tile class names, preventing stale selection state
- Added `get_lobby_contains_fps_boxing_button` test verifying tile ID and selectGame call

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing test** - `4719a35` (test)
2. **Task 1 GREEN: LOBBY_HTML edits** - `19bca73` (feat)

_Note: Task 2 test was written as part of Task 1 TDD RED phase — test commit is 4719a35_

## Files Created/Modified
- `engine/engine-core/src/main.rs` - Added CSS class, button tile, selectGame() reset, and test

## Decisions Made
- Used `--accent` (warm red) for fps_boxing selection color — boxing variant shares boxing's accent color
- Three-tile flex layout auto-expands with flex:1 on each button — no CSS grid change required

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Lobby tile complete; fps_boxing rooms are now discoverable and selectable
- Plan 02 (room page branching) builds on this tile's presence
- All 92 engine-core unit tests pass with zero regressions

---
*Phase: 11-lobby-room-updates*
*Completed: 2026-05-13*
