---
phase: 04-lobby-ux
plan: "03"
subsystem: ui

tags: [rust, axum, html, css, oklch, inter, lobby, game-picker]

requires:
  - phase: 04-01
    provides: DESIGN.md Lobby section with OKLCH tokens, component specs, and section layout
  - phase: 04-02
    provides: GET /rooms/{code} route that the createRoom() JS navigates to on success

provides:
  - LOBBY_HTML const rewritten with full SPECTRE landing page
  - SPECTRE heading + "real punches. real fights." tagline
  - BOXING/DANCE game picker tiles with selectGame() JS selection state
  - Create Room button (disabled until selection) that POSTs to /rooms?game= and navigates to /rooms/{code}
  - Separator with "or" label
  - Join a Room section: uppercasing code input + joinRoom() that navigates to /mobile?room=&server=

affects: [04-lobby-ux, 05-mobile-fast-join]

tech-stack:
  added: []
  patterns:
    - "LOBBY_HTML as &str const in main.rs — single-file HTML/CSS/JS served from Rust without build step"
    - "selectGame()/createRoom()/joinRoom() pure-JS state machine for game picker + create/join flows"
    - "D-10: window.location.origin auto-injects server URL into join redirect (no server-side baking required)"

key-files:
  created: []
  modified:
    - engine/engine-core/src/main.rs

key-decisions:
  - "selectGame() sets selectedGame var and updates tile CSS classes; createRoom() reads selectedGame — clean separation between selection and creation"
  - "joinRoom() uses window.location.origin per D-10; encodeURIComponent() applied per T-04-03-03 threat mitigation"
  - "Test get_lobby_contains_boxing_and_dance_buttons updated to assert selectGame('boxing')/selectGame('dance') and SPECTRE heading"

patterns-established:
  - "Game picker tile CSS uses .selected-boxing/.selected-dance classes toggled by JS — no inline styles"
  - "Disabled button state via opacity + pointer-events:none (not HTML disabled attribute) — enables JS re-enable without disabled attr manipulation"

requirements-completed: [LOBBY-01, LOBBY-02, LOBBY-03, LOBBY-04, LOBBY-08]

duration: 1min
completed: 2026-05-06
---

# Phase 4 Plan 03: Landing Page Rewrite Summary

**SPECTRE lobby landing page: game picker tiles with selectGame() state, disabled-until-selection Create Room button navigating to /rooms/{code}, and Join by code flow via /mobile?room=&server= — Inter font, OKLCH tokens, no neon/glassmorphism**

## Performance

- **Duration:** 1min
- **Started:** 2026-05-06T03:02:45Z
- **Completed:** 2026-05-06T03:04:36Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Replaced placeholder "Choose a Game" lobby with full SPECTRE landing page matching DESIGN.md Lobby spec and 04-UI-SPEC.md copywriting contract
- Rewrote LOBBY_HTML const with: SPECTRE heading + tagline, BOXING/DANCE game picker tiles, Create Room flow (POST /rooms → navigate /rooms/{code}), separator, Join a Room section (→ /mobile?room=&server=)
- Updated `get_lobby_contains_boxing_and_dance_buttons` test to assert selectGame('boxing')/selectGame('dance')/SPECTRE; all 102 cargo tests pass

## Task Commits

1. **Task 1: Rewrite LOBBY_HTML with SPECTRE landing page** - `71a23f7` (feat)

## Files Created/Modified

- `engine/engine-core/src/main.rs` - LOBBY_HTML const fully rewritten; test updated for new JS function names

## Decisions Made

- Used `selectGame()` onclick handlers on tiles and a separate `createRoom()` on the button — this matches the plan's interaction contract (D-03: clicking already-selected tile is no-op; Create Room enabled after selection)
- `pointer-events: none` + `opacity: 0.5` for disabled state on both Create Room and Join Room buttons (not HTML `disabled` attribute) — allows CSS-class toggling for enable/disable without attribute manipulation overhead

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Landing page is production-ready: SPECTRE branding, game picker, create + join flows all implemented
- `GET /` now returns the SPECTRE landing page; `POST /rooms` + `GET /rooms/{code}` already exist from prior plans
- Phase 5 (mobile fast-join) can target the `/mobile?room=&server=` redirect from joinRoom() — the URL shape is established

---

*Phase: 04-lobby-ux*
*Completed: 2026-05-06*
