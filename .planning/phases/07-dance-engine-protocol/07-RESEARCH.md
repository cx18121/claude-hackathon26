# Phase 7: Dance Engine + Protocol - Research

**Researched:** 2026-05-09
**Domain:** Rust game engine plugin trait extension, wire protocol structs, ts-rs codegen
**Confidence:** HIGH

## Summary

Phase 7 extends the existing `GamePlugin` trait with three new methods (`game_type()`, `requires_calibration()`, `spectator_snapshot()`), wires the calibration skip path into the room actor, adds a dance state snapshot to the spectator join flow, and introduces typed `MsgDanceBeat` / `MsgDanceScore` structs in both Rust and TypeScript. All infrastructure for this phase already exists in the codebase — the dance plugin, room actor, spectator snapshot mechanism, and ts-rs export pipeline are all operational. Phase 7 is entirely additive.

The calibration handshake is currently unconditional in `room.rs::handle_cmd(PlayerConnect)`. The skip requires a `plugin.requires_calibration()` check at the two points where `MsgCalibrationStart` is currently sent (two-player path and solo path). The spectator dance snapshot plugs into the `GetSnapshot` / `send_snapshot` path already established by FIX-02.

TypeScript generation is fully automated: `cargo test` from `engine/` exports all `#[ts(export)]` structs to `shared/` via `TS_RS_EXPORT_DIR = ../../shared` in `.cargo/config.toml`. No manual script needed; the Python `gen_protocol.py` is deprecated.

**Primary recommendation:** Follow the locked decisions in CONTEXT.md exactly — add the three trait methods with defaults, override in DancePlugin, check `requires_calibration()` in `room.rs` before sending `MsgCalibrationStart`, add dance snapshot to `GetSnapshot` / `build_snapshot`, and add the two Rust protocol structs + regenerate TypeScript.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Calibration skip mechanism**
Add `fn requires_calibration(&self) -> bool { true }` to `GamePlugin` trait with a default returning `true`. `DancePlugin` overrides to return `false`. Engine checks this once at the point it would send `calibration_start` and branches: if `false`, skip the handshake and proceed to warmup/match start immediately once both players are connected. No string comparison in engine core — the plugin signals its own need.

**D-02 — Spectator snapshot API**
Add `fn spectator_snapshot(&self, state: &dyn Any) -> Option<serde_json::Value>` to `GamePlugin` trait, default returning `None`. `DancePlugin` implements it to return the current beat number and per-player cumulative scores (same shape as a `dance_score` wire message but with `type: "dance_snapshot"`). Engine calls this on spectator WS connect mid-match; if `Some(payload)`, sends that payload to the new spectator before adding them to the broadcast set.

**D-03 — TypeScript protocol sync**
Add typed `MsgDanceBeat` and `MsgDanceScore` structs to `engine-core/src/protocol.rs` with `#[derive(Serialize, Deserialize, TS)]`. Run ts-rs export via `cargo test` from engine/ to regenerate `shared/protocol.ts`. Single source of truth stays in Rust. The Python gen script comment in `protocol.ts` should be updated to reflect that types now come from Rust.

**D-04 — Dance protocol struct shapes**
`MsgDanceBeat` fields: `beat: u64`, `total_beats: u64`, `target_pose: Vec<[f64; 4]>` (matches existing `json!()` payload — `[x, y, z, visibility]` per keypoint). `MsgDanceScore` fields: `beat: u64`, `scores: [f64; 2]`. These mirror the existing `json!()` payloads exactly so no DancePlugin code changes are needed.

**D-05 — game_type field in MsgJoined**
`MsgJoined` gains `game_type: String`. Engine populates it from `room.game_type` at join time. The existing spectator snapshot message also gains `game_type`. This covers DANCE-02 fully.

### Claude's Discretion

- Exact name and location of the ts-rs export script/command
- Whether `MsgDanceBeat.target_pose` uses `Vec<[f64; 4]>` or a named struct `PoseKeypointArray` — either is fine as long as the wire format stays `[[x,y,z,v], ...]`
- Whether `spectator_snapshot` returns a plain `dance_score`-shaped payload with an added `type` field, or a dedicated `MsgDanceSnapshot` struct

