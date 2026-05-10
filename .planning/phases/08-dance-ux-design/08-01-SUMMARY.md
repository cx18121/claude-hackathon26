---
phase: 08-dance-ux-design
plan: "01"
subsystem: design-docs
tags:
  - design-spec
  - dance-game
  - documentation
dependency_graph:
  requires: []
  provides:
    - "DESIGN.md Dance Game section (all five sub-sections)"
    - "PRODUCT.md Game Modes section (two-mode tone definition)"
  affects:
    - "Phase 9 DanceHud implementation"
    - "Phase 9 target pose skeleton rendering"
    - "Phase 9 dance round end and match end screens"
tech_stack:
  added: []
  patterns:
    - "OKLCH token system extended to dance context"
    - "Existing .hud-band shell reused for DanceHud"
    - "Existing .round-flash reused for dance round end"
key_files:
  created: []
  modified:
    - DESIGN.md
    - PRODUCT.md
decisions:
  - "D-01: Scores shown as numeric only — Inter 900 36px, one decimal precision"
  - "D-02: Score occupies bottom row of HUD band; beat indicator in top row centre column"
  - "D-03: Performance register — score grows from zero, no penalty for missed beat"
  - "D-04: Draining bar with N / total_beats label in centre column"
  - "D-05: Bar fill --text-secondary, track --bg-surface, neutral to avoid competing with skeleton"
  - "D-06: Ghost skeleton at canvas centre, human scale, in gap between player silhouettes"
  - "D-07: --text-dim keypoints and bone lines at 40% opacity"
  - "D-08: 150ms fade-out + 150ms fade-in on beat swap (300ms total)"
  - "D-09: ROUND N -- P1 LEADS / ROUND N -- TIED copy format"
  - "D-10: No KO, no TIME — boxing vocabulary prohibited in dance copy"
  - "D-11: Two large scores side by side; winner highlighted in accent color"
  - "D-12: Large numbers dominate match end; winner accent color is primary signal"
metrics:
  duration: "15 minutes"
  completed_date: "2026-05-10"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 2
---

# Phase 8 Plan 01: Dance UX Design — Documentation Summary

Wrote the complete design specification for the dance game experience. DESIGN.md gains a full Dance Game section with five sub-sections; PRODUCT.md gains a Game Modes section defining the two emotional registers. Phase 9 can implement DanceHud, target pose skeleton, round end, and match end screens without returning to design.

## What Was Built

### DESIGN.md — Dance Game Section (107 lines added)

Five sub-sections covering every visual element needed for Phase 9 implementation:

**### Dance HUD** — Two-row .hud-band adaptation. Row 1: P1 label | beat indicator (40% width) | P2 label. Row 2: P1 score | vs | P2 score. Scores: Inter 900 36px (reuses --type-hud-timer token), one decimal precision, no bar or color coding.

**### Beat Indicator** — Draining bar in centre column. Beat count label "N / total_beats" (Inter 700 12px --text-secondary). Bar: 4px height, --text-secondary fill, --bg-surface track, linear drain over one beat duration, hard-snap reset on dance_beat event.

**### Target Pose Skeleton** — Ghost silhouette in Pixi.js PixiCanvas. Canvas centre, human scale, 40% opacity, --text-dim keypoints and bone lines. Visibility threshold: keypoints with visibility >= 0.5 only. Beat-swap transition: 150ms fade-out then 150ms fade-in (300ms total), whole Graphics object alpha.

**### Dance Round End** — Reuses .round-flash with scoreboard copy. "ROUND N -- P1 LEADS" / "ROUND N -- TIED". Cumulative scores below in --text-secondary Inter 700 18px. Prohibited: HP bar, win dots, KO, TIME, damage vocabulary.

**### Dance Match End** — Large score layout. "WINNER" label in winner's accent color. Winner score: clamp(48px, 8vw, 96px) in --accent/--accent-p2. Loser score: same size in --text-secondary. Tie shows "TIED" with no accent. Prohibited: K.O., HP bars, damage stats, rounds won count.

### PRODUCT.md — Game Modes Section (27 lines added)

Defines boxing (combat register) and dance (performance register) as distinct modes sharing the same aesthetic. Includes shared aesthetic rules (OKLCH system, Achafont for drama, no neon/glassmorphism) and dance-specific anti-references (show aesthetics, rhythm game chrome, fitness app UI).

## Key Design Tokens Specified

| Token | Used For |
|-------|---------|
| `--text-dim` | Target pose skeleton keypoints and bone lines |
| `--text-secondary` | Beat bar fill, beat count label, "vs" separator, loser's match end score |
| `--bg-surface` | Beat bar track background |
| `--accent` | P1 winner highlight (match end, WINNER label) |
| `--accent-p2` | P2 winner highlight (match end, WINNER label) |

## Key Copy Strings Specified

- Beat count label: `"N / total_beats"` (e.g. "4 / 16")
- Round end winner: `"ROUND N -- P1 LEADS"` / `"ROUND N -- P2 LEADS"`
- Round end tie: `"ROUND N -- TIED"`
- Match end winner label: `"WINNER"`
- Match end tie: `"TIED"`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 5cb6ee6 | Append Dance HUD and Beat Indicator sections to DESIGN.md |
| Task 2 | 9a3b7e4 | Append Target Pose Skeleton, Dance Round End, and Dance Match End to DESIGN.md |
| Task 3 | 9b51720 | Update PRODUCT.md with two-mode game tone definition |

## Deviations from Plan

None — plan executed exactly as written.

The only minor adjustment: the plan's inline reference "see ### Beat Indicator below" in the Dance HUD section would have caused `grep -c "### Beat Indicator"` to return 2 instead of the expected 1. The reference was reworded to "see Beat Indicator section below" to satisfy the acceptance criteria count while preserving the informational content.

## Self-Check: PASSED

- DESIGN.md exists: FOUND
- PRODUCT.md exists: FOUND
- SUMMARY.md exists: FOUND
- Commit 5cb6ee6 exists: FOUND
- Commit 9a3b7e4 exists: FOUND
- Commit 9b51720 exists: FOUND
