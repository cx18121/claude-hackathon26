---
phase: 01-engine-core
plan: "03"
subsystem: concurrency-core
tags: [rust, tokio, actor, dashmap, websocket, room-manager, rtt-fairness, input-delay]

# Dependency graph
requires:
  - engine/engine-core/src/protocol.rs (Plan 01 — all wire message types)
provides:
  - input_delay.rs: record_pong, median_rtt, compute_cutoff (RTT fairness buffer)
  - room.rs: RoomState, PlayerSlot, RoomCmd, RoomSnapshot, room_actor
  - room_manager.rs: RoomManager with DashMap registry, create_room, expiry_task
  - main.rs: handle_player fully wired to room actor (join-first, room-on-demand, outbound task)
affects: [04-boxing-plugin, 05-dockerfile]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Room actor pattern: mpsc::Receiver<RoomCmd> + tokio::select! + 60Hz interval (ENG-03)
    - MissedTickBehavior::Skip for interval ticks that fall behind (ENG-04)
    - Bounded outbound mpsc channel per player (capacity 32); never ws.send() from game loop (ENG-05)
    - DashMap guard clone-before-await pattern: get_cmd_tx() returns owned mpsc::Sender (Pitfall 4)
    - Two broadcast channels per room: pose_tx(64) fast path, game_tx(128) slow path (ENG-08)
    - RTT fairness: SystemTime for cross-process RTT, Instant for internal cutoff comparisons (ENG-06)
    - Join-first protocol: first WS message must be MsgJoin; connection closed if not (PROTO-01)
    - Room-on-demand: create_room(room_code) called when get_cmd_tx returns None (ENG-02)

key-files:
  created: []
  modified:
    - engine/engine-core/src/input_delay.rs
    - engine/engine-core/src/room.rs
    - engine/engine-core/src/room_manager.rs
    - engine/engine-core/src/main.rs
    - engine/engine-core/src/game_loop.rs
    - engine/engine-core/src/broadcast.rs

key-decisions:
  - "room_actor owns pose_tx and game_tx as fields on RoomState (not passed as separate args) — simplifies actor signature"
  - "compute_cutoff deferred to game_loop.rs Plan 04 — stub comment added for handoff clarity"
  - "PlayerConnect reply type changed to Option<ConnectResult> (None = slot occupied) vs plan's ConnectResult — better slot-conflict handling"
  - "Alphanumeric iterator produces u8, not char — fixed with char::from() before to_ascii_uppercase()"
  - "SinkExt trait import required for ws_sink.send in outbound task — added futures_util::SinkExt"

requirements-completed: [ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-13]

# Metrics
duration: ~7min
completed: 2026-05-02
---

# Phase 01 Plan 03: Room Actor Model, DashMap Registry, and Player Handler Summary

**Tokio actor-per-room with DashMap registry, RTT fairness buffer ported from Python, and fully wired WebSocket player handler with join-first protocol and room-on-demand creation**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-02
- **Completed:** 2026-05-02
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `input_delay.rs`: Full port of `server/input_delay.py` — `record_pong` (SystemTime RTT, 10-sample cap), `median_rtt` (sort-based), `compute_cutoff` (Instant cutoff with max_delay_ms cap); 5 unit tests pass
- `room.rs`: `RoomState` with `[PlayerSlot; 2]` array, `RoomCmd` enum (7 variants), `room_actor` with `MissedTickBehavior::Skip`, `PlayerConnect` arm sends `calibration_start` to both players when both connect (ENG-11)
- `room_manager.rs`: `RoomManager` backed by `DashMap<String, RoomHandle>`, `create_room` uses client-provided code on first availability, `expiry_task` removes expired rooms and calls `join_handle.abort()` (ENG-13), two broadcast channels per room (ENG-08)
- `main.rs`: `handle_player` fully wired — outbound mpsc task (capacity 32, ENG-05), join-first read (PROTO-01), room-on-demand via `create_room` (ENG-02), immediate pose fan-out via `pose_tx.send` before actor dispatch (ENG-07)

## Task Commits

1. **Task 1: input_delay.rs — RTT fairness buffer** - `9c4a4fb` (feat)
2. **Task 2: room.rs + room_manager.rs + main.rs — room actor, DashMap registry, player handler** - `e57e2ed` (feat)