### Deferred Ideas (OUT OF SCOPE)

- Mobile calibration skip UI (`game_type === "dance"` → skip calibration waiting screen) — Phase 9 (DIMPL-05)
- Dance DESIGN.md section and target pose visual spec — Phase 8 (DDES-01 through DDES-03)
- Dance overlay HUD, Pixi.js target skeleton, dance match end screen — Phase 9
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DANCE-01 | `GamePlugin` trait has a `game_type() -> &'static str` method with default returning `"unknown"`; BoxingPlugin returns `"boxing"`, DancePlugin returns `"dance"` | Trait in `plugin-trait/src/lib.rs`; add method alongside existing defaults (`max_wins`, `on_player_join`, etc.) |
| DANCE-02 | `RoomHandle` stores `game_type: String`; `MsgJoined` includes `game_type: String`; spectator snapshot includes `game_type` | `RoomHandle.game_type` already exists in `room_manager.rs`; `MsgJoined` in `protocol.rs` needs new field; `build_snapshot` in `room.rs` needs `game_type` added; `room.game_type` needs to be stored in `RoomState` |
| DANCE-03 | `MsgDanceBeat` and `MsgDanceScore` added to `shared/protocol.ts` with full TypeScript types | Add structs to `protocol.rs` with `#[derive(Serialize, Deserialize, TS)]` + `#[ts(export)]`; run `cargo test` to regenerate |
| DANCE-04 | Dance plugin signals calibration not needed; engine skips calibration handshake for dance rooms | Add `requires_calibration()` to trait; check in `room.rs::handle_cmd(PlayerConnect)` before sending `MsgCalibrationStart` |
| DANCE-05 | On spectator join mid-dance, engine sends dance snapshot before switching to live broadcast | Add `spectator_snapshot()` to trait; call in `room.rs::build_snapshot` (or in `handle_cmd(GetSnapshot)`); send in `broadcast::send_snapshot` |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `game_type()` trait method | API / Backend (Rust plugin trait) | — | Pure Rust trait extension; no transport layer |
| `requires_calibration()` trait method | API / Backend (Rust plugin trait) | — | Plugin signals its own behavior to engine |
| Calibration skip branch | API / Backend (room actor) | — | Engine decision point lives in `room.rs::handle_cmd` |
| `spectator_snapshot()` trait method | API / Backend (Rust plugin trait) | — | Plugin provides its own state summary |
| Dance snapshot delivery | API / Backend (room actor + broadcast) | — | `build_snapshot` + `send_snapshot` already handle this pattern |
| `MsgJoined.game_type` field | API / Backend (Rust protocol struct) | TypeScript (shared/protocol.ts) | Rust is source of truth; TS generated via ts-rs |
| `MsgDanceBeat` / `MsgDanceScore` structs | API / Backend (Rust protocol struct) | TypeScript (shared/protocol.ts) | Same ts-rs generation pattern |
| Golden-file fixture updates | API / Backend (test fixtures) | — | `tests/fixtures/msg_joined.json` must gain `game_type` field |

---

## Standard Stack

### Core (already in use — no new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ts-rs` | 12.0.1 | Rust→TypeScript type generation | Already in `engine-core/Cargo.toml`; used by all protocol structs |
| `serde` + `serde_json` | 1.0.228 / 1.0.149 | JSON serialization of protocol structs | Established pattern; all protocol structs derive `Serialize, Deserialize` |
| `plugin-trait` | path dep | `GamePlugin` trait crate | New methods added here |

All three dependencies are already in the workspace. No `cargo add` needed for Phase 7.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/Cargo.toml]

**ts-rs export command (Claude's discretion — verified):**
```bash
cd /Users/charliexue/School/Comps/spectre/engine
cargo test
```
`TS_RS_EXPORT_DIR = ../../shared` in `.cargo/config.toml` routes all `#[ts(export)]` output to `shared/`. This is not a separate feature flag — it runs as part of the normal test suite.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/.cargo/config.toml]

---

## Architecture Patterns

### System Architecture Diagram

