# Phase 10: FPSBoxingPlugin - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 delivers a new Rust crate `fps-boxing-plugin` in the engine workspace that implements `GamePlugin` for "fps_boxing" rooms. The server can host fps_boxing rooms with authoritative hit detection, HP tracking, and per-tick opponent arm state broadcast. This phase is server-side only — no engine changes, no client changes, no frontend. It also refactors shared boxing logic into a new `boxing-core` crate that both `boxing-plugin` and `fps-boxing-plugin` depend on.

</domain>

<decisions>
## Implementation Decisions

### Shared Hit Detection Crate (FPSP-02)
- **D-01:** Extract `hit_detection.rs` and `damage.rs` from `boxing-plugin` into a new `boxing-core` crate in the engine workspace. Both `boxing-plugin` and `fps-boxing-plugin` depend on `boxing-core`. `boxing-plugin`'s internal copies are deleted — `boxing-core` becomes the single source of truth for punch detection and damage calculation.
- **D-02:** `bot.rs` stays in `boxing-plugin` for now. Bot logic is needed in Phase 14 (GML-03) — it will be moved to `boxing-core` or `fps-boxing-plugin` at that point, not prematurely in Phase 10.
- **D-03:** `fps-boxing-plugin` is a new workspace member: `engine/fps-boxing-plugin/`. It depends on `plugin-trait` and `boxing-core`. Engine-core's `main.rs` gains a match branch that routes `game_type = "fps_boxing"` to `FPSBoxingPlugin::new()`.

### Protocol Messages (FPSP-03, FPSP-04)
- **D-04:** `MsgFpsState` and `MsgFpsHit` are defined as typed structs in `engine-core/src/protocol.rs` (alongside `MsgDanceBeat`, `MsgDanceScore`, `MsgGameState`). TypeScript interfaces are generated via `scripts/gen_protocol.py` so `shared/protocol.ts` stays in sync. The FPS client (Phase 12) gets typed protocol definitions out of the box.
- **D-05:** `MsgFpsState` contains the minimum required by FPSP-03: opponent's 6 arm landmarks (named struct fields, see D-07), both players' HP (`hp: (u32, u32)`), and round timer (`round_timer: f64`). No wins, round number, or other fields in Phase 10 — Phase 14 can extend if needed.
- **D-06:** `MsgFpsHit` contains `punch_type: String` and `damage: u32` (FPSP-04). `punch_type` uses the same string enum values as the existing boxing protocol (e.g., `"jab"`, `"cross"`, `"hook"`). Sent via `GameEvent::SendToPlayer` to the hit player only.

### Arm Landmark Format in MsgFpsState (FPSP-03)
- **D-07:** The 6 arm landmarks in `MsgFpsState` use **named struct fields**, not an ordered array. Fields: `left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`, `left_wrist`, `right_wrist` — each is the existing `PoseKeypoint` type (x, y, z, visibility). The z-coordinate is included because Phase 14 uses depth for first-person arm positioning. Visibility is included for client-side filtering of low-confidence landmarks. These correspond to MediaPipe landmark indices 11–16.
- **D-08:** `MsgFpsState` carries the **opponent's landmarks only**. Each player's own pose is captured locally via webcam — sending it back from the server would add unnecessary latency.

### Bot and Guard Scope
- **D-09:** Bot mode (GML-03) and guard blocking (GML-04) are omitted from Phase 10. No stubs. They are added fresh in Phase 14 when the client can actually exercise them. Phase 10 focuses on the minimal FPSP-01..04 server surface.

### Game Type Registration
- **D-10:** `FPSBoxingPlugin::game_type()` returns `"fps_boxing"`. A Rust test asserts this equals `"fps_boxing"` and does NOT equal `"boxing"` (FPSP-01 success criterion 4).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin Interface
- `engine/plugin-trait/src/lib.rs` — Complete `GamePlugin` trait, `PoseKeypoint`, `PoseFrame`, `BodyRegion`, `GameEvent`, `TickContext`, `SlotView`, `RoomView`, `TickInfo`. This is the only contract FPSBoxingPlugin implements.

### Existing Boxing Plugin (reuse target)
- `engine/boxing-plugin/src/lib.rs` — BoxingPlugin struct, BoxingConfig, BoxingState, GamePlugin impl. The `hit_detection.rs` and `damage.rs` modules in this crate are extracted to boxing-core.
- `engine/boxing-plugin/src/hit_detection.rs` — `detect_punch` function, velocity helpers, landmark index constants, PUNCH_THRESHOLD, body-region boundary constants.
- `engine/boxing-plugin/src/damage.rs` — `compute_damage` function, base damage table per BodyRegion.
- `engine/boxing-plugin/Cargo.toml` — Existing dependencies (plugin-trait, serde_json, rand, tracing).

