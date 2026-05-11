# PoseEngine

## What This Is

A real-time multiplayer game engine written in Rust (Axum + Tokio) for pose-based games — games where players stream body landmark data from their phones and the server runs authoritative game logic at 60Hz. v1.0 ships with two fully playable games: boxing (hit detection, guard blocking, bot mode) and dance (beat-gated cosine similarity scoring). The plugin interface is clean enough that an LLM can generate a new game in one shot from the GAME-SDK.md guide.

## Core Value

The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.

*Validated at v1.0: DancePlugin implemented with zero engine changes, proving the abstraction generalizes.*

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

### Active

*(None — all v1 requirements shipped. v2 requirements defined in Requirements archive.)*

### Out of Scope

- Browser-based game IDE — UX for AI generation is deferred; focus is the trait interface quality
- Horizontal scaling / room sharding — single-process Tokio is sufficient for current use
- User accounts, authentication tokens — 6-char room code access model retained
- AI commentary — ported last; COMM-01..04 deferred to v2
- AI game generation — deferred until SDK is proven (it now is); target for v2

## Context

**Current state (v1.0):** Complete Rust rewrite shipped. ~29,500 Rust LOC + ~6,100 TypeScript LOC. Engine serves boxing and dance rooms concurrently. All clients untouched — wire protocol unchanged. Deployed to Railway via Docker multi-stage build.

**Test coverage:** 201 Rust tests (unit + integration) + 19 overlay Vitest tests + 50 mobile tests.

**Known technical debt:**
- Railway build verified clean (TypeScript compile errors from Phase 9 worktree scope issues fixed)
- ROADMAP progress table was not updated mid-milestone — corrected at close
- Worktree CWD management was manual — merge coordination during parallel execution needs a more robust pattern

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust for full server rewrite (not PyO3 shim) | Python GIL prevents parallelism; Pydantic/NumPy overhead in hot path; clean break is simpler than hybrid | ✓ Good — clean architecture, no hybrid complexity |
| Axum + Tokio (not Actix) | Better ecosystem ergonomics, `tower` middleware composability, user preference | ✓ Good |
| Game plugin as Rust trait (not scripting/WASM) | Keeps the hot path native; compile-time safety; runtime flexibility not needed | ✓ Good — DancePlugin required zero engine changes |
| Boxing is first plugin, not built into engine | Forces the engine/game boundary to be real before a second game tests it | ✓ Good — boundary held |
| Wire protocol unchanged | TypeScript clients are not part of this rewrite | ✓ Good — zero client changes across all 9 phases |
| Commentary ported last | Async HTTP is straightforward in Rust, separate concern from game engine correctness | ✓ Good — deferred cleanly to v2 |
| Phase 8 design-first before Phase 9 code | Dance frontend needed full DESIGN.md spec before any Pixi.js work | ✓ Good — no Phase 9 rework |
| `game_type` in `MsgJoined` (not separate message) | Single place for game-mode routing in all clients | ✓ Good |
| Inline SVG QR codes (not base64 PNG) | No extra HTTP round-trip; scales perfectly | ✓ Good |
| PUBLIC_URL env var preferred over Host header | Mitigates host header injection in prod (T-04-02-02) | ✓ Good |

## Constraints

- **Language**: Rust — Axum + Tokio for async WebSocket server; no Python in the server path
- **Protocol**: Wire format must be byte-for-byte compatible with existing `shared/protocol.ts` — no client changes
- **Deployment**: Docker multi-stage build + Railway; same `railway.toml` shape
- **Game loop**: 60Hz authoritative tick must be maintained; RTT fairness input delay preserved
- **Plugin interface**: Game trait must be well-defined enough that a developer (or LLM) can implement a new game without knowing engine internals

---
*Last updated: 2026-05-10 after v1.0 milestone*
