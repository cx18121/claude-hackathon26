---
phase: 07-dance-engine-protocol
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - engine/plugin-trait/src/lib.rs
  - engine/dance-plugin/src/lib.rs
  - engine/boxing-plugin/src/lib.rs
  - engine/engine-core/src/protocol.rs
  - engine/engine-core/src/room.rs
  - engine/engine-core/src/broadcast.rs
  - engine/engine-core/src/main.rs
  - engine/engine-core/src/room_manager.rs
  - engine/engine-core/src/game_loop.rs
  - engine/engine-core/tests/protocol_roundtrip.rs
  - engine/engine-core/tests/fixtures/msg_dance_beat.json
  - engine/engine-core/tests/fixtures/msg_dance_score.json
  - shared/protocol.ts
findings:
  critical: 2
  warning: 6
  info: 2
  total: 10
findings_resolved:
  critical: 2
  warning: 6
  info: 2
  total: 10
status: fixed
---

# Phase 07: Code Review Report

**Reviewed:** 2026-05-10
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This phase introduces `MsgDanceBeat`, `MsgDanceScore`, the `DancePlugin` implementation, a `game_type` field on `MsgJoined`, and the `spectator_snapshot` plumbing. The protocol structs, the roundtrip tests, and the TypeScript hand-maintained types are largely coherent. However, two blockers were found: dance beat/score messages are delivered to spectators only and never reach mobile players, and the two-player dance connect path has no guard against restarting a match that is already in progress. Six additional warnings cover a hardcoded HP reset value, a hardcoded max-HP constant in commentary, a `wins` field missing from the TypeScript type, a bigint/number type divergence in auto-generated bindings, a dead protocol struct that is never sent, and an immediately-discarded downcast pattern.

---

## Critical Issues

### CR-01: `GameEvent::Broadcast` never reaches mobile players — dance beats and scores are lost

**File:** `engine/engine-core/src/game_loop.rs:235-238`

**Issue:** `dispatch_events` handles `GameEvent::Broadcast` by writing only to `state.game_tx` (the slow-path broadcast channel). That channel is subscribed exclusively by spectator WebSocket handlers (`handle_spectator` in `main.rs`). Mobile player connections use a dedicated `mpsc::Sender<String>` (`player_tx`) that is never subscribed to `game_tx`. The dance plugin emits every `dance_beat` and `dance_score` event as `GameEvent::Broadcast`, so mobile players never receive the target pose or live scores during a match. The overlay (spectator) sees the messages; the players do not.

**Fix:**
```rust
GameEvent::Broadcast { payload } => {
    if let Ok(json) = serde_json::to_string(&payload) {
        let _ = state.game_tx.send(json.clone());
        // Also deliver to connected players (dance_beat / dance_score must reach mobile)
        for slot in &state.players {
            if let Some(tx) = &slot.tx {
                let _ = tx.try_send(json.clone());
            }
        }
    }
}
```

---

### CR-02: Two-player dance connect path restarts an already-running match when P2 joins late

**File:** `engine/engine-core/src/room.rs:267-298`

**Issue:** When only player 1 connects to a dance room, the solo-mode path (line 299) fires, starts the match (`round_start_time = Some(Instant::now())`), and sets `solo_mode = true`. When player 2 subsequently connects, the outer branch at line 267 (`players[0].connected && players[1].connected`) fires unconditionally — there is no `round_start_time.is_none()` guard. This second execution overwrites `round_start_time` with a fresh `Instant::now()` (resetting the round clock mid-game), resets both `reference_velocity` fields to `Some(0.0)`, flips `solo_mode` to `false` without resetting dance plugin state (corrupting the in-flight beat window), and sends a duplicate `match_start` and `round_start` to player 1. The solo-path at line 299 already carries the correct guard. The two-player path must be updated to match:

**Fix:**
```rust
if state.players[0].connected && state.players[1].connected
    && state.round_start_time.is_none()   // add this guard
{
    if state.plugin.requires_calibration() {
        // ... send calibration_start
    } else {
        // ... dance two-player start
    }
}
```

---

## Warnings

### WR-01: `handle_round_over` hardcodes HP reset to 800 regardless of plugin configuration

**File:** `engine/engine-core/src/game_loop.rs:310`

**Issue:** After a round ends (non-match-over path), the engine resets `state.hp = [800, 800]`. This value is hardcoded and ignores the `BoxingConfig.hp` field. A boxing room created with a different starting HP (e.g. `hp: 500` in test or a future variant) will have its engine-side HP snapshot reset to 800 at round boundaries. The boxing plugin's own `BoxingState.hp` is correctly reset via `on_round_reset` using `self.config.hp`, but `RoomState.hp` (used in spectator snapshots and `MsgGameState`) diverges.

**Fix:** Store the initial HP on `RoomState` at creation time and use it on reset:
```rust
// Add to RoomState:
pub initial_hp: u32,

// In handle_round_over replace line 310:
state.hp = [state.initial_hp, state.initial_hp];
```

---

### WR-02: `emit_commentary_hint` hardcodes `max_hp = 800.0` — percentage thresholds wrong for non-default HP configs

**File:** `engine/boxing-plugin/src/lib.rs:259`

**Issue:** The commentary hint function computes `defender_hp_pct` and `attacker_hp_pct` using a hardcoded `800.0` denominator (the comment acknowledges this). For any boxing room using a non-800 HP value, the `low_hp` (≤25%) and `comeback` (<30%) thresholds fire at incorrect absolute HP values. The function signature does not receive `self` or the config.

