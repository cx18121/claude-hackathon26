---
phase: 02-plugin-trait-boxing
fixed_at: 2026-05-02T00:00:00Z
review_path: .planning/phases/02-plugin-trait-boxing/02-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-02
**Source review:** .planning/phases/02-plugin-trait-boxing/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (5 Critical + 5 Warning)
- Fixed: 10
- Skipped: 0

## Fixed Issues

### CR-01: Room Expiry Permanently Disabled — Rooms Leak Indefinitely

**Files modified:** `engine/engine-core/src/room_manager.rs`, `engine/engine-core/src/room.rs`, `engine/engine-core/src/game_loop.rs`
**Commit:** 60e780c
**Applied fix:** Changed `last_player_disconnected_at` in `RoomHandle` from a plain `std::sync::Mutex<Option<Instant>>` to `Arc<std::sync::Mutex<Option<Instant>>>`. Added the same field to `RoomState` and threaded the shared `Arc` through `RoomState::new`. In the `PlayerDisconnect` handler, after setting `connected = false`, the code now checks whether any players remain connected and, if none do, sets `*guard = Some(Instant::now())`. The expiry task's `is_expired()` check now actually fires. Also updated both test helpers (`make_state` in room.rs and `make_room_state` in game_loop.rs) to pass the new Arc argument.

---

### CR-02: `max_wins` Config Value Silently Ignored — Match Always Ends at 2 Wins

**Files modified:** `engine/plugin-trait/src/lib.rs`, `engine/boxing-plugin/src/lib.rs`, `engine/engine-core/src/room_manager.rs`
**Commit:** 6f510d6
**Applied fix:** Added `fn max_wins(&self) -> u32 { 2 }` as a defaulted method on the `GamePlugin` trait. Implemented it in `BoxingPlugin` to return `self.config.max_wins`. Changed `create_room` in `room_manager.rs` to pass `plugin.max_wins()` instead of the hardcoded literal `2` to `RoomState::new`.

---

### CR-03: `HeadThroat` Region Is Unreachable — Logic Error in `refine_head_region`

**Files modified:** `engine/boxing-plugin/src/hit_detection.rs`
**Commit:** 7691f25
**Applied fix:** Rewrote `refine_head_region` to use three distinct ascending bands: `[head_y, head_y+0.10*scale)` → `HeadThroat`, `[head_y+0.10*scale, head_y+0.20*scale)` → `HeadChin`, `[head_y+0.20*scale, ∞)` → `HeadFace`. The old code had two thresholds using `0.2*scale` for both, making `HeadThroat` unreachable since the caller guaranteed `wrist_y >= head_y`. The new code uses `0.10*scale` as the first band boundary so `HeadThroat` is the lowest and genuinely reachable. **Note: logic change — requires human verification of threshold values.**

---

### CR-04: Human `you_were_hit` Message Missing `region` Field

**Files modified:** `engine/boxing-plugin/src/lib.rs`
**Commit:** 3c3c02b
**Applied fix:** Added `"region": h.region.to_wire()` to the `SendToPlayer` payload in the human hit path (was only present in the bot path). Uses `to_wire()` from the CR-05 fix. The payload now matches the bot path and the canonical `MsgYouWereHit` protocol struct.

---

### CR-05: `BodyRegion` Wire Format Produces Concatenated Lowercase, Not Snake_Case

**Files modified:** `engine/plugin-trait/src/lib.rs`, `engine/engine-core/src/game_loop.rs`, `engine/boxing-plugin/src/bot.rs`
**Commit:** 961254a
**Applied fix:** Added `impl BodyRegion { pub fn to_wire(&self) -> &'static str { ... } }` to `plugin-trait/src/lib.rs` with explicit snake_case strings for all 9 variants. Replaced `format!("{:?}", region).to_lowercase()` in `game_loop.rs` (`recent_hits` accumulation) and `bot.rs` (`you_were_hit` payload) with `region.to_wire()`.

---

### WR-01: `solo_mode` Predicate Inconsistency Between Engine and Boxing Plugin
### WR-03: P2 Mid-Game Disconnect Silently Activates Bot Mode

**Files modified:** `engine/plugin-trait/src/lib.rs`, `engine/engine-core/src/room.rs`, `engine/engine-core/src/game_loop.rs`, `engine/boxing-plugin/src/lib.rs`
**Commit:** 47df6db
**Applied fix:** Added `solo_mode: bool` field to `RoomState` (initialized to `false`). In the `CalibrationDone` handler, set `state.solo_mode = solo_mode` once when match starts. Updated `game_loop.rs` to use `state.solo_mode` instead of re-deriving `!state.players[1].connected` on every tick. Added `solo_mode: bool` field to `RoomView` in `plugin-trait/src/lib.rs` and populate it with `state.solo_mode` when constructing `TickContext`. Updated `boxing-plugin/src/lib.rs` to use `ctx.room.solo_mode` instead of re-deriving from slot connectivity. Fixed the `on_tick_time_expired_returns_round_over` test to supply `solo_mode: false` in its `RoomView` literal. WR-03 is fully addressed by the same fix as WR-01.

---

### WR-02: `build_snapshot` Ignores Warmup Period — Stale `remaining_time` for Reconnecting Spectators

**Files modified:** `engine/engine-core/src/room.rs`
**Commit:** 6488e7b
**Applied fix:** In `build_snapshot`, replaced the hardcoded `90.0_f64` and raw `elapsed` with a proper computation: `use crate::game_loop::{ROUND_DURATION, ROUND_WARMUP}; let live_elapsed = (elapsed - ROUND_WARMUP).max(0.0); let remaining = (ROUND_DURATION - live_elapsed).max(0.0);`. This mirrors the live game loop calculation and eliminates up to 3.8 seconds of `remaining_time` error for reconnecting spectators.

---

### WR-04: Kick Region Uses Attacker's Absolute Ankle Y, Not Defender's Body Frame

**Files modified:** `engine/boxing-plugin/src/hit_detection.rs`
**Commit:** 518592e
**Applied fix:** Replaced `if ankle_pos.y >= 0.0 { LegThigh } else { LegShin }` with a call to `classify_region(ankle_pos.y, def_scale)` followed by a `match` that constrains the result to leg regions (`LegThigh` or `LegShin`), mapping `TorsoLower` and anything higher to `LegThigh` (high kick contacts thigh). The kick region now depends on the defender's body geometry. **Note: logic change — requires human verification of mapping for edge cases.**

---

### WR-05: `player_slot=0` in Join Maps to Slot 0 Without Rejection or Warning

**Files modified:** `engine/engine-core/src/main.rs`
**Commit:** 17e6ae4
**Applied fix:** Replaced `(msg.player_slot as usize).saturating_sub(1)` + `if slot >= 2` guard with an explicit `if msg.player_slot == 0 || msg.player_slot > 2 { warn and return }` check before the conversion. Conversion is now `(msg.player_slot as usize) - 1` which is safe since we know `player_slot` is 1 or 2 at that point.

---

_Fixed: 2026-05-02_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
