# PoseEngine

## What This Is

A real-time multiplayer game engine written in Rust (Axum + Tokio) for pose-based games. v1.0 ships two phone-based games (boxing and dance) with a spectator overlay. v2.0 adds a laptop-native, single-device FPS boxing mode where the webcam tracks punches and renders a first-person Three.js view — no phone required. The plugin interface is clean enough that an LLM can generate a new game in one shot from the GAME-SDK.md guide.

## Core Value

The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.

*Validated at v1.0: DancePlugin with zero engine changes. Validated at v2.0: FPSBoxingPlugin with zero engine-core changes — entirely new game mode in a new crate.*

## Current State: v2.0 Shipped

v2.0 First-Person Boxing shipped 2026-05-17. Planning next milestone.

Since the close, 66 untracked commits restructured the repo into per-game
verticals, auto-generated the wire protocol from Rust, upgraded the ML pipeline,
and hardened CI/deploy. See STATE.md "Post-v2.0 Untracked Work" for the batches.

## Requirements

### Validated

- ✓ Real-time WebSocket pose streaming from mobile browsers — existing
- ✓ Server-authoritative hit detection and game state — existing
- ✓ Spectator overlay with Pixi.js silhouette rendering — existing
- ✓ Room management with 6-char codes — existing
- ✓ RTT-fairness input delay buffer — existing
- ✓ Calibration handshake (reference velocity) — existing
- ✓ Docker + Railway deployment — existing
- ✓ Rust game engine core: Axum + Tokio WebSocket server — v1.0 Phase 1
- ✓ Game plugin trait (`GamePlugin`, `TickContext`, `GameEvent`) — v1.0 Phase 2
- ✓ Boxing game plugin with hit detection, damage, bot mode — v1.0 Phase 2
- ✓ Calibration-persist bug fixed (`reference_velocity` lives on PlayerSlot for Room lifetime) — v1.0 Phase 2
- ✓ Spectator reconnect snapshot (HP, wins, round, elapsed time sent on join) — v1.0 Phase 1
- ✓ DancePlugin: second game validates the trait generalizes — v1.0 Phase 3
- ✓ SDK documentation (GAME-SDK.md 800 lines, full Rustdoc, 270 tests) — v1.0 Phase 3
- ✓ Lobby UX: SPECTRE landing page, game picker, Create Room, Join by code — v1.0 Phase 4
- ✓ Room page with P1/P2/Overlay QR cards (inline SVG, prefilled URLs) — v1.0 Phase 4
- ✓ Mobile fast-join: QR-prefilled params → one-tap connection screen — v1.0 Phase 5
- ✓ Overlay fidelity: Achafont restored, all DESIGN.md spec gaps closed — v1.0 Phase 6
- ✓ Dance engine wiring: `game_type` in `MsgJoined`, calibration skip, `MsgDanceBeat`/`MsgDanceScore` — v1.0 Phase 7
- ✓ Dance UX design: DESIGN.md dance section, PRODUCT.md two-mode update — v1.0 Phase 8
- ✓ Dance frontend: game-type HUD routing, DanceHud, beat countdown, ghost skeleton, dance match end, mobile calibration skip — v1.0 Phase 9
- ✓ FPSBoxingPlugin: authoritative fps_boxing rooms, MsgFpsState/MsgFpsHit, HP tracking, guard blocking, bot mode — v2.0 Phase 10
- ✓ Lobby updated: FPS BOXING tile, /fps laptop join page (no QR codes, no overlay card) — v2.0 Phase 11
- ✓ fps/ Vite app scaffold: WebSocket hook, WaitingScreen, warmup flow — v2.0 Phase 12
- ✓ MediaPipe pose detection in Web Worker, OneEuroFilter on 99 landmarks, arm-length calibration — v2.0 Phase 13
- ✓ Three.js dual-scene renderer: toon arms, spring physics, opponent lerp, guard detection — v2.0 Phase 14
- ✓ Hit feedback: camera shake, snap-back, screen flash, Web Audio — v2.0 Phase 14
- ✓ GameHud: HP bars, round timer, WIN/LOSE overlay, REMATCH, guard-aware damage display — v2.0 Phase 14
- ✓ Per-game vertical layout: `games/*/{client,plugin,server}`; engine-core as lib + 3 thin server binaries — post-v2.0, untracked
- ✓ Wire protocol auto-generated from Rust via ts-rs + unions template, guarded by a `protocol-drift` CI job — post-v2.0, untracked
- ✓ Shared client code extracted to `shared/client/` (`useGameSocketBase`, calibration, velocity, skeleton) — post-v2.0, untracked
- ✓ RTT-fairness input delay actually samples: server sends `MsgPing` every 500ms — post-v2.0, untracked (`011631f2`)
- ✓ Flywheel training-data capture: engine emits `FLYWHEEL_HIT` windows; `scripts/collect_from_logs.py` converts them to labeled samples — post-v2.0, untracked
- ✓ CI covers `npm run build` (tsc -b), Python ml/ syntax + export smoke, and fps-boxing Playwright e2e — post-v2.0, untracked

