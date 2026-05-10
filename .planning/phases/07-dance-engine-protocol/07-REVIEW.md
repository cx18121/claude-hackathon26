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
  critical: 4
  warning: 4
  info: 3
  total: 11
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-05-10
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

The phase 07 implementation adds a DancePlugin behind the existing GamePlugin trait, extends the wire protocol with `MsgDanceBeat` and `MsgDanceScore`, and wires two-player and solo dance rooms through the existing room lifecycle. The architecture is generally sound — the plugin trait design, calibration bypass, beat clock, and cosine-similarity scorer are all coherent.

Four blockers were found: the most critical is that `GameEvent::Broadcast` in `dispatch_events` only sends to the spectator broadcast channel (`game_tx`), not to connected players' outbound channels, which means `dance_beat` and `dance_score` events are never delivered to mobile clients. The second blocker is a missing `round_start_time.is_none()` guard on the two-player dance connect path, causing a spurious match restart when player 2 reconnects mid-match. The third blocker is a missing `wins` field in the TypeScript `MsgGameState` interface while the Rust struct includes it. The fourth blocker is a hardcoded HP value of `800` in `handle_round_over` that ignores the plugin's configured starting HP.

---

## Critical Issues

### CR-01: `GameEvent::Broadcast` Never Reaches Connected Players

**File:** `engine/engine-core/src/game_loop.rs:235-238`

**Issue:** In `dispatch_events`, the `GameEvent::Broadcast` arm sends only to `state.game_tx` — the spectator broadcast channel. Connected players each have a separate `mpsc::Sender<String>` in `state.players[slot].tx` that is not written. As a result, every `dance_beat` and `dance_score` message emitted by `DancePlugin::on_tick` is delivered to spectators and the overlay but never to the mobile clients (players). Players receive no beat announcements and no score updates during an entire dance match.

The `broadcast_all` helper in `room.rs:154-161` correctly fans out to both `game_tx` and each player's `tx`, but it is not used here.

**Fix:**
```rust
// game_loop.rs dispatch_events — replace the Broadcast arm:
GameEvent::Broadcast { payload } => {
    if let Ok(json) = serde_json::to_string(&payload) {
        let _ = state.game_tx.send(json.clone());
        for slot in &state.players {
            if let Some(tx) = &slot.tx {
                let _ = tx.try_send(json.clone());
            }
        }
    }
}
```
Alternatively, move `broadcast_all` into `game_loop.rs` (or expose it from `room.rs`) and call it here.

---

### CR-02: Two-Player Dance Connect Has No `round_start_time.is_none()` Guard

**File:** `engine/engine-core/src/room.rs:267-298`

**Issue:** The `PlayerConnect` handler has two code paths for starting a dance match without calibration. The solo path (line 299) correctly guards against re-starting with `state.round_start_time.is_none()`. The two-player path (lines 267-298) has no such guard.

If player 2 disconnects during an active dance match and reconnects, both conditions at line 267 (`state.players[0].connected && state.players[1].connected`) become true again. The handler then unconditionally overwrites `reference_velocity` for both players and sets `state.round_start_time = Some(Instant::now())`, restarting the match mid-round.

**Fix:**
```rust
// room.rs — add the guard to the two-player dance branch:
if state.players[0].connected && state.players[1].connected {
    if state.plugin.requires_calibration() {
        // ... calibration_start path unchanged
    } else if state.round_start_time.is_none() {  // <-- add this guard
        state.players[0].reference_velocity = Some(0.0);
        state.players[1].reference_velocity = Some(0.0);
        state.solo_mode = false;
        // ... match_start + round_start broadcast unchanged
        state.round_start_time = Some(Instant::now());
    }
}
```

---

### CR-03: `MsgGameState` Missing `wins` Field in TypeScript Protocol

**File:** `shared/protocol.ts:116-125`

**Issue:** The Rust `MsgGameState` struct (`engine/engine-core/src/protocol.rs:256-271`) includes a `wins: (u32, u32)` field added for FIX-02. The TypeScript interface at `shared/protocol.ts:116` is missing this field entirely:

```typescript
// current — wins is absent:
export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
  remaining_time: number;
  max_wins: number;
}
```