```
POST /rooms?game=dance
        |
        v
  create_room()  →  plugins["dance"] = Arc<DancePlugin>
        |
        v
  RoomHandle { game_type: "dance", ... }
        |
        +--> RoomState { ... }   [no game_type field yet — must add]

Player WS connect (MsgJoin)
        |
        v
  handle_cmd(PlayerConnect)
        |
        +--> plugin.requires_calibration()?
             |  false (DancePlugin)
             v
             skip MsgCalibrationStart
             wait for both players connected
             send MsgMatchStart + MsgRoundStart directly
             |  true (BoxingPlugin — current behavior)
             v
             send MsgCalibrationStart (unchanged)

Spectator WS connect
        |
        v
  handle_cmd(GetSnapshot)
        |
        v
  build_snapshot(state)
        +--> game_type from state.game_type
        +--> plugin.spectator_snapshot(state)?
             |  Some(payload) — DancePlugin mid-round
             v  sends dance_snapshot to spectator
             |  None — BoxingPlugin or pre-round dance
             v  skips
        |
        v
  broadcast::send_snapshot → spectator WS

MsgJoined sent to player after connect confirmed:
  { type:"joined", room_code, player_slot, opponent_connected, game_type }
  ↑ game_type comes from RoomState.game_type (new field)
```

### Recommended Project Structure (unchanged — additive only)

```
engine/
├── plugin-trait/src/lib.rs     # Add 3 new trait methods
├── dance-plugin/src/lib.rs     # Override requires_calibration, spectator_snapshot
├── boxing-plugin/src/lib.rs    # Add game_type() = "boxing" (explicit override)
└── engine-core/src/
    ├── protocol.rs             # Add MsgDanceBeat, MsgDanceScore; extend MsgJoined
    ├── room.rs                 # Calibration skip + dance snapshot in build_snapshot
    │                           # + game_type field on RoomState
    ├── room_manager.rs         # RoomHandle.game_type already present (no change)
    └── main.rs                 # MsgJoined construction needs game_type
shared/
└── protocol.ts                 # Regenerated by cargo test
engine/engine-core/tests/
└── fixtures/msg_joined.json    # Must add game_type field
```

### Pattern 1: Adding a trait method with a default (PLUG-01 pattern)

**What:** All new `GamePlugin` methods follow the established pattern — `&self` receiver, synchronous, no generics, default no-op or default value.

**Example:**
```rust
// Source: engine/plugin-trait/src/lib.rs (established pattern)

// Existing examples of this pattern:
fn max_wins(&self) -> u32 { 2 }
fn on_player_join(&self, _slot: u8, _state: &mut dyn Any) {}

// New methods follow the same form:
fn game_type(&self) -> &'static str { "unknown" }
fn requires_calibration(&self) -> bool { true }
fn spectator_snapshot(&self, _state: &dyn Any) -> Option<serde_json::Value> { None }
```

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/plugin-trait/src/lib.rs]

### Pattern 2: Protocol struct with ts-rs export

**What:** All outbound message types in `protocol.rs` use `#[derive(Serialize, Deserialize, TS)]` + `#[ts(export)]` + a `default_type_*` function.

**Example (existing, to replicate):**
```rust
// Source: engine/engine-core/src/protocol.rs

fn default_type_round_start() -> String { "round_start".to_string() }

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgRoundStart {
    #[serde(rename = "type", default = "default_type_round_start")]
    pub msg_type: String,
    pub round_number: u32,
}
```

For `MsgDanceBeat` and `MsgDanceScore`:
```rust
// New structs following the same pattern:

fn default_type_dance_beat() -> String { "dance_beat".to_string() }

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceBeat {
    #[serde(rename = "type", default = "default_type_dance_beat")]
    pub msg_type: String,
    pub beat: u64,
    pub total_beats: u64,
    pub target_pose: Vec<[f64; 4]>,
}

fn default_type_dance_score() -> String { "dance_score".to_string() }

#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[ts(export)]
pub struct MsgDanceScore {
    #[serde(rename = "type", default = "default_type_dance_score")]
    pub msg_type: String,
    pub beat: u64,
    pub scores: [f64; 2],
}
```

