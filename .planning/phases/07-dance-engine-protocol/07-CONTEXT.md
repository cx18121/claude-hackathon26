# Phase 7: Dance Engine + Protocol - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 wires the existing DancePlugin into the running engine: adds `game_type` to the plugin trait and `MsgJoined`, adds dance-specific protocol message types in Rust and TypeScript, implements calibration skip for dance rooms, and sends a dance state snapshot to spectators on join.

**In scope:**
- `game_type() -> &'static str` trait method on `GamePlugin` (default "unknown"; Boxing="boxing", Dance="dance")
- `requires_calibration() -> bool` trait method on `GamePlugin` (default true; DancePlugin returns false)
- `spectator_snapshot(&self, state: &dyn Any) -> Option<Value>` trait method on `GamePlugin` (default None; DancePlugin returns current beat + scores)
- `RoomHandle` / room actor stores `game_type: String`
- `MsgJoined` gains a `game_type: String` field; spectator join snapshot gains `game_type`
- `MsgDanceBeat` and `MsgDanceScore` typed structs in `engine-core/src/protocol.rs` with `#[derive(Serialize, Deserialize, TS)]`
- ts-rs export regenerates `shared/protocol.ts` to include the new types
- Engine skips `calibration_start` / `calibration_done` handshake when `plugin.requires_calibration() == false`; proceeds directly to warmup/match start
- On spectator join for a dance room mid-match, engine calls `plugin.spectator_snapshot(state)` and sends the result before switching to live broadcast

**Out of scope (Phase 7):**
- Dance UX / DESIGN.md dance section (Phase 8)
- Overlay game-type routing, Pixi.js target pose skeleton, dance match end screen (Phase 9)
- Mobile calibration skip UI (Phase 9 DIMPL-05)
- Commentary engine wiring

</domain>

<decisions>
## Implementation Decisions

### Calibration skip mechanism
- **D-01:** Add `fn requires_calibration(&self) -> bool { true }` to `GamePlugin` trait with a default returning `true`. `DancePlugin` overrides to return `false`. Engine checks this once at the point it would send `calibration_start` and branches: if `false`, skip the handshake and proceed to warmup/match start immediately once both players are connected. No string comparison in engine core — the plugin signals its own need.

### Spectator snapshot API
- **D-02:** Add `fn spectator_snapshot(&self, state: &dyn Any) -> Option<serde_json::Value>` to `GamePlugin` trait, default returning `None`. `DancePlugin` implements it to return the current beat number and per-player cumulative scores (same shape as a `dance_score` wire message but with `type: "dance_snapshot"`). Engine calls this on spectator WS connect mid-match; if `Some(payload)`, sends that payload to the new spectator before adding them to the broadcast set.

