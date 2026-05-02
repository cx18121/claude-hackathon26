---
phase: 02-plugin-trait-boxing
plan: "05"
subsystem: engine-core
tags: [rust, game-loop, solo-mode, bot, box-10, gap-closure]
dependency_graph:
  requires:
    - "02-04"
  provides:
    - "solo mode gate in game_loop.rs"
    - "solo mode CalibrationDone handler in room.rs"
    - "BOX-10 closed"
  affects:
    - "engine/engine-core/src/game_loop.rs"
    - "engine/engine-core/src/room.rs"
tech_stack:
  added: []
  patterns:
    - "solo_mode = !state.players[1].connected pattern for bot detection"
    - "calibrated_ok / ready_to_start conditional dispatch on solo vs two-player mode"
key_files:
  created: []
  modified:
    - engine/engine-core/src/game_loop.rs
    - engine/engine-core/src/room.rs
decisions:
  - "Solo mode is detected from engine-owned connection state (state.players[1].connected), not a client message"
  - "solo_mode variable is re-evaluated every tick from live connection state — flips naturally on disconnect"
  - "Tests inline the solo_mode/calibrated_ok logic rather than calling game_tick directly to avoid Tokio async setup complexity in unit tests"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-02"
  tasks_completed: 3
  files_modified: 2
---

# Phase 2 Plan 05: Solo Mode Gate Fix Summary

BOX-10 gap-closure: added solo_mode paths to game_loop.rs (match_in_progress gate) and room.rs (CalibrationDone handler) so the boxing plugin's bot logic is reachable when only one player connects and calibrates. cargo test --workspace exits 0 with 88 tests passing (27 in engine-core binary, including 2 new solo mode tests).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix match_in_progress gate in game_loop.rs | a3b2a64 | engine/engine-core/src/game_loop.rs |
| 2 | Fix CalibrationDone handler in room.rs | d5c3082 | engine/engine-core/src/room.rs |
| 3 | Add solo mode unit tests | e3f9c3f | engine/engine-core/src/game_loop.rs |

## Changes Made

### game_loop.rs — match_in_progress gate

Replaced the flat `state.players.iter().all(|p| p.reference_velocity.is_some())` check in `game_tick` with a `solo_mode` / `calibrated_ok` two-branch pattern:

- `solo_mode = !state.players[1].connected`
- In solo mode: only `state.players[0].reference_velocity.is_some()` is required
- In two-player mode: both players must have calibrated (existing behavior preserved)
- `match_in_progress = calibrated_ok && round_start_time.is_some() && !match_over`

### room.rs — CalibrationDone handler

Replaced `both_calibrated` (required both players to have calibrated) with `ready_to_start` using the same solo_mode pattern:

- In solo mode: player 0 calibrating alone triggers `match_start` + `round_start` broadcast and sets `round_start_time`
- Distinct log line: `"room {} solo/bot match started"` vs `"room {} match started"`
- Two-player behavior unchanged

### game_loop.rs — Unit tests

Added `solo_mode_tests` module at bottom of game_loop.rs:

- `box10_solo_mode_gate_allows_single_player`: constructs RoomState with player 0 connected + calibrated, player 1 not connected; verifies `ready_to_start` is true and `match_in_progress` is true after `round_start_time` is set
- `two_player_mode_still_requires_both_calibrated`: constructs RoomState with both players connected but only player 0 calibrated; verifies `ready_to_start` is false

## Verification Results

```
cargo test --workspace exits 0
- boxing-plugin: 23 passed
- engine-core lib: 20 passed
- engine-core bin: 27 passed (includes 2 new solo mode tests)
- protocol roundtrip: 18 passed
Total: 88 tests, 0 failed
```

Acceptance criteria satisfied:
- `solo_mode` appears 9+ times in game_loop.rs (assignment + if branches + test module)
- `solo_mode` appears 3 times in room.rs (assignment + if branch + log conditional)
- `both_calibrated` appears 0 times in room.rs (removed)
- `state.players.iter().all` in game_loop.rs: 1 production occurrence (inside `else` branch) + test module occurrences
- `ready_to_start` used for CalibrationDone gate
- `on_calibration_complete` hook still present and unchanged (line 244 in room.rs)
- `solo/bot match started` log line present

## Deviations from Plan

None — plan executed exactly as written. The `use super::*` and `use tokio::sync::mpsc` imports from the test template were cleaned up (unused imports removed) before the final commit.

## Known Stubs

None — all solo mode logic is fully wired. The bot path in boxing-plugin (`tick_bot` + `on_tick` bot branch) was already implemented in Plan 02-04 and is now reachable via the corrected `match_in_progress` gate.

## Self-Check: PASSED

Files verified:
- engine/engine-core/src/game_loop.rs: exists, 420 lines, contains solo_mode_tests module
- engine/engine-core/src/room.rs: exists, contains solo_mode and ready_to_start
- Commits a3b2a64, d5c3082, e3f9c3f: present in git log
