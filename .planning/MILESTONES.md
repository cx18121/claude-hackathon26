# Milestones: PoseEngine

## v1.0 — PoseEngine MVP

**Shipped:** 2026-05-10
**Phases:** 9 | **Plans:** 28 | **Tasks:** ~60

### Delivered

A complete pose-based multiplayer game engine with two shipped games (boxing and dance), full lobby UX, mobile fast-join flow, overlay fidelity, and AI-generation-ready SDK documentation. The engine was rewritten from Python to Rust (Axum + Tokio) — same wire protocol, no client changes.

### Key Accomplishments

1. **Rust engine rewrite** — Full Axum + Tokio server replacing Python/FastAPI; 60Hz authoritative game loop, actor-per-room model, RTT fairness input delay, spectator reconnect snapshots
2. **GamePlugin trait** — Object-safe Rust trait proved by two games; boxing plugin with hit detection, damage, guard blocking, and bot mode
3. **Two-game validation** — DancePlugin implemented with zero engine changes, proving the abstraction generalizes; cosine similarity pose scoring with beat clock
4. **SDK documentation** — 800-line GAME-SDK.md developer guide + full Rustdoc; sufficient for an LLM to generate a new game in one shot
5. **Lobby + mobile UX** — SPECTRE landing page, QR room cards, mobile fast-join (one-tap from QR scan), distinct connection error messages
6. **Dance frontend** — Game-type-aware overlay (DanceHud, beat countdown bar, target pose skeleton in Pixi.js with fade animation), dance match end screen, mobile calibration skip
7. **Test coverage** — 201 Rust tests + 19 overlay Vitest tests + 50 mobile tests; Vitest set up for overlay from scratch

### Timeline

- Start: 2026-04-25
- Ship: 2026-05-10
- Duration: 15 days

### Tech Stack Shipped

- **Engine:** Rust 1.86, Axum 0.8, Tokio, DashMap, serde_json, qrcode
- **Overlay:** React 18, Pixi.js 8, TypeScript, Vitest
- **Mobile:** React 18, TypeScript, Vitest
- **Deploy:** Docker multi-stage + Railway

### Known Gaps at Close

None — all 67 v1 requirements verified. Two compile errors fixed post-execution (PixiCanvas skeletonGfx scope, useSpectatorSocket type narrowing).

### Archive

- Roadmap: `.planning/milestones/v1.0-ROADMAP.md`
- Requirements: `.planning/milestones/v1.0-REQUIREMENTS.md`
