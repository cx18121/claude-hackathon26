---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: First-Person Boxing
status: complete
stopped_at: v2.0 milestone closed; post-ship work landed outside GSD phase tracking
last_updated: "2026-08-05T00:00:00Z"
last_activity: 2026-07-20 -- engine RTT ping fix (untracked)
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 21
  completed_plans: 21
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-05)

**Core value:** The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.
**Current focus:** Planning v3.0

## Current Position

Phase: — (between milestones)
Status: v2.0 SHIPPED — planning next milestone. 66 commits of post-ship work
landed between 2026-05-23 and 2026-07-20 without GSD phase tracking; see
"Post-v2.0 Untracked Work" below and the same section in ROADMAP.md.

Repo state as of 2026-08-05: `main` clean, in sync with `origin/main`, latest CI
green (2026-07-21). Last commit 2026-07-20 — idle since.

## Performance Metrics

**Velocity:**

- v1.0: 28 plans, 15 days
- v2.0: 21 plans, 5 days

**By Phase:**

| Phase | Plans | Milestone |
|-------|-------|-----------|
| v1.0 phases 1-9 | 28 | v1.0 |
| v2.0 phases 10-14 | 21 | v2.0 |

## Post-v2.0 Untracked Work

66 commits landed after the v2.0 close commit (`f603e911`) with no phase, plan,
or SUMMARY artifacts. Recorded here so planning state matches the repo.
Contributors: cx18121 (47 commits), akhilc08 (19).

**Batch 1 — monorepo restructure (2026-05-23).** The single-app layout became
per-game verticals at `games/{boxing,dance,fps-boxing}/{client,plugin,server}`.
`engine-core` was split into a lib (`lib.rs`) plus three thin per-game server
binaries (~15-19 LOC each); plugin crates moved to `games/*/plugin/`;
`boxing-core` was extracted as a shared combat harness. Legacy `mobile/`,
`overlay/`, `fps/`, and `engine/*-plugin/` directories were deleted
(`a632fd17`). Byte-identical client components were hoisted to `shared/client/`,
including `useGameSocketBase`.

**Batch 2 — protocol autogen (2026-05-23).** `shared/protocol.ts` and
`shared/bindings/` are now generated from the Rust `protocol.rs` via ts-rs plus
a unions template (`scripts/regen-protocol.sh`). A `protocol-drift` CI job fails
the build if the checked-in output is stale.

**Batch 3 — ML classifier upgrade (2026-05-23).** The temporal MLP became a
dilated TCN (`PunchTCN`) with a feature-embedding output head; added QAT
support, post-hoc temperature scaling fitted on validation NLL and baked into
the ONNX export, per-player prototype adaptation in `usePunchClassifier`
(nearest-centroid over backbone embeddings), labeled calibration stages
(`punch_jab`/`punch_cross`/`punch_hook_l`/`punch_hook_r`), and a flywheel data
collector (`scripts/collect_from_logs.py`) fed by `FLYWHEEL_HIT` log lines the
engine now emits at `engine/engine-core/src/game_loop.rs:186`.

**Batch 4 — CI/deploy hardening (2026-05-23).** Added `node-build`
(catches `tsc -b` breakage that vitest misses because root tsconfigs use
`"files": []`), `python-checks` (compileall + export_onnx smoke), and a
Playwright e2e job (fps-boxing only). Dockerfile rebuilt for the games/* layout
(Caddy + 3 servers).

**Batch 5 — engine fix (2026-07-20, `011631f2`).** The RTT-fairness input-delay
buffer was computing 0ms because it only populated from client pongs, and the
client only pongs in reply to a server ping that was never sent. `handle_player`
now sends `MsgPing` every 500ms, aborted on disconnect.

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table.

### Pending Todos

None.

### Blockers/Concerns

- **Phase 13.1 — Punch classifier still inert**: `games/fps-boxing/client/public/models/punch_classifier_int8.onnx` is the ~10KB all-zero-weight placeholder. Both classification paths in `usePunchClassifier` fail closed against it: logits mode softmaxes a constant vector, and prototype mode measures zero distance to every centroid, so confidence lands at 1/N — under the 0.7 `CONFIDENCE_THRESHOLD` either way, and `type` stays `null` forever. Punch-type damage multipliers are therefore dead code in shipped gameplay. The May 2026 ML batch removed the *tooling* blocker (see BL-01) — only trained weights are missing. Not a blocker for v2.0 gameplay, which uses velocity-based detection.
- **`ml/data/` and `ml/models/` are empty** (`.gitkeep` only). No training data has ever been collected.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3 | Punch classifier (BL-01) | Deferred — tooling now complete, needs data + training run | v2.0 close — no FPS training data |
| v3 | AI commentary (COMM-01..04) | Deferred | v1.0 init |
| v3 | AI game generation | Deferred | v1.0 init |
| v3 | Asymmetric matchmaking (phone P1 vs laptop P2) | Deferred | v2.0 init |
| v3 | Spectator overlay for FPS mode | Deferred | v2.0 init |

## Session Continuity

Last session: 2026-08-05 (planning-doc reconciliation only — no code changes)
Last code commit: 2026-07-20
Stopped at: v2.0 closed; post-ship work reconciled into planning docs. v3.0 not
yet scoped — start with `/gsd-new-milestone`.
