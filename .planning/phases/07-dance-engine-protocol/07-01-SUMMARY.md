---
phase: 07-dance-engine-protocol
plan: 01
subsystem: engine
tags: [rust, game-plugin, dance, calibration, websocket, protocol]
dependency_graph:
  requires: []
  provides:
    - game_type field in MsgJoined wire message
    - dance calibration skip (sentinel velocities)
    - spectator_snapshot for dance rooms
    - GamePlugin::game_type(), requires_calibration(), spectator_snapshot() trait methods
  affects:
    - engine/plugin-trait (trait extended)
    - engine/dance-plugin (three new overrides)
    - engine/boxing-plugin (game_type override)
    - engine/engine-core (protocol, room, broadcast, main, room_manager)
tech_stack:
  added: []
  patterns:
    - sentinel velocity pattern (Some(0.0)) for calibration bypass
    - plugin spectator_snapshot dispatched from build_snapshot
    - serde default functions for backward-compatible field addition
key_files:
  created: []
  modified:
    - engine/plugin-trait/src/lib.rs
    - engine/dance-plugin/src/lib.rs
    - engine/boxing-plugin/src/lib.rs
    - engine/engine-core/src/protocol.rs
    - engine/engine-core/src/room.rs
    - engine/engine-core/src/broadcast.rs
    - engine/engine-core/src/main.rs
    - engine/engine-core/src/room_manager.rs
    - engine/engine-core/src/game_loop.rs
    - engine/engine-core/tests/fixtures/msg_joined.json
    - engine/engine-core/tests/protocol_roundtrip.rs
decisions:
  - "Sentinel velocity Some(0.0) chosen to signal calibration bypass; dance plugin ignores value"
  - "serde default function on game_type ensures old MsgJoined JSON without game_type still deserializes"
  - "plugin_snapshot sent after game_state in send_snapshot to match late-join ordering"
metrics:
  duration: 4 minutes
  completed_date: "2026-05-10T04:16:59Z"
  tasks_completed: 2
  files_modified: 11
---

# Phase 7 Plan 01: Dance Engine Protocol Summary

Extend GamePlugin trait with game_type/requires_calibration/spectator_snapshot; wire dance calibration skip and spectator snapshot into engine-core.

## What Was Built

Three new `GamePlugin` trait methods added to `plugin-trait/src/lib.rs` with safe defaults that preserve existing boxing behavior:

- `game_type() -> &'static str` — default "unknown"; BoxingPlugin returns "boxing"; DancePlugin returns "dance"
- `requires_calibration() -> bool` — default true (boxing unchanged); DancePlugin returns false
- `spectator_snapshot(&dyn Any) -> Option<Value>` — default None; DancePlugin returns Some with beat/scores when round active

Engine-core changes wire these into the runtime:

- `MsgJoined` gains a `game_type` field (serde default "unknown" for backward compat)
- `RoomState` gains `game_type: String` set at creation from `plugin.game_type()`
- `RoomSnapshot` gains `game_type: String` and `plugin_snapshot: Option<Value>`
- `build_snapshot` calls `plugin.spectator_snapshot()` and populates both new fields
- `send_snapshot` in broadcast.rs sends `plugin_snapshot` JSON after `game_state` to spectators
- `handle_cmd(PlayerConnect)` branches on `plugin.requires_calibration()`: dance rooms set sentinel velocities `Some(0.0)` on both player slots and broadcast `MsgMatchStart + MsgRoundStart` immediately; boxing path unchanged
- `main.rs` MsgJoined construction calls `get_room_game_type()` to populate the field
- `room_manager.rs` passes `plugin.game_type().to_string()` to `RoomState::new`
- Fixture `msg_joined.json` updated with `game_type: "boxing"`; roundtrip test asserts the field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] game_loop.rs test helper RoomState::new call missing game_type arg**
- **Found during:** Task 2 compilation
- **Issue:** `game_loop.rs` internal test had a `RoomState::new` call that did not match the updated signature
- **Fix:** Added `"boxing".to_string()` as the `game_type` argument to the test helper
- **Files modified:** engine/engine-core/src/game_loop.rs

## Known Stubs

None. All data is wired end-to-end: game_type flows from plugin → RoomHandle → RoomState → MsgJoined → client; plugin_snapshot flows from plugin state → RoomSnapshot → WebSocket message to spectator.

## Threat Flags

None. All new surface (game_type in MsgJoined, spectator_snapshot, calibration skip) was analyzed in the plan's threat model (T-07-01 through T-07-04) and accepted.

## Self-Check: PASSED

All key files confirmed present. Commits 5e9cf14 and 161ed64 confirmed in git log.
