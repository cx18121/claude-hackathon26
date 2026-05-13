---
phase: 11-lobby-room-updates
plan: 02
subsystem: ui
tags: [rust, axum, html, room-page, fps-boxing, qr-codes]

# Dependency graph
requires:
  - phase: 11-lobby-room-updates
    plan: 01
    provides: FPS BOXING tile in lobby (LBY-01)
provides:
  - room_page_html() branches on fps_boxing: /fps URLs, no QR codes, no overlay card
  - Three new tests: room_page_html_fps_boxing_uses_fps_urls, room_page_html_fps_boxing_hides_overlay, room_page_html_boxing_unchanged

affects:
  - Phase 12 (fps/ Vite app stub that /fps route will serve)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional HTML fragment pattern: build String variables (p1_qr_div, p2_qr_div, overlay_card) before format!, splice into template"
    - "is_fps branch: conditional URL construction, conditional QR generation, conditional fragment rendering"

key-files:
  created: []
  modified:
    - engine/engine-core/src/main.rs

key-decisions:
  - "fps_boxing room page uses /fps?server= URLs (laptop-native), not /mobile (phone QR)"
  - "Skip generate_qr_svg() for fps_boxing — laptop users click links, not scan QR codes"
  - "Omit overlay QR card entirely for fps_boxing — no spectator overlay in FPS mode"
  - "Build HTML fragments as String variables before format! to handle conditional rendering cleanly"
  - "overlay_url_esc removed from format! named args — consumed into overlay_card fragment"

patterns-established:
  - "Conditional room page content: is_{variant} flag + fragment String variables + splice into format! template"

requirements-completed: [LBY-02]

# Metrics
duration: 10min
completed: 2026-05-13
---

# Phase 11 Plan 02: fps_boxing Room Page Summary

**room_page_html() branches on fps_boxing to show /fps laptop join links with no QR codes and no overlay card**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-13T00:00:00Z
- **Completed:** 2026-05-13T00:00:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added `is_fps` flag with conditional URL construction (`/fps?server=` vs `/mobile`)
- Skipped `generate_qr_svg()` for fps_boxing P1/P2/overlay (laptop users click links)
- Built `p1_qr_div`, `p2_qr_div`, `overlay_card` as conditional String fragments before format!
- Omitted overlay QR card entirely for fps_boxing rooms
- All XSS escaping tests (room_page_url_html_escaping, room_page_code_and_game_type_html_escaping) pass unchanged
- Three new tests confirm fps_boxing behavior and boxing/dance regression safety

## Task Commits

Each task was committed atomically:

1. **Task 3 RED: Failing tests for fps_boxing room page** - `5fdc7c4` (test)
2. **Task 3 GREEN: Refactored room_page_html()** - `bdfb4b2` (feat)

_Note: Task 4 tests were written as part of Task 3 TDD RED phase — test commit is 5fdc7c4_

## Files Created/Modified
- `engine/engine-core/src/main.rs` - Refactored room_page_html() with fps_boxing branching and three new tests

## Decisions Made
- Conditional HTML fragment approach (build String vars before format!) preferred over multiple format! calls for readability
- `overlay_url_esc` removed from format! named args since it is only needed inside the overlay_card fragment

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- fps_boxing rooms now display laptop-friendly join links at /rooms/{code}
- Phase 12 needs to implement the /fps Axum route and serve the Vite app (RESEARCH D2 deferred stub)
- All 92 engine-core unit tests pass with zero regressions (159 total including protocol roundtrip tests)

---
*Phase: 11-lobby-room-updates*
*Completed: 2026-05-13*