Any TypeScript overlay code that reads `MsgGameState` will see `wins` as `undefined`, causing the win counter overlay to show nothing (or a stale value after reconnect). The protocol roundtrip test at `tests/protocol_roundtrip.rs:84-86` asserts `wins` is present in the serialized JSON, confirming the Rust side sends it, but the TypeScript consumer cannot type-safely read it.

**Fix:**
```typescript
export interface MsgGameState {
  type: "game_state";
  tick: number;
  hp: [number, number];
  wins: [number, number];   // add — FIX-02: win counter survives reconnect
  poses: [PoseKeypoint[], PoseKeypoint[]];
  recent_hits: HitEvent[];
  high_latency: boolean;
  remaining_time: number;
  max_wins: number;
}
```

---

### CR-04: Hardcoded HP Reset `[800, 800]` in `handle_round_over` Ignores Plugin Config

**File:** `engine/engine-core/src/game_loop.rs:310`

**Issue:** `handle_round_over` resets the engine-mirrored HP with the literal `state.hp = [800, 800]` when starting the next round. `RoomState` has no reference to the plugin config's starting HP. If a boxing room is created with a non-default `BoxingConfig { hp: 500, ... }`, the engine's `state.hp` is reset to `800` each round while `BoxingState.hp` (managed by the plugin) is correctly reset to `500` by `on_round_reset`. The divergence means:

- `MsgGameState.hp` broadcasts incorrect HP values for rounds 2+ when non-default HP is used.
- `MsgRoundEnd.final_hp` at the start of the next round shows `800` instead of the configured value.
- The boxing test config in `room.rs:418` uses `hp: 800` so the bug is masked there.

The `RoomState` struct should store the starting HP, or the reset should not touch `state.hp` and let the plugin's `on_round_reset` be the sole source of truth (with the engine reading HP from the plugin state snapshot). The simplest fix:

**Fix:**
```rust
// room.rs RoomState — add field:
pub starting_hp: u32,

// room.rs RoomState::new — initialize:
starting_hp: 800, // default; callers with custom HP should pass config value

// game_loop.rs handle_round_over — replace:
state.hp = [state.starting_hp, state.starting_hp];
```
Longer term, consider removing the engine-mirrored `hp` field entirely and having the plugin expose HP through `spectator_snapshot`.

---

## Warnings

### WR-01: `emit_commentary_hint` Uses Hardcoded `max_hp = 800.0` Independent of Config

**File:** `engine/boxing-plugin/src/lib.rs:259-261`

**Issue:** The `emit_commentary_hint` function computes `defender_hp_pct` and `attacker_hp_pct` against a hardcoded `max_hp = 800.0`. The comment acknowledges this: "Could use self.config.hp but fn doesn't have self; 800 is the spec value." If `BoxingConfig.hp` is set to any other value, commentary thresholds (low_hp at 25%, comeback at 30%) will fire at incorrect HP levels.

**Fix:** Pass `config.hp` as a parameter from the `on_tick` caller:
```rust
emit_commentary_hint(
    &mut events, s, attacker_idx, defender_idx,
    &h.region, dmg, ctx.tick_info.elapsed_secs,
    self.config.hp,  // add
);

fn emit_commentary_hint(
    events: &mut Vec<GameEvent>,
    s: &mut BoxingState,
    attacker: usize,
    defender: usize,
    _region: &BodyRegion,
    damage: u32,
    elapsed: f64,
    max_hp: u32,  // add
) {
    let max_hp_f = max_hp as f64;
    // ... use max_hp_f instead of 800.0
```

---

### WR-02: `dance_snapshot` Message Type Is Not Defined in TypeScript Protocol

**File:** `shared/protocol.ts` (missing type), `engine/dance-plugin/src/lib.rs:207-219`

**Issue:** `DancePlugin::spectator_snapshot` returns a `serde_json::Value` with `"type": "dance_snapshot"`. This message is forwarded to spectators via `broadcast::send_snapshot` when they connect during an active dance round. There is no corresponding TypeScript interface in `shared/protocol.ts`, and `"dance_snapshot"` is not a member of `InboundServerMsg` or `ServerMessage`. Any overlay code receiving this message will not be able to dispatch it by type.

**Fix:** Add to `shared/protocol.ts`:
```typescript
export interface MsgDanceSnapshot {
  type: "dance_snapshot";
  beat: number;
  scores: [number, number];
}
```
And include it in `InboundServerMsg` and `ServerMessage` union types.

---

### WR-03: `MsgPlayerDisconnected` Is Defined and Protocol-Tested but Never Sent

