# Phase 2: Plugin Trait + Boxing - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 defines the `GamePlugin` trait and implements the boxing game as its first proof. The trait surface is the primary deliverable — it must be clean enough that a developer (or LLM) can implement a new game by writing a single struct without touching engine internals. Boxing validates that the trait surface is correct. The calibration-persist bug (FIX-01) lands here because it is a boxing-side concern (boxing plugin's `on_round_reset` must not clear calibration state). Commentary infrastructure remains v2 scope, but `CommentaryHint` is added to `GameEvent` so boxing can emit hints that the v2 engine will later consume.

</domain>

<decisions>
## Implementation Decisions

### Cargo Workspace (carried forward from Phase 1 D-01)
- **D-01:** Phase 2 adds two workspace members to `engine/Cargo.toml`: `plugin-trait` (the trait crate) and `boxing-plugin` (first implementation). `engine-core` gains a dependency on `plugin-trait`; `boxing-plugin` depends on `plugin-trait`; `engine-core/main.rs` depends on `boxing-plugin` only for construction. The trait is the shared interface; the engine never imports boxing types directly except at the `BoxingPlugin::new()` call site in `main.rs`.

### Messaging API
- **D-02:** Events-only messaging. `on_tick` returns `Vec<GameEvent>`; the engine dispatches all events after the tick completes. There are no send methods on `TickContext`. `GameEvent::SendToPlayer { slot, payload: serde_json::Value }` is the mechanism for player-specific messages. `GameEvent::Broadcast { payload }` handles room-wide sends. Rationale: `on_tick` stays a pure function (inputs in, events out) — unit tests call it with fake input and inspect the returned vec with no engine plumbing needed. The engine can also intercept, log, or transform the event stream before dispatching (needed for v2 commentary routing).

### GameEvent Variants (extends Phase 1 D-07 shape)
- **D-03:** `GameEvent` enum for Phase 2: `Hit { attacker: u8, defender: u8, region: BodyRegion, damage: f32, position: [f32; 2] }`, `RoundOver { winner: Option<u8> }`, `SendToPlayer { slot: u8, payload: serde_json::Value }`, `Broadcast { payload: serde_json::Value }`, `CommentaryHint { kind: String, payload: serde_json::Value }`. `CommentaryHint` is emitted by boxing on first blood / combos / low HP; nothing acts on it in Phase 2 (v2 commentary engine will consume it). This matches `PLUG-03` in REQUIREMENTS.md.

### Bot Mode
- **D-04:** Bot logic lives entirely in the boxing plugin. Each tick, the plugin reads `RoomView` to detect solo mode (slot 1 unoccupied / no active connection). When in bot mode, the plugin fabricates its own `PoseKeypoint` data internally (a static boxing stance constant, equivalent to `_BOT_KPS` in `server/game_loop.py`) and generates scripted hit events at difficulty-tuned random intervals. The engine has no concept of a bot — it just sees the boxing plugin returning events as usual. Difficulty tiers (easy/normal/hard) map to different hit interval ranges and are a boxing-plugin-internal concern.

### Plugin Registration
- **D-05:** Hardcoded in `engine-core/src/main.rs` for Phase 2:
  ```rust
  let plugin: Arc<dyn GamePlugin + Send + Sync> = Arc::new(BoxingPlugin::new(config));
  ```
  Note: Originally specified as `Box<dyn GamePlugin + Send>`. Upgraded to `Arc<dyn GamePlugin + Send + Sync>` because the plugin instance must be cloned into each room actor at creation time (multi-room sharing). `Arc` requires `Sync` on the inner type; `BoxingPlugin` is stateless (all mutable state lives in per-room `plugin_state: Box<dyn Any + Send>`) so implementing `Sync` is safe. The engine is already generic over the trait object; Phase 3 adds a match branch or CLI flag when a second game exists. No Cargo feature flags or config-file routing in Phase 2.

### Plugin Init Config
- **D-06:** `BoxingPlugin::new(config: BoxingConfig)` where `BoxingConfig` is a boxing-specific struct. `GamePlugin::init_state()` takes no arguments — the trait stays clean. Config values are set at construction time in `main.rs`. Phase 2 defaults: `{ hp: 800, round_secs: 90.0, max_wins: 3, bot_difficulty: Difficulty::Normal }`.

### Calibration-Persist Fix (FIX-01)
- **D-07:** `reference_velocity` is stored on `PlayerSlot` in the engine (set during `on_calibration_complete`). The engine's round-reset path does NOT clear `reference_velocity`. Boxing's `on_round_reset` clears only plugin-internal state: HP arrays, cooldown counters, combo trackers. Calibration persists for the Room lifetime.

### Reference Velocity Clamping (carried forward from Phase 1 deferred)
- **D-08:** Boxing plugin clamps `reference_velocity` in `on_calibration_complete` before storing it in plugin state: valid range 0.5–15.0 m/s (per CONCERNS.md recommendation). Values outside this range are clamped silently. This prevents both phantom hits (near-zero ref) and all-miss outcomes (extreme ref).

