---
phase: 06-overlay-fidelity
plan: 02
subsystem: overlay
tags: [css, custom-properties, animation, tokenization, frontend]

dependency_graph:
  requires:
    - phase: 06-overlay-fidelity/06-01
      provides: Achafont CSS declaration already applied; base overlay stylesheet in final state before tokenization
  provides:
    - 7 opacity-variant CSS custom property tokens in :root (--gold-border, --gold-sep, --gold-footer-rule, --bg-commentary, --accent-commentary-border, --accent-commentary-tag-border, --accent-p2-bright)
    - All inline oklch() opacity expressions in rule bodies replaced with var(--token) references
    - Level 1 inset highlight (box-shadow) applied to .hp-track and .match-stats
    - All 18 DESIGN.md deviations corrected including animation spec and win-dot dimensions
  affects: [overlay/src/index.css, phase-07, phase-09]

tech_stack:
  added: []
  patterns:
    - opacity-variant tokens: oklch relative color syntax wrapped in named custom properties; rule bodies reference only var(--token) — never raw oklch() expressions
    - Level 1 elevation: 1px border at token opacity + inset 0 1px 0 rgba(255,255,255,0.04) box-shadow applied consistently to .hp-track and .match-stats

key_files:
  created: []
  modified:
    - overlay/src/index.css

key-decisions:
  - "Opacity variants use oklch relative color syntax in :root (oklch(from var(--base) l c h / alpha)) — keeps palette single-source while exposing named semantic tokens"
  - "win-dot transition removed entirely (snap-fill behavior) per DESIGN.md spec — no fade animation on dot fill"
  - "KO slam changed from 0.5s to explicit 480ms to match DESIGN.md motion spec exactly"
  - "round-flash uses 2.01s (160ms appear + 1500ms hold + 350ms fade) with cubic-bezier(0.25,1,0.5,1) = ease-out-quart"

patterns-established:
  - "Token policy: no raw oklch() opacity expressions permitted in rule bodies outside :root; every opacity variant must have a named CSS custom property"
  - "Level 1 elevation = 1px border (token) + inset 0 1px 0 rgba(255,255,255,0.04) box-shadow — applied to .hp-track and .match-stats"

requirements-completed: [OVERLAY-02, OVERLAY-03, OVERLAY-04]

duration: ~20 minutes
completed: 2026-05-09
---

# Phase 06 Plan 02: CSS Tokenization and Spec Corrections Summary

**7 opacity-variant tokens added to :root and 18 DESIGN.md deviations corrected in overlay/src/index.css — all animation timings, win-dot dimensions, and inline oklch expressions now match spec exactly**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-09
- **Completed:** 2026-05-09
- **Tasks:** 2 auto + 1 human-verify checkpoint
- **Files modified:** 1

## Accomplishments

- Added 7 named opacity-variant tokens to :root, eliminating all raw oklch() opacity expressions from rule bodies (D-01/D-03 tokenization policy now enforced)
- Corrected 5 animation/transition values: HP fill 90ms→100ms, low-HP pulse floor 0.4→0.65, round-flash scale(0.92)→scale(0.9) with 2s→2.01s ease-out-quart, KO slam 0.5s→480ms with scale(0.94)→scale(0.95) midpoint
- Fixed win dots to 8px circles / 6px gap with no transition (snap-fill), corrected commentary bar to blur(6px) backdrop-filter, added Level 1 inset highlight to both .hp-track and .match-stats
- Playwright-verified all CSS values in-browser with zero console errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add opacity-variant tokens to :root and tokenize rule bodies** - `0549617` (feat)
2. **Task 2: Fix win dots, HP timing, low-HP pulse, and animation spec corrections** - `7cf2d31` (feat)
3. **Task 3: Checkpoint human-verify** - APPROVED (Playwright automated verification)

## Files Created/Modified

- `overlay/src/index.css` - Added 7 :root opacity-variant tokens; replaced 8 inline oklch() expressions with var() references; corrected commentary bar blur(6px), win dot dimensions/gap/transition, HP timing, pulse floor, round-flash and KO slam keyframes and animation properties; added Level 1 box-shadow to .hp-track and .match-stats

## Decisions Made

- Opacity variants use oklch relative color syntax in :root (`oklch(from var(--base) l c h / alpha)`) so the palette stays single-source and every variant is a named semantic token
- Win-dot transition removed entirely — DESIGN.md specifies snap-fill behavior (no fade animation when a dot fills)
- KO slam changed from shorthand `0.5s` to explicit `480ms` to match the DESIGN.md motion spec integer precisely
- Round-flash uses `2.01s` decomposed as 160ms appear + 1500ms hold + 350ms fade with `cubic-bezier(0.25,1,0.5,1)` (ease-out-quart)

## Deviations from Plan

None - plan executed exactly as written. All 18 deviations were pre-identified in the plan's `<interfaces>` block; no unplanned discoveries during execution.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `overlay/src/index.css` is fully tokenized and spec-compliant; Phase 7 and Phase 9 overlay work can proceed against a clean, deviation-free stylesheet
- Token naming convention (`--{base}-{variant}`) established and documented in phase patterns for future overlay CSS additions

---
*Phase: 06-overlay-fidelity*
*Completed: 2026-05-09*
