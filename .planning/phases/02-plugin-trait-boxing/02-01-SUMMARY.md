---
phase: 02-plugin-trait-boxing
plan: "01"
subsystem: plugin-trait
tags: [rust, trait, game-plugin, workspace]
dependency_graph:
  requires: []
  provides: [plugin-trait crate, GamePlugin trait, GameEvent enum, BodyRegion enum, TickContext, RoomView, SlotView, PoseFrame, PoseKeypoint]
  affects: [engine/Cargo.toml, boxing-plugin (stub)]
tech_stack:
  added: [plugin-trait crate, serde/serde_json in plugin-trait]
  patterns: [object-safe trait with Send+Sync supertrait, Box<dyn Any+Send> plugin state, events-out messaging]
key_files:
  created:
    - engine/plugin-trait/Cargo.toml
    - engine/plugin-trait/src/lib.rs
    - engine/boxing-plugin/Cargo.toml
    - engine/boxing-plugin/src/lib.rs
  modified:
    - engine/Cargo.toml
    - engine/Cargo.lock
decisions:
  - "Added Sync to GamePlugin supertrait (Send+Sync) so Arc<dyn GamePlugin+Send+Sync> works without double-boxing"
  - "Created boxing-plugin stub to satisfy workspace manifest so cargo build -p plugin-trait succeeds"
  - "PoseKeypoint uses f64 to match protocol.rs PoseKeypoint precision exactly"
metrics:
  duration: "2m 23s"
  completed: "2026-05-02T19:19:57Z"
  tasks_completed: 1
  files_created: 4
  files_modified: 2
requirements:
  - PLUG-01
  - PLUG-02
  - PLUG-03
  - PLUG-04
  - PLUG-05
---

# Phase 2 Plan 01: plugin-trait Crate Summary

**One-liner:** Object-safe `GamePlugin` trait with `Box<dyn Any+Send>` state, five `GameEvent` variants, nine `BodyRegion` variants, and full `TickContext` / `RoomView` / `SlotView` / `PoseFrame` / `PoseKeypoint` types in a dependency-free crate.

## What Was Built

Created the `engine/plugin-trait` workspace crate — the foundational shared contract between the engine-core and any game plugin. The crate provides:

- **`GamePlugin` trait** — 6 synchronous methods (`init_state`, `on_tick` required; 4 with default no-op implementations). Supertrait is `Send + Sync`, enabling `Arc<dyn GamePlugin + Send + Sync>` without double-boxing.
- **`GameEvent` enum** — 5 variants matching D-03: `Hit`, `RoundOver`, `SendToPlayer`, `Broadcast`, `CommentaryHint`. Payloads use `serde_json::Value` to avoid generic type parameters that would break object safety.
- **`BodyRegion` enum** — 9 variants matching BOX-03: `HeadFace`, `HeadChin`, `HeadThroat`, `TorsoUpper`, `TorsoLower`, `BlockHand`, `BlockForearm`, `LegThigh`, `LegShin`.
- **`TickContext<'a>`** — Carries `frames: [&'a VecDeque<PoseFrame>; 2]`, `tick_info: TickInfo`, `room: RoomView`.
- **`RoomView`, `SlotView`** — Read-only room views for plugin consumption.
- **`PoseFrame`, `PoseKeypoint`** — Coordinate types using `f64` to match `protocol.rs` precision.

Updated `engine/Cargo.toml` workspace members to include `plugin-trait` and `boxing-plugin`.

## Commits

| Commit | Description |
|--------|-------------|
| `441036a` | feat(02-01): create plugin-trait crate with GamePlugin trait and workspace update |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created boxing-plugin workspace stub**
- **Found during:** Task 1 verification
- **Issue:** `cargo build -p plugin-trait` failed because `engine/Cargo.toml` lists `boxing-plugin` as a workspace member but the directory did not exist. Cargo always loads all workspace members before building any individual crate.
- **Fix:** Created minimal `engine/boxing-plugin/Cargo.toml` and `engine/boxing-plugin/src/lib.rs` stub (comment-only, compiles but exports nothing). This satisfies the workspace manifest without implementing any boxing logic.
- **Files modified:** `engine/boxing-plugin/Cargo.toml`, `engine/boxing-plugin/src/lib.rs`
- **Commit:** `441036a` (same commit as task — stub is part of the workspace setup)
- **Note:** The plan text acknowledges "boxing-plugin directory does not yet exist; adding it to workspace now is correct — Cargo will error on `cargo build --workspace` until it exists." The stub is the minimal fix for the `cargo build -p plugin-trait` verification command to pass.

## Known Stubs

- `engine/boxing-plugin/src/lib.rs` — comment-only stub. Plan 02-02 implements the full boxing plugin.

## Verification Results

| Check | Result |
|-------|--------|
| `cargo build -p plugin-trait` exits 0 | PASS |
| No `async fn` in trait methods (0 occurrences, comments excluded) | PASS |
| `GamePlugin: Send + Sync` supertrait present | PASS |
| 9 `BodyRegion` variants | PASS |
| `PoseKeypoint.x: f64` | PASS |
| All 5 `GameEvent` variants present | PASS |
| `TickContext`, `RoomView`, `SlotView`, `PoseFrame` present | PASS |
| `"plugin-trait"` in workspace members | PASS |
| `"boxing-plugin"` in workspace members | PASS |

## Threat Flags

No new threat surface introduced. This plan creates type definitions only — no network endpoints, no auth paths, no file access patterns, no schema changes at trust boundaries.

## Self-Check: PASSED

Files confirmed present:
- `engine/plugin-trait/Cargo.toml` — exists
- `engine/plugin-trait/src/lib.rs` — exists
- `engine/boxing-plugin/Cargo.toml` — exists
- `engine/boxing-plugin/src/lib.rs` — exists

Commit `441036a` confirmed in git log.