**Fix:**
```rust
fn emit_commentary_hint(
    events: &mut Vec<GameEvent>,
    s: &mut BoxingState,
    attacker: usize,
    defender: usize,
    _region: &BodyRegion,
    damage: u32,
    elapsed: f64,
    max_hp: u32,  // pass self.config.hp from caller
) {
    let max_hp = max_hp as f64;
    // ...
}
```

---

### WR-03: `shared/protocol.ts` `MsgGameState` is missing the `wins` field

**File:** `shared/protocol.ts:116-125`

**Issue:** The Rust `MsgGameState` struct includes `pub wins: (u32, u32)` (FIX-02, to prevent overlay win counter desync on reconnect). The hand-maintained TypeScript definition does not declare `wins`. Any TypeScript client accessing `msg.wins` receives `undefined` at runtime with no compile-time error. This silently breaks the FIX-02 overlay reconnect fix for TypeScript consumers using the typed interface.

**Fix:**
```typescript
export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  wins: [number, number];  // add this field (FIX-02)
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
  remaining_time: number;
  max_wins: number;
}
```

---

### WR-04: Auto-generated bindings use `bigint` for `beat`/`total_beats`; `shared/protocol.ts` uses `number`

**File:** `engine/engine-core/bindings/MsgDanceBeat.ts:3`, `engine/engine-core/bindings/MsgDanceScore.ts:3`

**Issue:** `ts-rs` generates `beat: bigint` and `total_beats: bigint` (from Rust `u64`). The canonical `shared/protocol.ts` correctly uses `beat: number` and `total_beats: number`. A frontend importing from the bindings directory gets a type incompatibility: comparisons like `msg.beat === 0` fail silently (`0n !== 0`), and passing `beat` to a function expecting `number` is a TypeScript type error. The two files are in `engine/engine-core/bindings/` and should not be consumed by application code, but there is no marker or comment warning consumers away.

**Fix:** Add `#[ts(type = "number")]` attribute on the `beat` and `total_beats` fields in `protocol.rs` so ts-rs generates `number`. Also add a file-level comment to the generated bindings stating they are not authoritative and `shared/protocol.ts` must be used instead.

---

### WR-05: `MsgPlayerDisconnected` is defined and tested but never constructed or sent

**File:** `engine/engine-core/src/protocol.rs:163-168`

**Issue:** The compiler confirms (`struct MsgPlayerDisconnected is never constructed` — visible in build artifact fingerprints) that this struct is dead code. The `PlayerDisconnect` room command clears the slot, logs, and broadcasts a `MsgLobbyUpdate`, but never sends a `player_disconnected` message to remaining clients. The struct, fixture (`msg_player_disconnected.json`), and roundtrip test (`protocol_roundtrip.rs:172-181`) all exist for a message that is never produced at runtime. Mobile clients expecting this message receive nothing when a player drops.

**Fix:** Either implement the send in `room.rs` `PlayerDisconnect` handler:
```rust
// Send to the remaining connected player
let remaining = 1 - slot;
if let Ok(json) = serde_json::to_string(&MsgPlayerDisconnected {
    msg_type: "player_disconnected".to_string(),
    player: (slot + 1) as u8,
}) {
    send_to_slot(state, remaining, &json);
}
```
Or remove the struct, fixture, and test as dead code.

---

### WR-06: `on_player_join` and `on_player_leave` in `BoxingPlugin` obtain a mutable downcast then discard it

**File:** `engine/boxing-plugin/src/lib.rs:204-213`

**Issue:** Both handlers call `state.downcast_mut::<BoxingState>().expect("...")` but bind the result to `_`. The `.expect()` is a panic-guard against type mismatch, but the mutable borrow obtained is unused. This is misleading — it reads as if the handlers interact with state, and the pattern could encourage a future contributor to rely on the downcast existing. If type-assertion is the only goal, the pattern should be explicit.

**Fix:**
```rust
fn on_player_join(&self, slot: u8, _state: &mut dyn Any) {
    tracing::info!("boxing: player {} joined", slot + 1);
}

fn on_player_leave(&self, slot: u8, _state: &mut dyn Any) {
    tracing::info!("boxing: player {} left", slot + 1);
}
```

---

## Info

### IN-01: `score_pose` early-returns 0.0 for frames with fewer than 33 keypoints with no log

**File:** `engine/dance-plugin/src/lib.rs:238-239`

**Issue:** `score_pose` returns `0.0` immediately if `player_frame.keypoints.len() < target.len()` (target is always 33). A malformed frame with 32 keypoints silently scores 0.0 for the entire beat without any log message, making it invisible in production traces. The downstream `n < 5` visibility guard would handle sparse data if the zip ran. Consider logging a debug warning or relaxing the guard to `zip` up to `min(len, 33)` and let the visibility check handle insufficient signal.

---

### IN-02: `beat_advances_target` test hardcodes expected wrap-around index `Some(0)` without deriving from `POSE_LIBRARY.len()`

**File:** `engine/dance-plugin/src/lib.rs:390`

**Issue:** The assertion `assert_eq!(s.current_target, Some(0))` relies on `POSE_LIBRARY.len() == 6` and `6 % 6 == 0`. If a pose is added or removed, the assertion either silently passes for the wrong reason or produces a confusing failure message. The expected value should be derived from the library length:

```rust
assert_eq!(
    s.current_target,
    Some(6 % poses::POSE_LIBRARY.len()),
    "after 6 beats, current_target must wrap to 6 % POSE_LIBRARY.len()"
);
```

---

_Reviewed: 2026-05-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
