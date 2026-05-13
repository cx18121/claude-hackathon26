---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: First-Person Boxing
status: planning
stopped_at: ~
last_updated: "2026-05-12T00:00:00.000Z"
last_activity: 2026-05-12
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.
**Current focus:** Phase 10 ready to plan — FPSBoxingPlugin Rust crate

## Current Position

Phase: 10 of 14 (FPSBoxingPlugin)
Plan: —
Status: Ready to plan
Last activity: 2026-05-12 — v2.0 roadmap created; 5 phases defined, 24 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 28 (v1.0)
- Average duration: —
- Total execution time: 0 hours (v2.0)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v1.0 phases 1-9 | 28 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v2.0 init: FPS mode is laptop-only; no phone input, no spectator overlay
- v2.0 init: New fps-boxing-plugin crate uses GamePlugin trait — zero engine-core changes
- v2.0 init: fps/ Vite app mirrors mobile/ structure; raw Three.js (not R3F) to match overlay precedent
- v2.0 init: MediaPipe runs in a Web Worker (same pattern as mobile/src/workers/pose.worker.ts)
- v2.0 init: Opponent payload limited to 6 arm landmarks only (not 33) — resolve in Phase 10 protocol design
- v2.0 init: MsgFpsState / MsgFpsHit are additive wire messages; existing clients byte-for-byte unaffected

### Pending Todos

None.

### Blockers/Concerns

- **Phase 13 — MediaPipe GPU delegate on integrated GPUs**: GPU delegation improves inference from 40-80 ms to 8-15 ms, but silent CPU fallback with no error. Add per-frame timing assertions in Phase 13 to detect fallback.
- **Phase 13 — OneEuroFilter tuning**: Starting values (min_cutoff=1.0, beta=0.007) may need tuning per webcam resolution during implementation.
- **Phase 10 — PlayerSlot indexing**: Confirm SendToPlayer { slot: 0 } = Player 1 engine convention vs 1-indexed protocol.ts with a targeted Rust test before Phase 14 opponent rendering.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3 | Commentary (COMM-01..04) | Deferred | v1.0 init |
| v3 | AI game generation (AI-01) | Deferred | v1.0 init |
| v3 | Asymmetric matchmaking (phone P1 vs laptop P2) | Deferred | v2.0 init |
| v3 | Spectator overlay for FPS mode | Deferred | v2.0 init |

## Session Continuity

Last session: Phase 9 verification (v1.0) + v2.0 roadmap creation
Stopped at: v2.0 roadmap written — Phase 10 ready to plan
Resume file: —
