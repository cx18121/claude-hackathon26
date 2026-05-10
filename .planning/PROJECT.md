# PoseEngine

## What This Is

A real-time multiplayer game engine written in Rust (Axum + Tokio) for pose-based games — games where players stream body landmark data from their phones and the server runs authoritative game logic at 60Hz. The boxing fight game is the first game built on the engine, proving the plugin interface. The engine is designed so that any pose-based game (fighting, ping pong, dancing, rhythm) can be added by implementing a single clean trait — small enough for an LLM to generate a working game in one shot.

## Core Value

The engine must make it trivially easy to add a new pose-based game by implementing a well-defined plugin interface — without touching the engine core or understanding its internals.

## Requirements

### Validated

- ✓ Real-time WebSocket pose streaming from mobile browsers — existing
- ✓ Server-authoritative hit detection and game state — existing
- ✓ Spectator overlay with Pixi.js silhouette rendering — existing
- ✓ AI commentary via Claude + ElevenLabs — existing
- ✓ Room management with 6-char codes — existing
- ✓ RTT-fairness input delay buffer — existing
- ✓ Calibration handshake (reference velocity) — existing
- ✓ Docker + Railway deployment — existing

### Validated

- ✓ Rust game engine core: Axum + Tokio WebSocket server — Phase 1
- ✓ Game plugin trait (`GamePlugin`, `TickContext`, `GameEvent`) — Phase 2
- ✓ Boxing game plugin with hit detection, damage, bot mode — Phase 2
- ✓ Calibration-persist bug fixed (`reference_velocity` lives on PlayerSlot for Room lifetime) — Phase 2
- ✓ Spectator reconnect snapshot (HP, wins, round, elapsed time sent on join) — Phase 1
- ✓ DancePlugin: second game validates the trait generalizes — Phase 3
- ✓ SDK documentation (GAME-SDK.md 800 lines, full Rustdoc, 100 tests) — Phase 3

### Active

- [ ] Lobby UX: SPECTRE landing page with game picker, Create Room, Join by code — Phase 4
- [ ] Room page (`/rooms/{code}`): P1/P2/Overlay QR cards with prefilled URLs — Phase 4
- [ ] Mobile fast-join: QR-prefilled params → one-tap connection screen — Phase 5
- [x] Overlay fidelity: Achafont restored, all DESIGN.md spec gaps closed — Phase 6 (complete 2026-05-10)
- [ ] Dance engine wiring: `game_type` in `MsgJoined`, dance calibration skip, `MsgDanceBeat`/`MsgDanceScore` TypeScript types — Phase 7
- [ ] Dance UX design: DESIGN.md dance section, PRODUCT.md two-mode update — Phase 8
- [ ] Dance frontend: game-type-aware overlay HUD, target pose skeleton in Pixi.js, dance match end, mobile calibration skip — Phase 9

### Out of Scope

- Browser-based game IDE — UX for AI generation is deferred; focus is the trait interface quality
- Horizontal scaling / room sharding — single-process Tokio is sufficient for current use
- User accounts, authentication tokens — 6-char room code access model retained
- Replacing TypeScript clients — mobile and overlay apps are unchanged; only the server is rewritten

## Context

The existing Python/FastAPI server is feature-complete but has structural limits: a single-threaded asyncio loop, Pydantic serialization in the 60Hz hot path, and NumPy allocations at 240/s per room. These are not yet causing visible pain but will become a ceiling as concurrent rooms grow.

The codebase already has a detailed map (`.planning/codebase/`) and the concerns document explicitly anticipated this Rust migration. The wire protocol (`shared/protocol.ts` ↔ `server/protocol.py`) is the integration boundary — the Rust server must speak exactly the same JSON wire format so the TypeScript clients are untouched.

Two known bugs must be fixed during the rewrite (not after):
1. `reset_for_rematch` sets `reference_velocity = None`, forcing recalibration every rematch
2. Spectator reconnect resets local win counters; server sends no state snapshot on spectator join

The game plugin abstraction is the most architecturally important decision in the project. Boxing is a proof — a second game validates that the abstraction generalizes. AI generation is the long-term payoff: if the interface is clean enough for a human developer to implement in ~100 lines of Rust, it's clean enough for Claude to generate.

## Constraints

- **Language**: Rust — Axum + Tokio for async WebSocket server; no Python in the server path
- **Protocol**: Wire format must be byte-for-byte compatible with existing `shared/protocol.ts` — no client changes
- **Deployment**: Docker multi-stage build + Railway; same `railway.toml` shape
- **Game loop**: 60Hz authoritative tick must be maintained; RTT fairness input delay preserved
- **Plugin interface**: Game trait must be well-defined enough that a developer (or LLM) can implement a new game without knowing engine internals — no artificial method count limit, but the engine/game boundary must be explicit and non-leaky

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Rust for full server rewrite (not PyO3 shim) | Python GIL prevents parallelism; Pydantic/NumPy overhead in hot path; clean break is simpler than hybrid | — Pending |
| Axum + Tokio (not Actix) | Better ecosystem ergonomics, `tower` middleware composability, user preference | — Pending |
| Game plugin as Rust trait (not scripting/WASM) | Keeps the hot path native; compile-time safety; runtime flexibility not needed for this use case | — Pending |
| Boxing is first plugin, not built into engine | Forces the engine/game boundary to be real before a second game tests it | — Pending |
| Wire protocol unchanged | TypeScript clients are not part of this rewrite; preserving them eliminates a whole class of risk | — Pending |
| Commentary ported last | Async HTTP (reqwest + tokio) is straightforward in Rust, but it's a separate concern from game engine correctness | — Pending |

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
*Last updated: 2026-05-10 — Phase 6 complete: Achafont restored, all 18 DESIGN.md CSS deviations closed, overlay spec-compliant.*