The wire shape of `target_pose` as `Vec<[f64; 4]>` matches exactly what `DancePlugin::on_tick` already emits:
```rust
// Source: engine/dance-plugin/src/lib.rs line ~106
"target_pose": first_target.keypoints.iter()
    .map(|kp| [kp.x, kp.y, kp.z, kp.visibility])
    .collect::<Vec<_>>(),
```

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/dance-plugin/src/lib.rs]

### Pattern 3: Calibration skip branch in room.rs

**What:** `handle_cmd(PlayerConnect)` currently sends `MsgCalibrationStart` unconditionally when players connect. The skip requires consulting `plugin.requires_calibration()`.

**Current code (both-player path, room.rs lines 243-260):**
```rust
if state.players[0].connected && state.players[1].connected {
    use crate::protocol::MsgCalibrationStart;
    if let Ok(json) = serde_json::to_string(&MsgCalibrationStart { ... }) {
        send_to_slot(state, 0, &json);
        send_to_slot(state, 1, &json);
    }
} else if solo_mode && slot == 0 && state.round_start_time.is_none() {
    // send to slot 0 only
}
```

**After patch:** Wrap the body of each branch with `if state.plugin.requires_calibration()`. When `false`, immediately trigger the match start (same code as `CalibrationDone` handler: set `solo_mode`, broadcast `MsgMatchStart`, broadcast `MsgRoundStart`, set `round_start_time`).

**Key insight:** For dance, `on_calibration_complete` is a no-op (the comment in dance-plugin confirms this — "D-05 comment already present"). When `requires_calibration() == false`, the engine must still set `reference_velocity` to a sentinel (`Some(0.0)` or `Some(1.0)`) on both player slots so that `game_loop.rs::game_tick`'s `calibrated_ok` check (which uses `reference_velocity.is_some()`) passes. Alternatively, `game_tick` must also consult `plugin.requires_calibration()` to skip the calibration gate. This is the most important non-obvious integration point.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/src/game_loop.rs lines 49-56 and room.rs lines 269-303]

### Pattern 4: Spectator snapshot extension

**What:** `build_snapshot` in `room.rs` currently returns `RoomSnapshot { lobby_update, round_start, game_state }`. The dance snapshot payload must be sent before the spectator enters the live broadcast. The existing `send_snapshot` in `broadcast.rs` handles the send order.

The spectator snapshot should:
1. Only be called if `state.round_start_time.is_some()` (match in progress) — same guard as existing game_state
2. Only return `Some(payload)` from `DancePlugin::spectator_snapshot` if `s.round_started && !s.round_ended` (per CONTEXT.md specifics)
3. Be added to `RoomSnapshot` as an `Option<serde_json::Value>` field, then sent in `send_snapshot` after `game_state` but before the broadcast loop

`RoomState` needs a `game_type: String` field to be passed into `build_snapshot` (so it can include game_type in the snapshot and in `MsgJoined`). Currently `game_type` is only on `RoomHandle`, not `RoomState`. **This is a key gap.**

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/src/room.rs — `RoomState` struct has no `game_type` field]

### Pattern 5: MsgJoined.game_type population

`MsgJoined` is constructed in `main.rs::handle_player` at line 531. The `game_type` comes from `room_manager.get_room_game_type(&room_code)` — but this is already called once for the room page handler. For the player WS handler, we need to either:
- Call `get_room_game_type` again (safe, it just does a DashMap read), or
- Pass game_type through `ConnectResult`

The simplest approach: add `game_type: String` to `ConnectResult` (populated from `state.game_type` in `RoomState`) and use it when constructing `MsgJoined`.

### Anti-Patterns to Avoid