## Files Created/Modified

- `engine/engine-core/src/input_delay.rs` — full RTT fairness buffer implementation (was stub)
- `engine/engine-core/src/room.rs` — full room actor implementation (was stub)
- `engine/engine-core/src/room_manager.rs` — full DashMap registry with expiry task (was minimal stub)
- `engine/engine-core/src/main.rs` — handle_player fully wired to room actor (was TODO stub)
- `engine/engine-core/src/game_loop.rs` — stub with compute_cutoff comment for Plan 04 handoff
- `engine/engine-core/src/broadcast.rs` — stub updated with Plan 04 note

## Decisions Made

- `RoomState` stores `pose_tx` and `game_tx` broadcast senders directly rather than passing them as separate actor args — simplifies function signature and avoids lifetime complexity
- `PlayerConnect` reply is `Option<ConnectResult>` (None = slot already occupied) vs. the plan's `ConnectResult` — needed to handle slot conflicts cleanly without a separate error type
- `compute_cutoff` referenced in game_loop.rs comment but not called yet — Plan 04 implements the full tick loop that drains buffers using the cutoff
- `game_tick` stub retained as synchronous `fn` (not `async fn`) — game loop in Plan 04 will be synchronous within the actor

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SinkExt trait import missing for ws_sink.send**
- **Found during:** Task 2 (cargo build)
- **Issue:** `ws_sink.send()` requires `futures_util::SinkExt` in scope; Rust doesn't auto-import extension traits
- **Fix:** Added `use futures_util::{SinkExt, StreamExt}` in main.rs
- **Files modified:** `engine/engine-core/src/main.rs`
- **Commit:** `e57e2ed` (included in task commit)

**2. [Rule 1 - Bug] Alphanumeric iterator produces u8, not char**
- **Found during:** Task 2 (cargo build)
- **Issue:** `rand::Alphanumeric.sample_iter()` yields `u8` bytes; `.map(|c| c.to_ascii_uppercase())` requires `char`; `.collect::<String>()` cannot collect `u8`
- **Fix:** Changed to `.map(|c| char::from(c).to_ascii_uppercase())` in room_manager.rs
- **Files modified:** `engine/engine-core/src/room_manager.rs`
- **Commit:** `e57e2ed` (included in task commit)

---

**Total deviations:** 2 auto-fixed (2 compile-time bugs)
**Impact on plan:** Both were minor API-level bugs caught by the compiler; no logic or behavior change.

## Known Stubs

- `engine/engine-core/src/game_loop.rs` — `game_tick` is a no-op; full 60Hz tick with hit detection, round lifecycle, and `compute_cutoff`-based buffer drain implemented in Plan 04
- `engine/engine-core/src/broadcast.rs` — spectator WebSocket handler implemented in Plan 04
- `handle_spectator` in main.rs — drops socket with log; wired to broadcast channels in Plan 04

## Threat Surface

All threats from the plan's threat model are mitigated:

| Threat | Status |
|--------|--------|
| T-03-01: outbound mpsc DoS | Mitigated — `try_send` used in `send_to_slot`; channel drops if full |
| T-03-02: pose_buffer unbounded | Mitigated — VecDeque capped at 180 frames with `pop_front` on overflow |
| T-03-03: reference_velocity tampering | Accepted (Phase 1 scope) |
| T-03-04: DashMap guard across await | Mitigated — `get_cmd_tx()` returns owned sender; no guard held across await |
| T-03-05: room actor zombie | Mitigated — `join_handle.abort()` in expiry_task |
| T-03-06: room creation flooding | Accepted (Phase 1 scope) |

## Self-Check: PASSED

- `engine/engine-core/src/input_delay.rs` — FOUND
- `engine/engine-core/src/room.rs` — FOUND
- `engine/engine-core/src/room_manager.rs` — FOUND
- `engine/engine-core/src/main.rs` — FOUND
- Commit `9c4a4fb` (input_delay.rs) — FOUND
- Commit `e57e2ed` (room actor + registry + player handler) — FOUND
- `cargo build` exits 0 — VERIFIED
- All 5 input_delay unit tests pass — VERIFIED

---
*Phase: 01-engine-core*
*Completed: 2026-05-02*