### Active

*(Fresh requirements defined at next milestone start via `/gsd-new-milestone`)*

### Out of Scope

- Browser-based game IDE — UX for AI generation is deferred; focus is the trait interface quality
- Horizontal scaling / room sharding — single-process Tokio is sufficient for current use
- User accounts, authentication tokens — 6-char room code access model retained
- AI commentary — COMM-01..04 deferred; v3 candidate
- AI game generation — deferred until SDK is proven (it now is); v3 candidate
- Punch classifier ML model — v3 backlog. All existing boxing datasets (BoxingVI etc.) are third-person camera footage; FPS-perspective landmark geometry is fundamentally different and no pre-labeled dataset exists. Velocity-based punch detection (Phase 13 `velocity.ts`) is sufficient for v2. The post-v2.0 ML batch closed the tooling gap — there are now three ways to get data (flywheel capture from live play via `scripts/collect_from_logs.py`, guided webcam recording via `ml/scripts/record_webcam.py`, or BoxingVI re-extraction) plus TCN/QAT/temperature-scaling training and per-player prototype adaptation. What remains is purely operational: collect samples, run `ml/scripts/train.py`, export, quantize, and replace the placeholder ONNX. See ROADMAP.md BL-01.

## Context

**Current state (post-v2.0, measured 2026-08-05):** FPS boxing shipped. Three
games playable: boxing, dance, and FPS boxing. Engine serves all room types
concurrently via the plugin trait.

Layout is per-game verticals — `games/{boxing,dance,fps-boxing}/{client,plugin,server}`
plus `engine/{engine-core,plugin-trait,boxing-core}` and `shared/`. The old
`fps/`, `mobile/`, and `overlay/` directories no longer exist (deleted
`a632fd17`); their Controller/Arena code is now `PlayerApp`/`OverlayApp` inside
each game's client.

- **Rust:** ~6,930 LOC across 23 files (engine-core 3,845; dance plugin 1,032; boxing-core 641; boxing plugin 631; fps-boxing plugin 373; plugin-trait 357; three server binaries ~51 total)
- **TypeScript:** ~11,000 LOC across `games/*/client` + `shared/`
- **Python:** ~1,500 LOC in `ml/`

> Correction: earlier revisions of this document and RETROSPECTIVE.md claimed
> "~29,500 Rust LOC". That figure was never accurate — measured at the v2.0 close
> commit (`f603e911`) the tree held 19 `.rs` files totalling 6,850 lines. Treat
> the historical LOC figures in v1.0/v2.0 milestone records as unverified.

**Test coverage:** 144 Rust test functions (engine-core 89, boxing-core 18,
boxing plugin 18, dance plugin 15, fps-boxing plugin 4); ~160 Vitest cases
(fps-boxing client 81, shared 40, dance client 29, boxing client 10); 1
Playwright e2e spec (fps-boxing worker smoke); 1 Python export smoke test.
Counted statically — Rust is not installed on the current dev machine, so
`cargo test` was not run locally. CI (which runs all of the above) was green on
2026-07-21.