- **String comparison in engine core:** Do not check `state.game_type == "dance"` in engine core to decide behavior. Use `plugin.requires_calibration()` and `plugin.spectator_snapshot()` — the plugin signals its own needs (GAME2-02).
- **Skipping the `calibrated_ok` gate in game_loop:** `game_tick` checks `reference_velocity.is_some()` for both players. If calibration is skipped, the engine must either set sentinel velocities or update the gate to consult `requires_calibration()`. Not addressing this will cause dance rooms to never tick.
- **Calling `plugin.spectator_snapshot` while DashMap guard is held:** Follow the existing pattern — snapshot is built inside `handle_cmd(GetSnapshot)` which runs in the room actor (no DashMap lock held).
- **Not updating `msg_joined.json` fixture:** The golden-file roundtrip test for `MsgJoined` will fail if the fixture does not include `game_type`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript type sync | Manual TS interface edits | ts-rs `#[ts(export)]` + `cargo test` | Already configured; Python gen script is deprecated |
| Calibration-less match start | Custom dance-specific path | `requires_calibration()` plugin method | Keeps engine core game-agnostic (GAME2-02) |
| Spectator state delivery | Custom dance WebSocket handler | Extend `RoomSnapshot` + existing `send_snapshot` | FIX-02 pattern already handles ordering correctly |
| game_type routing | `game_type == "dance"` string checks in engine core | `GamePlugin` trait methods | Plugin-signals-own-behavior pattern; avoids open/closed violation |

---

## Runtime State Inventory

Phase 7 is a code-only extension to a running in-memory server. No persistent storage, no OS-registered state, no renamed strings.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — server is in-memory; no database | None |
| Live service config | None — no external service config | None |
| OS-registered state | None | None |
| Secrets/env vars | None relevant to this phase | None |
| Build artifacts | `shared/protocol.ts` — regenerated by `cargo test` | Run after struct additions |

---

## Common Pitfalls

### Pitfall 1: Dance rooms never tick because `calibrated_ok` gate is not bypassed

**What goes wrong:** `game_loop::game_tick` checks `state.players[i].reference_velocity.is_some()` for both players before allowing match to proceed. If dance calibration is skipped (no `CalibrationDone` sent by client), `reference_velocity` remains `None` for both slots, so `calibrated_ok == false` and `game_tick` returns early every tick. The match never starts.

**Why it happens:** The calibration gate was written for boxing where every player always calibrates. The gate doesn't know about `requires_calibration()`.

**How to avoid:** One of two approaches:
1. In `room.rs::handle_cmd(PlayerConnect)`, when `!plugin.requires_calibration()` and both players are connected, set `state.players[i].reference_velocity = Some(0.0)` for all slots as a sentinel before triggering match start.
2. Add a `plugin.requires_calibration()` check to `game_tick` alongside the `calibrated_ok` check: if `!plugin.requires_calibration()`, treat `calibrated_ok` as `true`.

Approach 1 is simpler and keeps `game_tick` unmodified.

**Warning signs:** Dance room actor loop runs, ticks fire, but `game_tick` always returns at the early-exit check; dance plugin `on_tick` never called.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/src/game_loop.rs lines 49-58]

### Pitfall 2: `RoomState` has no `game_type` — `MsgJoined.game_type` population requires it

**What goes wrong:** `game_type` is stored on `RoomHandle` (in `room_manager.rs`), not on `RoomState` (in `room.rs`). `handle_cmd(PlayerConnect)` sends `MsgJoined` using data from `ConnectResult`, which is built from `RoomState` fields. There is no current path to carry `game_type` from `RoomHandle` into `MsgJoined`.

**How to avoid:** Add `game_type: String` to `RoomState` (populated at `RoomState::new`) and to `ConnectResult`. Pass it from `RoomState` into `ConnectResult` in `handle_cmd(PlayerConnect)`, then use it in `main.rs::handle_player` when constructing `MsgJoined`.

Alternatively, call `app.rooms.get_room_game_type(&room_code)` a second time in `handle_player` — this is safe (DashMap read, not held across await) and avoids changing `ConnectResult`.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/src/room.rs — `RoomState::new` signature and fields]

### Pitfall 3: `build_snapshot` cannot call `plugin.spectator_snapshot` without dance state

**What goes wrong:** `spectator_snapshot(&self, state: &dyn Any) -> Option<Value>` takes the plugin's `Box<dyn Any + Send>` state. In `build_snapshot`, the function has `&RoomState` which includes `plugin_state: Box<dyn Any + Send>`. This works — `&*state.plugin_state` is a valid `&dyn Any`. However, `build_snapshot` must be called from `handle_cmd(GetSnapshot)` which runs inside the room actor with full `&RoomState` access.

