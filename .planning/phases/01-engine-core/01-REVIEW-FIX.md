---
phase: 01-engine-core
fixed_at: 2026-05-02T00:00:00Z
review_path: .planning/phases/01-engine-core/01-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-05-02T00:00:00Z
**Source review:** .planning/phases/01-engine-core/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (4 Critical, 5 Warning)
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01 + CR-02: Validate player_slot bounds and fix pose_tx lookup to use actual_code

**Files modified:** `engine/engine-core/src/main.rs`
**Commit:** 43b4b09
**Applied fix:** Added bounds check after `saturating_sub(1)` — if `slot >= 2`, log a warning and return (prevents out-of-bounds panic on `state.players[slot]`). Simultaneously hoisted `actual_code` out of the `cmd_tx` match block so the `pose_tx` lookup uses `actual_code` instead of `room_code`, preventing silent player drop and orphaned room actor when room code collision occurs during `create_room`.

### CR-03: Wire shared Arc<AtomicBool> so room expiry fires after match ends

**Files modified:** `engine/engine-core/src/room.rs`, `engine/engine-core/src/room_manager.rs`, `engine/engine-core/src/game_loop.rs`
**Commit:** 548d6c7
**Applied fix:** Added `match_over_flag: Arc<AtomicBool>` field to `RoomState`. Updated `RoomState::new` to accept it as a parameter. Changed `RoomHandle.match_over` from plain `AtomicBool` to `Arc<AtomicBool>`. Updated `create_room` to create a single `Arc<AtomicBool>` shared between `RoomState` and `RoomHandle`. Updated `game_loop.rs` to call `state.match_over_flag.store(true, Relaxed)` alongside `state.match_over = true` when match ends. `RoomHandle.is_expired()` now correctly observes match completion via the shared flag.
**Status:** fixed: requires human verification (logic change — shared flag wiring should be confirmed to propagate correctly across actor boundary)

### CR-04: Clamp RTT values to reject client-controlled timestamp manipulation

**Files modified:** `engine/engine-core/src/input_delay.rs`
**Commit:** dae6d13
**Applied fix:** Added bounds check in `record_pong` — if `rtt < 0.0 || rtt > 5000.0`, emit a warning log and return `0.0` without recording the sample. This prevents a client sending a future timestamp (negative RTT disabling input delay) or epoch 0 (enormous RTT handicapping the opponent).

### WR-01: Use DashMap entry API in create_room to eliminate TOCTOU race

**Files modified:** `engine/engine-core/src/room_manager.rs`
**Commit:** f169bd8
**Applied fix:** Replaced `contains_key` + `insert` (two separate DashMap operations) with a loop using `entry(candidate)`. On `Entry::Vacant`, all channels, state, actor, and handle are built and inserted atomically within the entry critical section. On `Entry::Occupied`, a new random 6-char code is generated as the next candidate and the loop retries. This closes the window where two concurrent join requests for the same new code could both observe the slot as vacant.

### WR-02: Log instead of silently drop round_end/match_end/round_start messages

**Files modified:** `engine/engine-core/src/game_loop.rs`
**Commit:** 81031aa
**Applied fix:** Replaced three bare `tx.try_send(json.clone())` calls (for `round_end`, `match_end`, and `round_start` delivery to players) with logged variants. When `try_send` returns `Err`, a `tracing::warn!` is emitted identifying the room, player slot, and message type that was dropped. This makes channel-full drops visible in logs; absolute reliability would require `.send().await` but that requires the game loop to become async.

### WR-03: Add biased select in forward_broadcast_to_spectator to prioritise game_rx

**Files modified:** `engine/engine-core/src/broadcast.rs`
**Commit:** 5216a6a
**Applied fix:** Added `biased;` to the `tokio::select!` in `forward_broadcast_to_spectator`. This ensures `game_rx` (authoritative game state at 60 Hz) is always polled before `pose_rx` (up to 120 msg/sec pose traffic), preventing systematic starvation of game state delivery to spectators under high-frequency pose bursts.

### WR-04: Add join-first handshake to capture_fixtures.py for Rust server

**Files modified:** `scripts/capture_fixtures.py`
**Commit:** fc5bd04
**Applied fix:** Added `await ws.send(json.dumps({"type": "join", "room_code": "TESTFIX", "player_slot": 1}))` before the `ws.recv()` call in the player connection block. Changed `ws.recv()` to `asyncio.wait_for(ws.recv(), timeout=3.0)` for consistency with the rest of the file. The script was previously waiting for a `MsgJoined` that the server would never send because it was waiting for a `MsgJoin` first.

### WR-05: Clear processed_frames each tick to bound memory in Phase 1

**Files modified:** `engine/engine-core/src/game_loop.rs`
**Commit:** 122fce9
**Applied fix:** Added `player.processed_frames.clear()` immediately after the RTT-release drain loop in `game_tick`. Phase 1 has no hit-detection consumer for `processed_frames`, so frames would accumulate monotonically (up to ~5,400 frames/player/round at 60 fps over 90 seconds). The clear is placed with a comment noting Phase 2 will process before clearing.

---

_Fixed: 2026-05-02T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