**File:** `engine/engine-core/src/room.rs:374-394`

**Issue:** `MsgPlayerDisconnected` exists in `protocol.rs`, has a roundtrip fixture test, and is in `shared/protocol.ts`. However, the `RoomCmd::PlayerDisconnect` handler in `room.rs` never constructs or sends this message. Clients receive a `lobby_update` when a player disconnects but not a `player_disconnected` message. This breaks any mobile client or overlay logic that depends on the named event (e.g., showing a "Opponent disconnected" banner).

**Fix:** Add to the `PlayerDisconnect` arm in `handle_cmd`, before the lobby_update broadcast:
```rust
// Notify remaining player of the disconnect
let disconnected_player = (slot + 1) as u8;
if let Ok(json) = serde_json::to_string(&MsgPlayerDisconnected {
    msg_type: "player_disconnected".to_string(),
    player: disconnected_player,
}) {
    let opponent_idx = 1 - slot;
    send_to_slot(state, opponent_idx, &json);
    let _ = state.game_tx.send(json); // spectators
}
```

---

### WR-04: Multiple `RoundOver` Events in One Tick — Last One Wins, Earlier Ones Are Silently Dropped

**File:** `engine/engine-core/src/game_loop.rs:187, 215-217`

**Issue:** `dispatch_events` collects deferred `RoundOver` events using `Option<Option<u8>>`. If a plugin emits more than one `RoundOver` in a single `on_tick` return (malformed plugin or edge case), only the last one is processed:

```rust
GameEvent::RoundOver { winner } => {
    round_over_winner = Some(winner);  // overwrites previous
}
```

For a well-behaved plugin this does not matter, but there is no assertion, warning, or documentation that emitting multiple `RoundOver` events is forbidden. A plugin bug (e.g., boxing KO fires at the same tick as time expiry) would silently drop one of the events. The `GamePlugin` trait docs say "Emit `RoundOver` at most once per round" but this is only enforced by the plugin, not the engine.

**Fix:** Add a trace-level warning when a second `RoundOver` is seen in one tick:
```rust
GameEvent::RoundOver { winner } => {
    if round_over_winner.is_some() {
        tracing::warn!(
            "room {}: multiple RoundOver events in one tick — keeping last",
            state.code
        );
    }
    round_over_winner = Some(winner);
}
```

---

## Info

### IN-01: `score_pose` Short-Circuits on Frame Length But Not on Target Length Zero

**File:** `engine/dance-plugin/src/lib.rs:237-239`

**Issue:** `score_pose` returns `0.0` early if `player_frame.keypoints.len() < target.len()`. If `target` is empty (a malformed `POSE_LIBRARY` entry with zero keypoints), the function proceeds into the loop, accumulates nothing, then hits the `n < 5` guard and returns `0.0`. This is safe but the early-exit comment ("not enough visible landmarks") is misleading since an empty target would produce the same result. Not a current defect given the pose library is static, but worth a guard.

---

### IN-02: `OutboundMobileMsg` Union in TypeScript Includes Server-Only Types

**File:** `shared/protocol.ts:46-52`

**Issue:** The TypeScript `OutboundMobileMsg` type (messages sent from mobile to server) includes `MsgPong` which is a server-to-mobile message defined at line 65. `MsgPong` is the server's reply to a `MsgPing` and should never be sent by the mobile client. The union should be `InboundMobileMsg` (join, pose_frame, calibration_done, ping, pong) from the client perspective. As structured, `MsgPong` appearing in `OutboundMobileMsg` is semantically wrong — pong is mobile-to-server, but the naming and placement in the server-to-mobile section is confusing.

---

### IN-03: Boxing `on_player_join` and `on_player_leave` Downcast State Then Immediately Discard It

**File:** `engine/boxing-plugin/src/lib.rs:203-213`

**Issue:** Both `on_player_join` and `on_player_leave` downcast the state with `.expect(...)` and assign the result to `let _ = ...`, then only log. The downcast succeeds or panics — there is no use of the downcast value. The downcast exists solely as a type guard that will panic rather than silently proceed if the wrong state is passed. This is a valid defensive pattern, but the `let _ =` binding is misleading — it looks like the code intended to use the state and forgot to. Consider removing the downcast if no state mutation is needed, or adding a comment explaining the intent.

---

_Reviewed: 2026-05-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