### TypeScript protocol sync
- **D-03:** Add typed `MsgDanceBeat` and `MsgDanceScore` structs to `engine-core/src/protocol.rs` with `#[derive(Serialize, Deserialize, TS)]`. Run `ts-rs` export (via the existing `cargo test --features ts-rs` mechanism or the project's type-gen script) to regenerate `shared/protocol.ts`. Single source of truth stays in Rust — the Python gen script comment in protocol.ts should be updated to reflect that types now come from Rust.

### Dance protocol struct shapes
- **D-04:** `MsgDanceBeat` fields: `beat: u64`, `total_beats: u64`, `target_pose: Vec<[f64; 4]>` (matches the `json!()` payload DancePlugin already emits — `[x, y, z, visibility]` per keypoint). `MsgDanceScore` fields: `beat: u64`, `scores: [f64; 2]`. These mirror the existing `json!()` payloads exactly so no DancePlugin code changes are needed.

### game_type field in MsgJoined
- **D-05:** `MsgJoined` gains `game_type: String`. Engine populates it from `room.game_type` at join time. The existing spectator snapshot message (sent on spectator join for boxing rooms) also gains `game_type`. This covers DANCE-02 fully.

### Claude's Discretion
- Exact name and location of the ts-rs export script/command
- Whether `MsgDanceBeat.target_pose` uses `Vec<[f64; 4]>` or a named struct `PoseKeypointArray` — either is fine as long as the wire format stays `[[x,y,z,v], ...]`
- Whether `spectator_snapshot` returns a plain `dance_score`-shaped payload with an added `type` field, or a dedicated `MsgDanceSnapshot` struct

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin trait and game types
- `engine/plugin-trait/src/lib.rs` — `GamePlugin` trait; all new methods (D-01, D-02) are added here
- `engine/dance-plugin/src/lib.rs` — `DancePlugin` impl; `requires_calibration` override, `spectator_snapshot` impl, and `on_calibration_complete` no-op (D-05 comment already present)
- `engine/boxing-plugin/src/lib.rs` — `BoxingPlugin` impl; add `game_type()` returning "boxing", `requires_calibration()` returns true (default is sufficient but explicit is clearer)

### Protocol (Rust)
- `engine/engine-core/src/protocol.rs` — `MsgJoined` struct (add `game_type` field); add `MsgDanceBeat` and `MsgDanceScore` structs here

### Protocol (TypeScript)
- `shared/protocol.ts` — regenerated via ts-rs after Rust struct additions; `MsgJoined` already has companion TS interface; add `MsgDanceBeat`, `MsgDanceScore`, and update `MsgJoined`

### Engine room / game loop
- `engine/engine-core/src/room.rs` — `RoomHandle` / room actor; stores `game_type`; calibration skip branch (D-01); spectator snapshot call (D-02)
- `engine/engine-core/src/game_loop.rs` — 60Hz loop; calibration handshake entry point

### Requirements
- `.planning/REQUIREMENTS.md` — DANCE-01 through DANCE-05 are the Phase 7 requirement list

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DancePlugin::on_tick` — already broadcasts `dance_beat` and `dance_score` via `GameEvent::Broadcast { payload: json!(...) }`; the typed structs (D-04) must match these exact shapes
- `DanceState` — fields `beats_scored` and `scores` are exactly what `spectator_snapshot` needs to return
- Existing spectator snapshot mechanism (FIX-02, Phase 1) — already sends HP/wins/round/elapsed on spectator join; dance snapshot plugs into the same send-before-broadcast pattern

### Established Patterns
- `#[derive(Serialize, Deserialize, TS)]` on all protocol structs in `protocol.rs` with `#[ts(export)]` — follow this exactly for `MsgDanceBeat` and `MsgDanceScore`
- Trait default implementations for no-op methods — `requires_calibration`, `spectator_snapshot`, and `game_type` all use defaults; only DancePlugin overrides the first two
- `Box<dyn Any + Send>` plugin state — `spectator_snapshot` receives `&dyn Any` and downcasts; same pattern as `on_tick`

### Integration Points
- `room.rs` / `main.rs` player WS handler — calibration branch sends `MsgCalibrationStart`; add `plugin.requires_calibration()` check here to skip
- `room.rs` spectator WS handler — already sends snapshot on spectator join; add `plugin.spectator_snapshot(state)` call before switching to live broadcast
- `main.rs` room creation — sets `game_type` on the room; passed into `MsgJoined` at player join

</code_context>

<specifics>
## Specific Ideas

- The `spectator_snapshot` payload for dance should use `type: "dance_snapshot"` (not `"dance_score"`) so the overlay can distinguish an initial state message from a live score update.
- DancePlugin's `spectator_snapshot` should only return `Some(...)` if a round is in progress (`round_started == true && !round_ended`); return `None` before the first round starts.

</specifics>

<deferred>
## Deferred Ideas

- Mobile calibration skip UI (`game_type === "dance"` → skip calibration waiting screen) — Phase 9 (DIMPL-05)
- Dance DESIGN.md section and target pose visual spec — Phase 8 (DDES-01 through DDES-03)
- Dance overlay HUD, Pixi.js target skeleton, dance match end screen — Phase 9

</deferred>

---

*Phase: 7-Dance Engine + Protocol*
*Context gathered: 2026-05-09*
