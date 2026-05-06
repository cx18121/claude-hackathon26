---
phase: 04-lobby-ux
plan: "01"
subsystem: ui
tags: [design-system, lobby, game-picker, qr-cards, css-tokens, oklch]

# Dependency graph
requires:
  - phase: 03-dance-sdk
    provides: existing DESIGN.md with color tokens, type scale, spacing, button spec, elevation levels
provides:
  - DESIGN.md Lobby section: landing page layout, game picker tile spec, Create Room button spec, Join by code section spec
  - DESIGN.md Lobby section: room page layout, QR card grid spec, per-card color treatment
  - DESIGN.md Lobby section: QR card contents spec, error states, responsive behavior
affects:
  - 04-02 (room page HTML/CSS implements against QR card grid and card contents spec)
  - 04-03 (landing page HTML/CSS implements against game picker, Create Room, Join by code specs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DESIGN.md-first: visual spec written before any implementation; plans 04-02 and 04-03 implement against this section"
    - "color-mix(in oklch): used for tinted backgrounds instead of rgba, consistent with oklch palette strategy"

key-files:
  created: []
  modified:
    - DESIGN.md

key-decisions:
  - "Appended ## Lobby at end of DESIGN.md without modifying any existing section; all existing tokens reused verbatim"
  - "Used color-mix(in oklch, ...) syntax for tinted backgrounds (tiles, buttons, error states) per OKLCH palette strategy"
  - "Overlay card border expressed as color-mix(in oklch, var(--gold) 60%, transparent) consistent with gold-for-structural-borders rule"

patterns-established:
  - "Lobby section structure: landing page specs, room page specs, QR grid, QR contents, error states, responsive — all in one canonical section"
  - "Per-card color treatment: P1=--accent, P2=--accent-p2, Overlay=--gold 60% — mirrors HUD elevation border convention"

requirements-completed:
  - LOBBY-08

# Metrics
duration: 2min
completed: 2026-05-06
---

# Phase 4 Plan 01: Lobby Design Spec Summary

**Complete DESIGN.md Lobby section covering game picker tiles, landing/room page layouts, 3-col QR card grid with per-card color treatment, and all typography/spacing assignments using only existing OKLCH tokens**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-06T02:53:09Z
- **Completed:** 2026-05-06T02:54:14Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Appended `## Lobby` section to DESIGN.md with 96 new lines covering all lobby-facing components
- Captured every component from 04-UI-SPEC.md verbatim: game picker tiles (5 states), Create Room button (4 states), Join by code section, room page header, QR card grid, QR card contents, error states, responsive behavior
- Per-card color treatment (D-15) fully specified: P1 crimson `--accent`, P2 steel `--accent-p2`, Overlay `--gold` 60% — no new tokens invented

## Task Commits

Each task was committed atomically:

1. **Task 1: Append Lobby section to DESIGN.md** - `243c7d8` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `DESIGN.md` - Appended `## Lobby` section (96 lines): landing page, room page, QR card grid, QR card contents, error states, responsive behavior

## Decisions Made
- No new decisions — spec transcribed verbatim from 04-UI-SPEC.md (checker-approved) per plan instructions
- `color-mix(in oklch, ...)` used consistently for tinted backgrounds (tiles, button states, error rows, card borders) to stay within OKLCH palette strategy

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None. This plan writes documentation only; no implementation stubs introduced.

## Threat Flags
None. Documentation-only write; no executable code; no new attack surface per threat register T-04-01-01.

## Next Phase Readiness
- DESIGN.md Lobby section is the authoritative spec for 04-02 and 04-03
- 04-02 (room page Rust route + QR generation) can read `### Room Page`, `### QR Card Grid`, `### QR Card Contents`
- 04-03 (landing page rewrite) can read `### Landing Page` for all component states and typography
- No blockers for downstream plans

## Self-Check

Checking created/modified files and commits:

- `DESIGN.md` contains `## Lobby`: verified (grep returned 1)
- `grep "Game picker"`: 3 matches
- `grep "QR Card"`: 2 matches
- `grep "Room Page\|Room page"`: 2 matches
- `grep "--accent-p2"`: 7 matches (≥2 required)
- `grep "--gold"`: 6 matches (≥4 required)
- `grep "160px"`: 2 matches
- `grep "min-height 80px"`: 1 match
- All existing sections (Color, Typography, Elevation, Motion, Components, Spacing) still present
- Commit `243c7d8` exists: feat(04-01): append Lobby section to DESIGN.md

## Self-Check: PASSED

---
*Phase: 04-lobby-ux*
*Completed: 2026-05-06*
