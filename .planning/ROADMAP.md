# Roadmap: PoseEngine

## Overview

Six phases carry the engine from first-principles Rust rewrite through a clean plugin abstraction proven by two games, then fix the UX so players can actually get into a game. Phases 1–3 are complete. Phases 4–6 address the lobby, mobile connection, and overlay polish that blocked real testing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4, 5, 6): Planned milestone work
- Decimal phases (1.1, 2.1): Urgent insertions only

- [x] **Phase 1: Engine Core** - Rust Axum server speaks the existing wire protocol; rooms, room actors, 60Hz loop, and spectator snapshot fix are all working
- [x] **Phase 2: Plugin Trait + Boxing** - GamePlugin trait defined; boxing plugin is the first implementation; calibration-persist fix lands here
- [x] **Phase 3: Second Game + SDK** - Second game plugin validates the trait generalizes; SDK documentation makes the interface self-explanatory
- [ ] **Phase 4: Lobby UX** - SPECTRE landing page with game picker + join flow; `/rooms/{code}` page with QR codes; unblocks players from actually getting into a game
- [ ] **Phase 5: Mobile Connection UX** - Fast-join (QR-linked one-tap screen); hide technical server URL field when params are prefilled; better error messages
- [ ] **Phase 6: Overlay Fidelity** - Restore Achafont; close all DESIGN.md spec gaps in HUD, commentary bar, and match-end screen
- [ ] **Phase 7: Dance Engine + Protocol** - `game_type` propagated through `MsgJoined` and spectator snapshot; dance calibration skip; `MsgDanceBeat`/`MsgDanceScore` TypeScript types
- [ ] **Phase 8: Dance UX Design** - DESIGN.md dance section (score display, beat indicator, target pose spec, match end); PRODUCT.md two-mode update
- [ ] **Phase 9: Dance Frontend** - Game-type-aware overlay HUD; dance score/beat display; target pose skeleton silhouette in Pixi.js; dance match end screen; mobile calibration skip

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

### Phase 4: Lobby UX
**Goal**: A host can open the server URL, select a game, create a room, and immediately hand phones to two players — each player scans a QR code and is connected without typing anything
**Depends on**: Phase 3
**Requirements**: LOBBY-01, LOBBY-02, LOBBY-03, LOBBY-04, LOBBY-05, LOBBY-06, LOBBY-07, LOBBY-08
**Success Criteria** (what must be TRUE):
  1. Landing page shows SPECTRE branding with boxing/dance selector; "Create Room" is disabled until a game is selected
  2. After creating a room, host arrives at `/rooms/{code}` with three QR code cards (P1, P2, Overlay)
  3. Scanning the P1 QR code on a phone opens the mobile app with server, room, and slot all prefilled — no typing required
  4. A guest can join an existing room from the landing page by entering a 6-char code
  5. The page matches DESIGN.md — correct OKLCH tokens, Inter font, no neon/glassmorphism
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Extend DESIGN.md with Lobby section (game picker tiles, landing page layout, room cards, QR card spec, join section, typography and color treatments)
- [x] 04-02-PLAN.md — Rust: `GET /rooms/{code}` route, QR generation (`qrcode` crate), room page HTML with P1/P2/Overlay cards + prefilled URLs + copy buttons
- [x] 04-03-PLAN.md — Landing page rewrite: SPECTRE header, game picker tiles, Create Room flow, Join by code flow; follows DESIGN.md Lobby spec

### Phase 5: Mobile Connection UX
**Goal**: A player who scans the QR code from the lobby room page arrives at a one-tap screen, not a form full of WebSocket URLs
**Depends on**: Phase 4
**Requirements**: MOBILE-01, MOBILE-02, MOBILE-03
**Success Criteria** (what must be TRUE):
  1. Scanning the QR code opens a screen showing "Join as Player 1 · Room ABC123" with a single Connect button — no form fields visible
  2. The raw server URL field and slot radio buttons are absent from the QR-linked flow
  3. An incorrect room code shows "Room not found" instead of a generic connection error
**Plans**: 1 plan

Plans:
- [ ] 05-01-PLAN.md — Rust ?game= param in QR URLs; ConnectionScreen fast-join view (game+room+player+button); server-URL hide; "Enter manually" escape; distinct error copy + Retry for server-unreachable

### Phase 6: Overlay Fidelity
**Goal**: Every DESIGN.md spec is implemented exactly; Achafont is present; the overlay looks like the design intended during live matches
**Depends on**: Phase 4 (to actually test the overlay end-to-end)
**Requirements**: OVERLAY-01, OVERLAY-02, OVERLAY-03, OVERLAY-04
**Success Criteria** (what must be TRUE):
  1. Countdown (3, 2, 1), FIGHT!, KO, and match end title all render in Achafont, visually distinct from Inter body text
  2. Commentary bar shows with correct backdrop blur, accent border, tag style, and blinking cursor exactly as DESIGN.md describes
  3. HP bar tracks have gold borders; all HUD structural elements use the Level 1 elevation spec
  4. No visible DESIGN.md gap can be identified by comparing the running overlay to the spec
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — Restore Achafont: recover `overlay/public/fonts/Achafont.ttf` from git history (commit 4de2977), add `@font-face` declaration to overlay CSS
- [ ] 06-02-PLAN.md — Design spec audit: HP track gold border, commentary bar backdrop/border/tag, HUD elevation Level 1, any remaining DESIGN.md gaps; visual verification pass