**How to avoid:** Add `Option<serde_json::Value>` to `RoomSnapshot` struct. In `build_snapshot`, call `state.plugin.spectator_snapshot(&*state.plugin_state)` and store the result. In `broadcast::send_snapshot`, send this payload (if `Some`) after `game_state`, before entering the live broadcast loop.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/src/room.rs `build_snapshot` function; `RoomSnapshot` struct]

### Pitfall 4: Golden-file fixture for `MsgJoined` will break without update

**What goes wrong:** `tests/protocol_roundtrip.rs::msg_joined_roundtrip` reads `tests/fixtures/msg_joined.json` and checks that `room_code`, `player_slot`, and `opponent_connected` round-trip. Once `MsgJoined` gains `game_type: String`, the fixture JSON must include `game_type` or deserialization will fail (serde will error on missing required field unless a default is provided).

**How to avoid:** Add `#[serde(default = "default_type_game_type_unknown")]` to the `game_type` field (making it optional in deserialization with default `"unknown"`), OR update `tests/fixtures/msg_joined.json` to include `"game_type": "boxing"`, AND add a roundtrip assertion for `game_type`. Add a roundtrip test for `MsgDanceBeat` and `MsgDanceScore` with new fixtures.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/engine-core/tests/protocol_roundtrip.rs and tests/fixtures/msg_joined.json]

### Pitfall 5: `target_pose: Vec<[f64; 4]>` and ts-rs array-of-array export

**What goes wrong:** ts-rs may render `Vec<[f64; 4]>` as `Array<[number, number, number, number]>` or `[number, number, number, number][]`. Both are valid TypeScript and correct — the concern is that the wire format matches the existing `json!()` output from `DancePlugin::on_tick`.

**How to avoid:** The existing `json!()` payload in dance-plugin produces `[[x,y,z,v], [x,y,z,v], ...]` — an array of 4-element arrays. `Vec<[f64; 4]>` in Rust serializes to exactly this shape. Verify with a roundtrip test fixture after adding the struct.

[VERIFIED: /Users/charliexue/School/Comps/spectre/engine/dance-plugin/src/lib.rs lines 104-109]

---

## Code Examples

### Adding trait methods to `GamePlugin` (plugin-trait/src/lib.rs)

```rust
// Source: established pattern from plugin-trait/src/lib.rs

pub trait GamePlugin: Send + Sync {
    // ... existing methods ...

    /// Returns the game type string for wire protocol and room metadata.
    /// Default "unknown" so the engine is never broken by a plugin that omits this.
    fn game_type(&self) -> &'static str { "unknown" }

    /// Returns false if this game does not require pose calibration before match start.
    /// Engine skips the calibration_start / calibration_done handshake when false.
    fn requires_calibration(&self) -> bool { true }

    /// Returns a JSON snapshot of current game state for a late-joining spectator.
    /// Called once on spectator WS connect during an active match.
    /// Return None if no mid-match state is meaningful (e.g., before first round starts).
    fn spectator_snapshot(&self, _state: &dyn Any) -> Option<serde_json::Value> { None }
}
```

### DancePlugin overrides (dance-plugin/src/lib.rs)

```rust
impl GamePlugin for DancePlugin {
    // ... existing methods ...

    fn game_type(&self) -> &'static str { "dance" }

    fn requires_calibration(&self) -> bool { false }

    fn spectator_snapshot(&self, state: &dyn Any) -> Option<serde_json::Value> {
        let s = state.downcast_ref::<DanceState>()
            .expect("dance plugin: spectator_snapshot type mismatch");
        // Only return snapshot if a round is actively in progress
        if !s.round_started || s.round_ended {
            return None;
        }
        Some(serde_json::json!({
            "type": "dance_snapshot",
            "beat": s.beats_scored,
            "scores": [s.scores[0], s.scores[1]],
        }))
    }
}
```

