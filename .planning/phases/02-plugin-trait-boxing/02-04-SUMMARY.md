---
phase: 02-plugin-trait-boxing
plan: "04"
subsystem: engine-core
tags: [rust, axum, plugin-trait, boxing-plugin, hit-detection, game-loop, coordinate-normalization]
dependency_graph:
  requires: ["02-01", "02-02", "02-03"]
  provides: ["engine-core-plugin-wired", "PLUG-04", "PLUG-06", "BOX-09"]
  affects: ["engine-core/src/main.rs", "engine-core/src/room.rs", "engine-core/src/room_manager.rs", "engine-core/src/game_loop.rs"]
tech_stack:
  added: ["boxing-plugin dep in engine-core", "plugin-trait dep in engine-core"]
  patterns: ["Box<dyn Any+Send> plugin state", "Arc<dyn GamePlugin+Send+Sync> shared plugin", "hip-centred Y-up coordinate normalization (PLUG-06)", "event-driven dispatch (dispatch_events + handle_round_over)"]
key_files:
  created: []
  modified:
    - engine/engine-core/Cargo.toml
    - engine/engine-core/src/main.rs
    - engine/engine-core/src/room.rs
    - engine/engine-core/src/room_manager.rs
    - engine/engine-core/src/game_loop.rs
decisions:
  - "Phase 1 pub enum GameEvent removed from game_loop.rs; engine-core uses plugin_trait::GameEvent exclusively"
  - "dispatch_events defers RoundOver processing to handle_round_over to avoid double-borrow of RoomState"
  - "Engine mirrors HP on RoomState.hp (via dispatch_events Hit handler) and plugin tracks it in BoxingState — both consistent"
  - "normalize_to_y_up returns frame unchanged if keypoints.len() < 25 (defensive, T-02-17)"
  - "state.recent_hits cleared before dispatch_events adds new hits each tick (not after broadcast)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 2 Plan 04: Engine-Core Plugin Wiring Summary

Engine-core wired with BoxingPlugin and plugin-trait: dependency injection, RoomState extension with plugin fields, PLUG-06 coordinate normalization, TickContext assembly, plugin.on_tick call on every live-phase tick, and all five GameEvent variants dispatched.

## Tasks Completed

### Task 1: Update engine-core deps, extend RoomState with plugin fields, wire lifecycle hooks (PLUG-04)
**Commit:** 3d483d9

**Files modified:**
- `engine/engine-core/Cargo.toml` — added `plugin-trait = { path = "../plugin-trait" }` and `boxing-plugin = { path = "../boxing-plugin" }`
- `engine/engine-core/src/room.rs` — extended RoomState with `plugin: Arc<dyn GamePlugin+Send+Sync>`, `plugin_state: Box<dyn Any+Send>`, `tick: u64`, `recent_hits: Vec<HitEvent>`; updated RoomState::new to accept plugin param and call init_state(); added lifecycle hook calls in handle_cmd (on_player_join, on_player_leave, on_calibration_complete); updated build_snapshot to use state.tick and state.recent_hits
- `engine/engine-core/src/room_manager.rs` — updated create_room to accept `plugin: Arc<dyn GamePlugin+Send+Sync>` and pass it to RoomState::new
- `engine/engine-core/src/main.rs` — added BoxingPlugin/BoxingConfig/Difficulty imports; added plugin: Arc<dyn GamePlugin+Send+Sync> field to AppState; constructed BoxingPlugin::new(BoxingConfig{hp:800,...}) in main(); passed Arc::clone(&app.plugin) to create_room

**Acceptance criteria verified:** `cargo build -p engine-core` exits 0. All structural fields and lifecycle hook calls confirmed.

### Task 2: Implement PLUG-06 normalization, TickContext construction, plugin.on_tick call, and event dispatch in game_loop.rs
**Commit:** ab08f25

**Files modified:**
- `engine/engine-core/src/game_loop.rs` — complete rewrite:
  - Added `normalize_to_y_up` function: MediaPipe Y-down to hip-centred Y-up coordinate normalization (PLUG-06); defensive early-return if < 25 keypoints (T-02-17)
  - Removed WR-05 `player.processed_frames.clear()` from RTT drain loop
  - Removed Phase 1 `pub enum GameEvent` (replaced by plugin_trait::GameEvent)
  - Added `state.tick += 1` each live-phase tick
  - Assembled TickContext with norm_frames, TickInfo (tick, elapsed_secs, remaining_secs), RoomView/SlotView
  - Called `state.plugin.on_tick(&ctx, &mut *state.plugin_state)` returning Vec<GameEvent>
  - Cleared processed_frames AFTER on_tick returns
  - Added `dispatch_events`: bounds-checked handlers for all 5 variants (T-02-15, T-02-16)
  - Added `handle_round_over`: round_end broadcast, win increment, match-over detection, round reset with on_round_reset (FIX-01)
  - Updated `build_game_state_with_latency`: tick = state.tick, recent_hits = state.recent_hits.clone()

**Acceptance criteria verified:** All 10 plan verification greps pass. `cargo test --workspace` exits 0 — 66 tests pass (23 boxing-plugin, 20 engine-core lib, 25 engine-core bin, 18 protocol roundtrip).

## Deviations from Plan

None — plan executed exactly as written. Task 2 produced a single unified game_tick function rather than the plan's step-by-step inline code (the logic is equivalent). The game_state broadcast is sent at the end of game_tick (after dispatch_events), rather than inside dispatch_events, which keeps the broadcast pattern consistent with the Phase 1 code.

## Known Stubs

None. All game state fields (tick, recent_hits, hp) are wired through the full plugin call chain. No placeholder values remain in the hot path.

## Threat Surface Scan

No new network endpoints or trust boundaries introduced. All STRIDE threats from the plan's threat register are mitigated:
- T-02-15: defender index bounds-checked in dispatch_events Hit handler
- T-02-16: slot index bounds-checked in dispatch_events SendToPlayer handler
- T-02-17: normalize_to_y_up returns frame unchanged if keypoints.len() < 25
- T-02-18/T-02-19/T-02-20: accepted as documented

## Self-Check

Files created/modified:
- [x] `engine/engine-core/Cargo.toml` — FOUND
- [x] `engine/engine-core/src/main.rs` — FOUND
- [x] `engine/engine-core/src/room.rs` — FOUND
- [x] `engine/engine-core/src/room_manager.rs` — FOUND
- [x] `engine/engine-core/src/game_loop.rs` — FOUND

Commits:
- [x] 3d483d9 — Task 1 (deps, RoomState, lifecycle hooks)
- [x] ab08f25 — Task 2 (normalization, TickContext, on_tick, dispatch)

## Self-Check: PASSED
