---
phase: "01-engine-core"
plan: "04"
subsystem: engine
tags: [game-loop, spectator, broadcast, websocket, round-lifecycle, fix-02]
dependency_graph:
  requires: ["01-03"]
  provides: ["game_loop.rs full skeleton", "broadcast.rs spectator handler", "main.rs spectator WS wired"]
  affects: ["spectator overlay", "round lifecycle", "ENG-04", "ENG-07", "ENG-09", "ENG-10", "ENG-11", "FIX-02"]
tech_stack:
  added: []
  patterns:
    - "MissedTickBehavior::Skip for 60Hz tick fairness (ENG-04)"
    - "tokio::select! with game_rx + pose_rx for spectator broadcast fan-out"
    - "RecvError::Lagged handled non-fatally (Pitfall 2)"
    - "Subscribe-before-snapshot ordering for FIX-02 race prevention (Pitfall 6)"
    - "Oneshot channel for RoomCmd::GetSnapshot snapshot delivery"
key_files:
  created: []
  modified:
    - engine/engine-core/src/game_loop.rs
    - engine/engine-core/src/broadcast.rs
    - engine/engine-core/src/main.rs
decisions:
  - "Empty poses (vec![], vec![]) sent in every MsgGameState — pose fan-out travels via pose_update fast path (ENG-07), not the 60Hz tick"
  - "Wins populated from state.wins in every MsgGameState including snapshot — FIX-02 prevents overlay win counter reset on spectator reconnect"
  - "GameEvent enum defined with RoundStart/RoundOver/MatchEnd in Phase 1; CommentaryHint deferred to Phase 2 (D-07)"
  - "Tick counter set to 0 in Phase 1 — Phase 2 will add a monotonic tick counter"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  files_modified: 3
---

# Phase 1 Plan 4: Game Loop + Spectator Broadcast Summary

60Hz game loop skeleton with warmup gate, round lifecycle, and spectator WebSocket handler delivering FIX-02 snapshots with broadcast lag handling.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | game_loop.rs — 60Hz game tick, warmup gate, round lifecycle | a9cd4b8 | engine/engine-core/src/game_loop.rs |
| 2 | broadcast.rs + spectator WS handler with FIX-02 snapshot | 3ca14ba | engine/engine-core/src/broadcast.rs, engine/engine-core/src/main.rs |

## What Was Built

### game_loop.rs (Task 1)
- `game_tick(&mut RoomState)` called from room_actor's 60Hz `tokio::time::interval` branch
- Warmup gate: first 3.8 seconds clear pose buffers and broadcast `game_state` with `ROUND_DURATION` remaining (ENG-09)
- Live phase: RTT cutoff drains `pose_buffer` into `processed_frames` via `input_delay::compute_cutoff` (ENG-06)
- Round lifecycle: time expiry triggers `MsgRoundEnd`, win counter increment, match-over check (`MsgMatchEnd`), then `on_round_reset` with new warmup window (ENG-10)
- All `MsgGameState` messages carry `wins: (state.wins[0], state.wins[1])` — FIX-02
- Poses always `(vec![], vec![])` in Phase 1 — pose fan-out is via `pose_update` fast path
- `GameEvent` enum with `RoundStart`, `RoundOver`, `MatchEnd` (D-07; `CommentaryHint` deferred)

### broadcast.rs (Task 2)
- `forward_broadcast_to_spectator`: `tokio::select!` loop over `game_rx` and `pose_rx`; `RecvError::Lagged` handled non-fatally with warning log (T-04-01)
- `send_snapshot`: sends `lobby_update` always, then `round_start` + `game_state` if match in progress

### main.rs (Task 2)
- `handle_spectator` fully implemented: `subscribe_spectator` called BEFORE `GetSnapshot` oneshot to prevent Pitfall 6 race condition (FIX-02)
- Spectator inbound messages discarded without parsing (T-04-02, read-only semantics)
- Forward task aborted on spectator disconnect

## Deviations from Plan

None — plan executed exactly as written. All code matches the pattern from 01-PATTERNS.md.

## Success Criteria Check

- `cargo build` exits 0: PASSED
- `cargo test` passes (18 tests): PASSED
- Warmup constant is 3.8 seconds: PASSED (`pub const ROUND_WARMUP: f64 = 3.8;`)
- Round duration is 90.0 seconds: PASSED (`pub const ROUND_DURATION: f64 = 90.0;`)
- Poses in MsgGameState always `(vec![], vec![])`: PASSED
- Wins in MsgGameState from `state.wins[0]/state.wins[1]` (FIX-02): PASSED
- Spectator snapshot delivers lobby_update + round_start + game_state on connect if match in progress: PASSED
- RecvError::Lagged handled non-fatally: PASSED
- GameEvent enum defined with RoundStart, RoundOver, MatchEnd: PASSED

## Self-Check: PASSED

All files exist and all commits verified in git log.
