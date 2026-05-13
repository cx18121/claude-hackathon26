---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: First-Person Boxing
status: planning
stopped_at: ~
last_updated: "2026-05-12T00:00:00.000Z"
last_activity: 2026-05-12
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-03)

**Core value:** The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.
**Current focus:** Phase 9 complete — milestone v1.0 dance frontend done

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-12 — Milestone v2.0 started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 28
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | - | - |
| 02 | 5 | - | - |
| 03 | 3 | - | - |
| 04 | 3 | - | - |
| 06 | 2 | - | - |
| 07 | 3 | - | - |
| 09 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 06 P02 | 20 | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: Rust full-server rewrite (Axum + Tokio); no Python in server path
- Init: Wire protocol unchanged — TypeScript clients are not modified
- Init: Game plugin as Rust trait (not WASM/scripting); all plugin methods synchronous
- Init: Boxing is first plugin; second game validates that the abstraction generalizes
- Phase 4 scope: game type selected on landing page (before room creation), not on a separate step
- Phase 4 scope: `/rooms/{code}` GET page with QR codes — Rust QR generation via `qrcode` crate
- Phase 5 scope: QR-prefilled params trigger fast-join view; full form available via "Enter manually" escape
- Phase 6 scope: Achafont recoverable from git commit 4de2977; add @font-face + audit DESIGN.md gaps
- Phase 7 scope: `GamePlugin::game_type()` + `MsgJoined.game_type` + dance calibration skip + dance spectator snapshot; can run in parallel with 4–6
- Phase 8 scope: design-first before any dance frontend code; DESIGN.md dance section must fully specify target pose skeleton rendering before Phase 9 touches Pixi.js
- Phase 9 scope: target pose skeleton rendered from `dance_beat.target_pose` keypoints in Pixi.js; game-type routing in overlay; dance match end; mobile calibration skip

### Pending Todos

None.

### Blockers/Concerns

- **Phase 4 — public base URL for QR links**: The room page at `/rooms/{code}` needs the server's public URL to generate correct QR codes (Railway URL in prod, localhost in dev). Python used `request.base_url`. Rust needs either a `PUBLIC_URL` env var (set in Railway) or `Host` header extraction from the Axum `Request`. Decide in 04-01 plan; don't hardcode localhost.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | Commentary (COMM-01..04) | Deferred | Init |
| v2 | AI game generation (AI-01) | Deferred | Init |

## Session Continuity

Last session: Phase 9 verification
Stopped at: Phase 9 verified complete
Resume file: —

**Completed Phase:** 09 (dance-frontend) — 4 plans — verified 2026-05-10