### BoxingPlugin game_type override (boxing-plugin/src/lib.rs)

```rust
fn game_type(&self) -> &'static str { "boxing" }
// requires_calibration uses default true — no override needed
```

### Calibration skip in room.rs handle_cmd(PlayerConnect)

```rust
// Current code (both-player path):
if state.players[0].connected && state.players[1].connected {
    if state.plugin.requires_calibration() {
        // existing: send calibration_start to both
        let json = serde_json::to_string(&MsgCalibrationStart { ... }).unwrap();
        send_to_slot(state, 0, &json);
        send_to_slot(state, 1, &json);
    } else {
        // dance: skip calibration; set sentinel velocities and start match
        state.players[0].reference_velocity = Some(0.0);
        state.players[1].reference_velocity = Some(0.0);
        state.solo_mode = false;
        // ... broadcast MsgMatchStart, MsgRoundStart, set round_start_time ...
    }
}
// Same guard needed in the solo path
```

### RoomSnapshot extension (room.rs)

```rust
pub struct RoomSnapshot {
    pub lobby_update: MsgLobbyUpdate,
    pub round_start: Option<crate::protocol::MsgRoundStart>,
    pub game_state: Option<MsgGameState>,
    pub game_type: String,                   // new: DANCE-02
    pub plugin_snapshot: Option<serde_json::Value>, // new: DANCE-05
}
```

In `build_snapshot`:
```rust
let plugin_snapshot = if state.round_start_time.is_some() {
    state.plugin.spectator_snapshot(&*state.plugin_state)
} else {
    None
};
RoomSnapshot {
    lobby_update: ...,
    round_start: ...,
    game_state: ...,
    game_type: state.game_type.clone(),
    plugin_snapshot,
}
```

### send_snapshot extension (broadcast.rs)

```rust
// After sending game_state and before returning true:
if let Some(snapshot_payload) = snapshot.plugin_snapshot {
    if let Ok(json) = serde_json::to_string(&snapshot_payload) {
        if ws_sink.send(Message::Text(json.into())).await.is_err() {
            return false;
        }
    }
}
```

### MsgJoined update and game_type population (main.rs)

```rust
// Get game_type — either from ConnectResult or a second DashMap read
let game_type = app.rooms.get_room_game_type(&room_code)
    .unwrap_or_else(|| "unknown".to_string());

if let Ok(json) = serde_json::to_string(&MsgJoined {
    msg_type: "joined".to_string(),
    room_code: room_code.clone(),
    player_slot: (connect_result.slot + 1) as u8,
    opponent_connected: connect_result.opponent_connected,
    game_type,  // new field
}) {
    let _ = player_tx.send(json).await;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python `gen_protocol.py` for TypeScript types | ts-rs `#[derive(TS)]` + `cargo test` | Phase 1 (D-04) | Rust is single source of truth; Python script is deprecated stub that exits 1 |
| Calibration always required | `requires_calibration()` plugin method | Phase 7 (this phase) | Dance skips handshake; Boxing unchanged |
| Boxing-specific snapshot | `spectator_snapshot()` plugin method | Phase 7 (this phase) | Each plugin provides its own spectator state |

**Deprecated/outdated:**
- `scripts/gen_protocol.py`: Prints error and exits 1. Do not reference it in plans or documentation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Setting `reference_velocity = Some(0.0)` as a sentinel is the cleanest way to bypass the `calibrated_ok` gate in `game_tick` | Pitfall 1 / Code Examples | If `game_tick` or other code compares `reference_velocity` values numerically (not just `.is_some()`), sentinel 0.0 might cause unexpected behavior; but boxing clamps to [0.5, 15.0] and dance ignores it entirely | 
| A2 | `get_room_game_type` called a second time in `handle_player` is safe and non-blocking | Code Examples / MsgJoined | DashMap read is O(1) non-blocking; the guard is not held across await — verified pattern in this codebase |

**If this table is empty:** All claims were verified or cited. A1 and A2 are the only assumptions.

---

## Open Questions