### Engine Core / Protocol
- `engine/engine-core/src/protocol.rs` — All wire message structs. MsgFpsState and MsgFpsHit are added here. `PoseKeypoint` type definition for reuse.
- `engine/engine-core/src/game_loop.rs` — How `GameEvent::SendToPlayer` and `GameEvent::Broadcast` are dispatched; how plugins are called per-tick.
- `engine/engine-core/src/main.rs` — Plugin registration site — add `FPSBoxingPlugin` match branch here.

### Workspace
- `engine/Cargo.toml` — Workspace members list. `fps-boxing-plugin` and `boxing-core` are added here.

### Requirements
- `.planning/REQUIREMENTS.md` §FPSP-01..FPSP-04 — The four server plugin requirements for this phase.
- `.planning/ROADMAP.md` §Phase 10 — Success criteria and dependency declaration.

### Protocol Codegen
- `scripts/gen_protocol.py` — Run after adding MsgFpsState/MsgFpsHit to protocol.rs to regenerate shared/protocol.ts. Required for TypeScript sync.
- `shared/protocol.ts` — Auto-generated TypeScript; updated as part of this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `boxing-plugin/src/hit_detection.rs`: `detect_punch(attacker_frames, defender_frames, ref_vel) -> Option<HitResult>` — moves to boxing-core unchanged
- `boxing-plugin/src/damage.rs`: `compute_damage(region, limb_velocity, ref_vel) -> u32` — moves to boxing-core unchanged
- `plugin-trait::PoseKeypoint`: Reused directly as the per-landmark type in MsgFpsState named fields
- `plugin-trait::GameEvent::SendToPlayer { slot, payload }`: Mechanism for delivering MsgFpsHit to the hit player
- `plugin-trait::GameEvent::Broadcast { payload }`: Not used per-tick for fps_boxing (MsgFpsState goes to each player individually via SendToPlayer)

### Established Patterns
- Plugin state is `Box<dyn Any + Send>` per room; downcast in every plugin method — FPSBoxingPlugin follows the same pattern as BoxingPlugin
- `on_tick` is synchronous and pure — returns `Vec<GameEvent>`, no I/O
- `on_calibration_complete` sets `ref_vel` in plugin state; `on_round_reset` clears HP but NOT `ref_vel` (FIX-01 invariant)
- `game_type()` string must be stable ASCII, lowercase with underscores
- Dance plugin (engine/dance-plugin/) proves a second plugin can coexist with zero engine changes

### Integration Points
- `engine-core/src/main.rs`: Add `FPSBoxingPlugin` match arm alongside `BoxingPlugin` and `DancePlugin` dispatch
- `engine/Cargo.toml`: Add `fps-boxing-plugin` and `boxing-core` to `members`
- `scripts/gen_protocol.py`: Run after protocol.rs changes to regenerate shared/protocol.ts
- `engine-core/src/protocol.rs`: Add `MsgFpsState` and `MsgFpsHit` structs with `#[derive(Serialize, Deserialize, TS)]`

</code_context>

<specifics>
## Specific Ideas

- z-coordinate on arm landmarks is intentional — first-person arm depth positioning in Phase 14 requires it (not a MediaPipe artifact to discard)
- punch_type in MsgFpsHit should reuse the same string values as the boxing protocol for consistency (Phase 14 client can share type handling)
- Consider whether `MsgFpsState` should have `msg_type: "fps_state"` discriminator (consistent with all other protocol messages that carry a `type` field for client-side routing)

</specifics>

<deferred>
## Deferred Ideas

- **MediaPipe z-depth reliability** — User raised concern about whether MediaPipe provides reliable z-coordinates for first-person rendering. This is a Phase 13 concern (model selection + calibration). If z is unreliable, Phase 13 should evaluate alternatives (e.g., depth estimation from stereo or a different model). Phase 10's protocol includes z regardless — the server is a pass-through.
- **Bot mode (GML-03)** — Reusing BoxingPlugin bot logic in FPSBoxingPlugin deferred to Phase 14
- **Guard blocking (GML-04)** — Guard detection via hit_detection deferred to Phase 14

</deferred>

---

*Phase: 10-FPSBoxingPlugin*
*Context gathered: 2026-05-13*
