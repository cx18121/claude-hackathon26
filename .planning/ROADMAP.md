# Roadmap: PoseEngine

## Overview

Three phases carry the engine from a working Rust server (protocol-compatible, room-actor architecture) through a clean plugin interface proven by the boxing game, to a validated abstraction stress-tested by a second game and documented for developer handoff. Each phase compiles, runs, and can be verified independently. No phase ships partial features.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (1.1, 2.1): Urgent insertions only

- [ ] **Phase 1: Engine Core** - Rust Axum server speaks the existing wire protocol; rooms, room actors, 60Hz loop, and spectator snapshot fix are all working
- [ ] **Phase 2: Plugin Trait + Boxing** - GamePlugin trait defined; boxing plugin is the first implementation; calibration-persist fix lands here
- [ ] **Phase 3: Second Game + SDK** - Second game plugin validates the trait generalizes; SDK documentation makes the interface self-explanatory

## Phase Details

### Phase 1: Engine Core
**Goal**: The Rust server replaces the Python server — same wire protocol, same room codes, same client behavior — with the room actor concurrency model in place and the spectator snapshot bug fixed
**Depends on**: Nothing (first phase)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-08, ENG-09, ENG-10, ENG-11, ENG-12, ENG-13, PROTO-01, PROTO-02, PROTO-03, FIX-02
**Success Criteria** (what must be TRUE):
  1. A mobile client and spectator client connect to the Rust server using existing room codes with no TypeScript changes required
  2. Pose frames streamed from a player appear on the spectator overlay within the same tick cycle, independent of the 60Hz game loop
  3. A spectator who reconnects mid-round receives a snapshot of current HP, wins, round number, and elapsed time before entering the live broadcast stream
  4. The 60Hz game loop runs continuously inside each room actor task; the server handles multiple rooms concurrently without cross-room locks
  5. All message types serialize to JSON that is byte-for-byte compatible with the golden-file fixtures derived from shared/protocol.ts
**Plans**: 5 plans

Plans:
- [ ] 01-01-PLAN.md — Cargo workspace, protocol.rs (all wire types), Axum router skeleton
- [ ] 01-02-PLAN.md — Golden-file fixtures, protocol roundtrip tests, capture_fixtures.py
- [ ] 01-03-PLAN.md — input_delay.rs, room actor, room_manager (DashMap + expiry), player WS handler
- [ ] 01-04-PLAN.md — game_loop.rs (60Hz, warmup, round lifecycle), broadcast.rs, spectator WS with FIX-02
- [ ] 01-05-PLAN.md — Dockerfile cutover (Rust stage + debian:bookworm-slim final), integration verification

### Phase 2: Plugin Trait + Boxing
**Goal**: The GamePlugin trait is the only interface a game developer needs; the boxing game is a fully working first plugin that proves the trait surface is correct; the calibration-persist bug is fixed
**Depends on**: Phase 1
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, BOX-01, BOX-02, BOX-03, BOX-04, BOX-05, BOX-06, BOX-07, BOX-08, BOX-09, BOX-10, FIX-01
**Success Criteria** (what must be TRUE):
  1. A developer can implement a new game by writing a single Rust struct that implements GamePlugin — no engine files need to be touched
  2. Two players can complete a full boxing match: calibration, warmup, live rounds with hit detection and guard blocking, KO or time-limit decision, and rematch without recalibration
  3. Calibration established in the first round persists across rematches — players are never forced to recalibrate within the same room session
  4. Solo/bot mode starts when only one player joins; the bot operates at three selectable difficulty tiers
  5. Box<dyn GamePlugin + Send + Sync> compiles and the trait is confirmed object-safe; all plugin methods are synchronous with no async-trait allocations in the hot path
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — plugin-trait crate: GamePlugin trait, TickContext, GameEvent (5 variants), BodyRegion (9 variants), PoseFrame/PoseKeypoint; workspace update
- [x] 02-02-PLAN.md — boxing-plugin utility modules: hit_detection.rs (punch/kick, guard, body regions), damage.rs (velocity-scaled); unit tests
- [x] 02-03-PLAN.md — boxing-plugin lib.rs: BoxingPlugin impl, BoxingState, bot.rs (BOT_KPS, tick_bot, difficulty); FIX-01 regression test
- [x] 02-04-PLAN.md — engine-core wiring: PLUG-06 normalization, TickContext construction, plugin.on_tick, dispatch_events, lifecycle hooks; cargo test --workspace
- [x] 02-05-PLAN.md — BOX-10 gap closure: solo/bot mode gate in game_loop.rs and room.rs; solo mode unit tests

### Phase 3: Second Game + SDK
**Goal**: A second game plugin is implemented using only the public GamePlugin trait with zero engine changes; the SDK documentation is sufficient for a developer (or LLM) to add a new game from scratch
**Depends on**: Phase 2
**Requirements**: GAME2-01, GAME2-02, SDK-01, SDK-02, SDK-03
**Success Criteria** (what must be TRUE):
  1. The second game (dance scoring, pose-match, or equivalent) runs end-to-end through the engine without modifying any engine source files
  2. Any trait additions required to make the second game work are treated as interface bugs and resolved before this phase closes — the phase does not ship if engine changes were needed
  3. A developer reading the README and Rustdoc can implement and register a new game plugin by following the documented steps, with the boxing plugin as the worked example
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — dance-plugin crate: DancePlugin impl, DanceState, poses.rs (POSE_LIBRARY, Y-up coords), beat clock, cosine similarity scoring, unit tests; workspace update
- [x] 03-02-PLAN.md — engine-core wiring: AppState plugin registry (HashMap), POST /rooms endpoint, GET / lobby HTML (UI-SPEC compliant), ws_player Option A (no on-demand creation)
- [x] 03-03-PLAN.md — SDK docs: Rustdoc refresh on plugin-trait (all 7 methods + 8 types), docs/GAME-SDK.md (trait reference + boxing walkthrough + quick-start boilerplate + registration steps), README teaser

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Engine Core | 0/5 | Not started | - |
| 2. Plugin Trait + Boxing | 0/5 | Not started | - |
| 3. Second Game + SDK | 0/3 | Not started | - |