1. **Sentinel velocity value for dance calibration skip**
   - What we know: `game_tick` uses `reference_velocity.is_some()` (not the value) for `calibrated_ok`. `DancePlugin::on_calibration_complete` is a no-op — it never reads `ref_vel`. `BoxingPlugin` clamps `ref_vel` to [0.5, 15.0] but only in its own `on_calibration_complete`.
   - What's unclear: Whether any other engine code path reads `reference_velocity` numerically (e.g., future bot injection, scoring, commentary hints).
   - Recommendation: Use `Some(0.0)` — it clearly signals "calibration bypassed" and matches the no-op dance behavior. Document the intent in a comment.

2. **`game_type` propagation path to `MsgJoined`**
   - What we know: Two options — add `game_type` to `RoomState` and `ConnectResult`, or do a second `get_room_game_type` call in `handle_player`. Both are correct.
   - What's unclear: Which is preferred for minimal diff size.
   - Recommendation: Second `get_room_game_type` call is lower-diff and avoids threading `game_type` through `ConnectResult`. If `RoomState.game_type` is needed anyway for `build_snapshot`, add it there; the `handle_player` call then becomes trivially safe.

---

## Environment Availability

Phase 7 is code-only; no external services needed beyond the existing Rust toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust / cargo | All Rust compilation | ✓ | (project already builds) | — |
| ts-rs codegen | `shared/protocol.ts` regeneration | ✓ | 12.0.1 in Cargo.toml | — |

[VERIFIED: Cargo.toml presence; no new tooling required]

---

## Sources

### Primary (HIGH confidence)
- `/Users/charliexue/School/Comps/spectre/engine/plugin-trait/src/lib.rs` — Full `GamePlugin` trait; all method signatures and doc patterns
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/protocol.rs` — All existing protocol structs; ts-rs derive pattern; `MsgJoined` current shape
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/room.rs` — `RoomState`, `RoomSnapshot`, `handle_cmd`, `build_snapshot`, calibration logic
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/game_loop.rs` — `game_tick` calibration gate; `calibrated_ok` logic
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/main.rs` — `MsgJoined` construction; `handle_player` flow; `AppState.plugins` map
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/room_manager.rs` — `RoomHandle.game_type`; `get_room_game_type`
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/src/broadcast.rs` — `send_snapshot`; spectator forward loop
- `/Users/charliexue/School/Comps/spectre/engine/dance-plugin/src/lib.rs` — `DanceState` fields; `DancePlugin::on_tick` payload shapes; `TOTAL_BEATS` constant
- `/Users/charliexue/School/Comps/spectre/engine/.cargo/config.toml` — `TS_RS_EXPORT_DIR` pointing to `../../shared`
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/tests/protocol_roundtrip.rs` — Golden-file test structure; fixture format
- `/Users/charliexue/School/Comps/spectre/engine/engine-core/tests/fixtures/msg_joined.json` — Current fixture (needs update)
- `/Users/charliexue/School/Comps/spectre/shared/protocol.ts` — Current TypeScript protocol; MsgJoined shape; no dance types yet
- `/Users/charliexue/School/Comps/spectre/.planning/phases/07-dance-engine-protocol/07-CONTEXT.md` — All locked decisions (D-01 through D-05)

### Secondary (MEDIUM confidence)
- `/Users/charliexue/School/Comps/spectre/scripts/gen_protocol.py` — Confirmed deprecated (exits 1 with error); ts-rs is active path

---

## Metadata

**Confidence breakdown:**
- Plugin trait extension: HIGH — full trait source read; pattern is well-established
- Calibration skip mechanism: HIGH — room.rs logic fully read; pitfall identified and verified
- Spectator snapshot extension: HIGH — `RoomSnapshot`, `build_snapshot`, `send_snapshot` all verified
- Protocol structs + ts-rs: HIGH — Cargo.toml, .cargo/config.toml, and gen mechanism all verified
- `game_type` propagation: HIGH — both paths verified; gap (no `game_type` on `RoomState`) explicitly identified
- TypeScript shape: HIGH — existing `json!()` payloads in DancePlugin match D-04 field definitions exactly

**Research date:** 2026-05-09
**Valid until:** 2026-06-09 (codebase is stable; no external dependencies)