### Claude's Discretion
- Exact `BodyRegion` enum variants and naming (must match the 9 regions in BOX-03: head_chin, head_face, head_throat, torso_upper, torso_lower, block_hand, block_forearm, leg_thigh, leg_shin — but the Rust naming convention is Claude's call)
- Internal module layout within `boxing-plugin` crate (e.g., `hit_detection.rs`, `damage.rs`, `bot.rs` as separate modules — mirroring the Python layout is a reasonable default)
- `RoomView` exact fields beyond "player count and slot connection status" — researcher should read engine-core Phase 1 output to see what's been built
- Exact difficulty tier hit-interval ranges for bot mode (easy/normal/hard)
- Whether `BoxingConfig` derives `serde::Deserialize` (useful if config eventually comes from env/file, but not required for Phase 2)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin Trait Requirements (Phase 2 scope)
- `.planning/REQUIREMENTS.md` — PLUG-01..06, BOX-01..10, FIX-01 are the full Phase 2 requirement list; read traceability section for phase mapping

### Python Implementation (port reference for boxing logic)
- `server/game_loop.py` — 60Hz loop, warmup gating, hit detection dispatch, bot tick (`_tick_bot`, `_BOT_KPS`), round lifecycle, commentary hint emission
- `server/hit_detection.py` — `detect_punch`, `detect_kick`, `_velocity`, `_peak_speed`, body region classification constants (`_REL_HEAD_Y`, `_REL_TORSO_HI_Y`, `_REL_GUARD_HEAD_Y`, `PUNCH_THRESHOLD`, `KICK_THRESHOLD`)
- `server/damage.py` — `BASE_DAMAGE` mapping, `compute_damage` velocity scaling, guard region handling
- `server/rooms.py` — `PlayerSlot` (lines 17–27): `reference_velocity` field layout; `reset_for_rematch` (lines 57–67): the bug to NOT replicate (must not clear `reference_velocity`)

### Phase 1 Context (prior decisions that feed Phase 2)
- `.planning/phases/01-engine-core/01-CONTEXT.md` — D-01 (crate layout), D-07 (GameEvent enum shape established in Phase 1; Phase 2 extends it); read before planning crate structure

### Project Decisions
- `.planning/PROJECT.md` — Core Value statement ("trivially easy to add a new game"), Key Decisions table (plugin as Rust trait, boxing as first plugin)
- `.planning/codebase/ARCHITECTURE.md` — component responsibilities, data flow diagrams, coordinate system note (Y-up convention in hit_detection.py)
- `.planning/codebase/CONCERNS.md` — calibration bug details (lines 41–46), bot fragile areas (`_BOT_KPS` hardcoded 33-point pose, lines 96–100), reference velocity security concern (lines 64–68)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/hit_detection.py`: Complete punch/kick detection pipeline with 10-frame sliding window, wrist/ankle speed thresholds, body region classification — direct port target for `boxing-plugin/src/hit_detection.rs`
- `server/damage.py`: `BASE_DAMAGE` dict and `compute_damage` function — maps to a Rust match or const array; straightforward port
- `server/game_loop.py` `_BOT_KPS`: 33-point static pose constant — port as a `const [PoseKeypoint; 33]` in `boxing-plugin/src/bot.rs`

### Established Patterns
- Python hit detection uses `_y_up()` to negate Y before comparisons (Y-up convention); PLUG-06 says engine delivers coordinates already normalized hip-centred Y-up — verify the engine Phase 1 output before porting to avoid double-negation
- `Box<dyn Any + Send>` for plugin state: established in PLUG-04 spec; boxing plugin downcasts to its own `BoxingState` struct in every method
- Pose fan-out (fast path) is already handled by the engine and does NOT go through the plugin — plugin only receives already-released frames from the input delay buffer

### Integration Points
- `engine-core` calls `plugin.on_tick(ctx)` and processes the returned `Vec<GameEvent>`; Phase 2 adds the event dispatch arms for `Hit`, `RoundOver`, `SendToPlayer`, `Broadcast`, `CommentaryHint`
- `engine-core` calls `plugin.on_calibration_complete(slot, reference_velocity)` — this is where boxing stores ref_vel in plugin state (after clamping per D-08)
- `engine-core` calls `plugin.on_round_reset()` — boxing clears HP/cooldowns but NOT reference_velocity (FIX-01, D-07)
- `main.rs` is the only file that imports `BoxingPlugin` directly; all other engine files see only `Box<dyn GamePlugin + Send>`

</code_context>

<specifics>
## Specific Ideas

- Bot difficulty tiers map to hit-interval ranges: easy ≈ slow hits, normal ≈ moderate, hard ≈ fast — specific ms values are Claude's discretion, but the three-tier structure is BOX-10 spec
- `BoxingConfig` struct constructed in `main.rs` with explicit field values so Phase 3 can trivially add a CLI match that passes different configs per game
- `CommentaryHint` emitted by boxing for: first blood, combo (2+ hits), comeback (low HP player lands hit), low HP warning, round end — same trigger classification as `server/game_loop.py:415-479`

</specifics>

<deferred>
## Deferred Ideas

- CLI-based or env-based plugin selection — Phase 3 adds a match branch when the second game exists; no routing mechanism needed in Phase 2
- `CommentaryHint` consumer (commentary engine) — v2 scope (COMM-01..04); the variant is emitted in Phase 2 but nothing acts on it until v2
- Replay / event logging via the event stream — natural extension point enabled by D-02 (all game effects flow as events) but not Phase 2 scope

</deferred>

---

*Phase: 2-Plugin Trait + Boxing*
*Context gathered: 2026-05-02*