**Known technical debt:**
- Worktree CWD management was manual — intra-wave file-overlap detection now prevents parallel conflicting edits but merge coordination could be automated
- `usePunchClassifier` is wired into gameplay but the served ONNX is an all-zero placeholder, so both its logits and prototype paths always return `type: null`. Punch-type damage multipliers are dead code until a real model is trained. `ml/data/` and `ml/models/` are empty.
- Playwright e2e covers fps-boxing only; boxing and dance have no e2e job
- `plugin-trait` has zero tests of its own (exercised only through the three plugin crates)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust for full server rewrite (not PyO3 shim) | Python GIL prevents parallelism; Pydantic/NumPy overhead in hot path; clean break is simpler than hybrid | ✓ Good — clean architecture, no hybrid complexity |
| Axum + Tokio (not Actix) | Better ecosystem ergonomics, `tower` middleware composability, user preference | ✓ Good |
| Game plugin as Rust trait (not scripting/WASM) | Keeps the hot path native; compile-time safety; runtime flexibility not needed | ✓ Good — DancePlugin and FPSBoxingPlugin both required zero engine-core changes |
| Boxing is first plugin, not built into engine | Forces the engine/game boundary to be real before a second game tests it | ✓ Good — boundary held across three games |
| Wire protocol unchanged | TypeScript clients are not part of this rewrite | ✓ Good — zero client changes across all 14 phases |
| Commentary ported last | Async HTTP is straightforward in Rust, separate concern from game engine correctness | ✓ Good — deferred cleanly |
| Phase 8 design-first before Phase 9 code | Dance frontend needed full DESIGN.md spec before any Pixi.js work | ✓ Good — no Phase 9 rework |
| `game_type` in `MsgJoined` (not separate message) | Single place for game-mode routing in all clients | ✓ Good |
| Inline SVG QR codes (not base64 PNG) | No extra HTTP round-trip; scales perfectly | ✓ Good |
| PUBLIC_URL env var preferred over Host header | Mitigates host header injection in prod (T-04-02-02) | ✓ Good |
| fps/ as separate Vite app (not integrated into overlay/) | Laptop-native game has different input model and no spectator overlay dependency | ✓ Good — clean separation |
| Raw Three.js (not React Three Fiber) | Matches overlay/ precedent; finer control over render loop and dual-scene architecture | ✓ Good — dual-scene + OutlineEffect straightforward |
| Velocity-based punch detection over ML classifier | FPS-perspective training data doesn't exist; velocity threshold sufficient for v2 gameplay | ✓ Good — deferred classifier cleanly to v3 |
| Dual-scene depth separation (clearDepth between passes) | Player arms must always render in front of opponent geometry | ✓ Good — FPR-04 satisfied cleanly |
| Per-game verticals over one shared app tree (post-v2.0) | Each game owns its client, plugin, and server binary; the engine becomes a library dependency rather than a host | Untracked — no phase artifacts; validated only by CI + deploy |
| Generate `shared/protocol.ts` from Rust rather than hand-maintain (post-v2.0) | Hand-edited bindings silently drifted from `protocol.rs`; codegen + a drift CI job makes staleness a build failure | ✓ Good — replaces the "wire protocol unchanged" constraint's manual discipline |
| Per-player prototype adaptation over pure classifier output (post-v2.0) | Nearest-centroid over backbone embeddings, seeded from labeled calibration punches, adapts to each player's form without retraining | Unvalidated — degenerate against the all-zero placeholder model |
| Flywheel data capture from live gameplay (post-v2.0) | Labeling FPS punches by hand is the bottleneck; velocity direction at hit time infers the class automatically, so playing the game generates training data | Unvalidated — collector written, never run against real traffic |

## Constraints

- **Language**: Rust — Axum + Tokio for async WebSocket server; no Python in the server path
- **Protocol**: Wire format must be byte-for-byte compatible with existing `shared/protocol.ts` — no client changes
- **Deployment**: Docker multi-stage build + Railway; same `railway.toml` shape
- **Game loop**: 60Hz authoritative tick must be maintained; RTT fairness input delay preserved
- **Plugin interface**: Game trait must be well-defined enough that a developer (or LLM) can implement a new game without knowing engine internals

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-05 — reconciled with repo state after 66 untracked post-v2.0 commits*