### Phase 7: Dance Engine + Protocol
**Goal**: The Rust engine propagates game type to all clients; dance-specific wire messages are typed; dance rooms skip calibration and send snapshots to late-joining spectators
**Depends on**: Phase 3
**Requirements**: DANCE-01, DANCE-02, DANCE-03, DANCE-04, DANCE-05
**Success Criteria** (what must be TRUE):
  1. A spectator or player connecting to any room receives `game_type: "boxing"` or `game_type: "dance"` in `MsgJoined`
  2. A spectator joining mid-dance receives current beat number and cumulative scores before entering the live stream
  3. Dance players connect and the game starts without a calibration step — no "hold still" prompt
  4. `MsgDanceBeat` and `MsgDanceScore` are fully typed in `shared/protocol.ts`; TypeScript compiler accepts them without casts
**Plans**: 2 plans

Plans:
- [ ] 07-01-PLAN.md — `GamePlugin::game_type()` trait method; `RoomHandle.game_type`; `MsgJoined.game_type`; spectator snapshot includes game_type; dance calibration skip in engine
- [ ] 07-02-PLAN.md — `MsgDanceBeat` and `MsgDanceScore` in `shared/protocol.ts`; dance spectator snapshot message (beat + scores); protocol golden-file update

### Phase 8: Dance UX Design
**Goal**: DESIGN.md fully covers the dance game experience; both game modes have a documented visual language before a pixel of dance UI is implemented
**Depends on**: Phase 7 (protocol known before designing around it)
**Requirements**: DDES-01, DDES-02, DDES-03
**Success Criteria** (what must be TRUE):
  1. DESIGN.md has a complete Dance Game section: score display, beat indicator, target pose skeleton spec, round end, match end — sufficient to implement without ambiguity
  2. PRODUCT.md addresses both game modes; dance tone is defined and distinct from boxing without breaking the shared aesthetic
  3. Target pose rendering approach is fully specified: color, position, opacity, animation timing on beat swap
**Plans**: 1 plan

Plans:
- [ ] 08-01-PLAN.md — DESIGN.md dance section (score display spec, beat countdown, target skeleton style, round/match end); PRODUCT.md two-mode tone definition

### Phase 9: Dance Frontend
**Goal**: The overlay renders a purpose-built dance HUD; spectators see target pose silhouettes updating each beat; the mobile app skips calibration for dance; the match end screen shows scores not KO
**Depends on**: Phase 7 (game_type in protocol), Phase 8 (design spec to implement against)
**Requirements**: DIMPL-01, DIMPL-02, DIMPL-03, DIMPL-04, DIMPL-05
**Success Criteria** (what must be TRUE):
  1. Opening the overlay for a boxing room shows the boxing HUD; opening it for a dance room shows the dance HUD — game-type routing works without manual URL params
  2. The target pose skeleton appears in Pixi.js at each `dance_beat` event and visually swaps (with fade) when the next beat arrives
  3. P1 and P2 cumulative scores update in real-time; beat number and countdown are legible at a glance
  4. Dance match end shows final scores and a winner declaration — no HP bar, no KO text
  5. Mobile players in a dance room proceed directly to the game after connecting — no calibration prompt
**Plans**: 4 plans

Plans:
- [ ] 09-01-PLAN.md — `useSpectatorSocket`: store `game_type`; handle `dance_beat` / `dance_score` / dance snapshot; game-type routing in `App.tsx` render branch
- [ ] 09-02-PLAN.md — `DanceHud` component: P1/P2 score bars, beat counter (N / 16), beat countdown visual; wired to `useSpectatorSocket` dance state
- [ ] 09-03-PLAN.md — Target pose skeleton in Pixi.js: render static keypoint skeleton from `dance_beat.target_pose`; per-beat fade-out / fade-in swap animation; positioned alongside live silhouettes
- [ ] 09-04-PLAN.md — Dance match end screen (final scores, winner, rematch); mobile calibration skip when `game_type === "dance"`

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
Phase 7 can run in parallel with phases 4–6 (engine work, no UI dependency).
Phase 8 depends on Phase 7 (protocol must be known before designing around it).
Phase 9 depends on both Phase 7 and Phase 8.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Engine Core | 5/5 | Complete | 2026-05-02 |
| 2. Plugin Trait + Boxing | 5/5 | Complete | 2026-05-02 |
| 3. Second Game + SDK | 3/3 | Complete | 2026-05-03 |
| 4. Lobby UX | 0/3 | Not started | - |
| 5. Mobile Connection UX | 0/1 | Not started | - |
| 6. Overlay Fidelity | 0/2 | Not started | - |
| 7. Dance Engine + Protocol | 0/2 | Not started | - |
| 8. Dance UX Design | 0/1 | Not started | - |
| 9. Dance Frontend | 0/4 | Not started | - |
