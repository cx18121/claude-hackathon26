---
phase: 02-plugin-trait-boxing
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - engine/engine-core/src/game_loop.rs
  - engine/engine-core/src/room.rs
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-02
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the BOX-10 solo/bot mode gate fix across `game_loop.rs` and `room.rs`. The fix adds `solo_mode = !state.players[1].connected` logic to both `game_tick` and the `CalibrationDone` handler to allow a single connected player to start a match against the bot. The approach is architecturally sound, but two blockers prevent it from working as designed: the calibration handshake is never initiated for a solo player (so `CalibrationDone` can never arrive), and a mid-game P2 disconnect silently converts the live match into bot mode. Two additional warnings cover a snapshot time calculation discrepancy and a solo_mode predicate inconsistency between the engine and plugin layers.

---

## Critical Issues

### CR-01: Solo-mode calibration_start is never sent — BOX-10 fix is unreachable

**File:** `engine/engine-core/src/room.rs:222-233`

**Issue:** The `calibration_start` message — which the mobile client requires before it will enter the calibration phase and send `CalibrationDone` — is only broadcast when **both** players are connected (`players[0].connected && players[1].connected`, line 224). In solo/bot mode player 2 never connects, so `calibration_start` is never sent to player 1. The mobile client comment at line 222 explicitly states "Mobile clients wait for this message before transitioning out of lobby phase." Consequently, the player is permanently stuck in the lobby, `CalibrationDone` never arrives, `reference_velocity` is never set, `ready_to_start` is always `false`, and the match never starts. The entire BOX-10 fix path is dead code under the intended solo-mode flow.

**Fix:** Add a solo-mode branch that sends `calibration_start` to slot 0 when only slot 0 has connected and a configurable timeout (or immediately on connect if solo-only rooms are first-class):

```rust
// After setting players[slot].connected = true (line 206)
let both_connected = state.players[0].connected && state.players[1].connected;
let solo_ready    = state.players[0].connected && !state.players[1].connected;

if both_connected || solo_ready {
    use crate::protocol::MsgCalibrationStart;
    if let Ok(json) = serde_json::to_string(&MsgCalibrationStart {
        msg_type: "calibration_start".to_string(),
    }) {
        send_to_slot(state, 0, &json);
        if both_connected {
            send_to_slot(state, 1, &json);
        }
        tracing::info!("room {} calibration started ({})",
            state.code,
            if both_connected { "2-player" } else { "solo" });
    }
}
```

If a time-delayed solo trigger is preferred (wait N seconds for P2 before going solo), that timer logic should be added to the `room_actor` select loop; the condition above still applies once the decision is made.

---

### CR-02: P2 mid-game disconnect silently activates bot mode

**File:** `engine/engine-core/src/game_loop.rs:47`

**Issue:** `solo_mode` is re-evaluated on every tick as `!state.players[1].connected`. When player 2 disconnects during a live two-player match (`RoomCmd::PlayerDisconnect { slot: 1 }`), `players[1].connected` flips to `false` but neither `match_over` nor any round-end signal is emitted (see `room.rs:278-290`). On the very next 60 Hz tick, `game_tick` computes `solo_mode = true`, the `TickContext` it builds has `slots[1].connected = false`, and the boxing plugin's bot logic activates (`boxing-plugin/src/lib.rs:97-113`). Player 1 immediately starts absorbing scripted bot damage from an AI opponent instead of the disconnected human. There is no notification to player 1 that the mode changed. This is an unintended behavioral side-effect of the fix.

**Fix:** Separate the concept of "game started as solo" (intentional bot mode) from "opponent disconnected mid-game" (should pause/forfeit). Introduce a `solo_mode` field on `RoomState` set once at match start, and use that instead of re-deriving it every tick:

```rust
// In RoomState (room.rs):
pub solo_mode: bool,   // set at match start, never mutated

// In game_loop.rs game_tick — replace line 47:
let solo_mode = state.solo_mode;

// In room.rs CalibrationDone handler — after setting round_start_time:
state.solo_mode = !state.players[1].connected;
```

This way a P2 mid-game disconnect does not flip the engine into bot mode; a separate disconnect-handling policy (forfeit, pause, etc.) can be implemented independently.

---

## Warnings

### WR-01: `solo_mode` predicate is inconsistent between engine and boxing plugin

**File:** `engine/engine-core/src/game_loop.rs:47` and `engine/boxing-plugin/src/lib.rs:97`

**Issue:** The engine defines solo mode as `!state.players[1].connected` (true whenever P2 is absent, regardless of P1). The boxing plugin defines it as `ctx.room.slots[0].connected && !ctx.room.slots[1].connected` (true only when P1 is also present). These definitions diverge when P1 disconnects from an active solo match: the engine's `calibrated_ok` check still passes (P1's `reference_velocity` remains `Some`), `match_in_progress` stays true, and `game_tick` keeps running — but the plugin receives `slots[0].connected = false` and evaluates `solo_mode = false`, so bot logic does not run and both hit-detection paths iterate over empty frame queues. The inconsistency produces divergent behavior that is hard to reason about and will mask bugs in future changes.

**Fix:** Align on one definition. The plugin's stricter form (P1 connected AND P2 not connected) is the correct semantic. If the engine adopts the same field (from the `solo_mode: bool` introduced in CR-02), both sides use the same value with no re-derivation.

---

### WR-02: `build_snapshot` hardcodes round duration and ignores warmup, producing a stale `remaining_time`

**File:** `engine/engine-core/src/room.rs:158`

**Issue:** `build_snapshot` computes `remaining = (90.0_f64 - elapsed).max(0.0)` where `elapsed` is wall-clock seconds since `round_start_time`. The live game path in `game_loop.rs:81-82` uses `ROUND_DURATION - (elapsed - ROUND_WARMUP)`, which correctly excludes the 3.8-second warmup window from the countdown. The snapshot path does not subtract `ROUND_WARMUP`, so a reconnecting spectator or player receives a `remaining_time` that is up to 3.8 seconds lower than what the live broadcast shows. Additionally, the literal `90.0` duplicates `game_loop::ROUND_DURATION`; if that constant changes the snapshot silently diverges.

**Fix:**
```rust
// room.rs, replace line 157-158:
use crate::game_loop::{ROUND_DURATION, ROUND_WARMUP};
let elapsed = state.round_start_time.map_or(0.0, |t| t.elapsed().as_secs_f64());
let live_elapsed = (elapsed - ROUND_WARMUP).max(0.0);
let remaining = (ROUND_DURATION - live_elapsed).max(0.0);
```

---

## Info

### IN-01: `handle_round_over` hardcodes HP reset to `[800, 800]` instead of `BoxingConfig.hp`

**File:** `engine/engine-core/src/game_loop.rs:303`

**Issue:** `state.hp = [800, 800]` is hardcoded at round reset. `RoomState::new` also hardcodes `hp: [800, 800]` (room.rs:74). If `BoxingConfig.hp` is ever set to a non-800 value, `RoomState.hp` and `BoxingState.hp` (which resets to `self.config.hp`) will diverge after round 1, causing the overlay to display wrong HP values while the plugin uses the correct starting HP for round-over decisions. The boxing plugin already avoids this with `s.hp = [self.config.hp; 2]`.

**Fix:** Thread the configured starting HP through to `RoomState`. The simplest approach is to add a `starting_hp: u32` field to `RoomState`, populate it from `BoxingConfig.hp` in `main.rs`, and use it in both `RoomState::new` and `handle_round_over`:

```rust
// game_loop.rs line 303 — replace hardcoded reset:
state.hp = [state.starting_hp, state.starting_hp];
```

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
