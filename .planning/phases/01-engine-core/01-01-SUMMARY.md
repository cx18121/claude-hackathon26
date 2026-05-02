---
phase: 01-engine-core
plan: "01"
subsystem: infra
tags: [rust, axum, tokio, serde, ts-rs, websocket, protocol]

# Dependency graph
requires: []
provides:
  - Cargo workspace with engine-core member and resolver 2
  - ts-rs export config pointing to shared/ directory
  - All 20 wire protocol types (structs + embedded types) with serde + ts-rs derives
  - InboundMobileMsg enum covering all 5 inbound variants via serde internally-tagged deserialization
  - Axum router skeleton with /ws/player/:room_code, /ws/spectator/:room_code, /mobile, /overlay
  - Room expiry background task (D-08)
  - Stub modules for room, room_manager, input_delay, broadcast, game_loop
affects: [02-game-plugin-trait, 03-boxing-plugin, 04-room-actor, 05-dockerfile]

# Tech tracking
tech-stack:
  added:
    - axum 0.8.9 (HTTP + WebSocket server with ws feature)
    - tokio 1.52.1 (async runtime, full features)
    - serde 1.0.228 + serde_json 1.0.149 (JSON serialization)
    - dashmap 6.1.0 (concurrent room registry)
    - tower-http 0.6.8 (ServeDir static file serving)
    - ts-rs 12.0.1 with serde-compat (TypeScript binding generation)
    - tracing 0.1.44 + tracing-subscriber 0.3.23 (structured logging)
    - rand 0.8.6 (room code generation)
    - futures-util 0.3, tokio-stream 0.1
  patterns:
    - default_type_X() fn pattern for guaranteed type literal serialization on outbound structs
    - serde(tag = "type") internally-tagged enum for inbound message dispatch
    - ts(export) on individual structs; NOT on discriminated union enum
    - tokio::net::TcpListener + axum::serve (not deprecated axum::Server::bind)
    - AppState behind Arc<> for shared state in Axum handlers

key-files:
  created:
    - engine/Cargo.toml
    - engine/.cargo/config.toml
    - engine/engine-core/Cargo.toml
    - engine/engine-core/src/protocol.rs
    - engine/engine-core/src/main.rs
    - engine/engine-core/src/room_manager.rs
    - engine/engine-core/src/room.rs
    - engine/engine-core/src/input_delay.rs
    - engine/engine-core/src/broadcast.rs
    - engine/engine-core/src/game_loop.rs
  modified: []

key-decisions:
  - "Rust installed via rustup (not present in environment) — auto-fixed per Rule 3"
  - "MsgGameState.wins: (u32,u32) added per FIX-02 — overlay win counter survives spectator reconnect"
  - "InboundMobileMsg uses serde(tag=type) internally-tagged enum; inner structs retain msg_type field with rename=type for correct serde behavior"
  - "ts-rs generates bindings to .claude/worktrees/shared/ in worktree context due to path depth; correct in production repo where ../../shared resolves to repo root shared/"

patterns-established:
  - "Wire type pattern: each outbound struct has msg_type: String with serde(rename=type, default=default_type_X) and #[ts(export)]"
  - "Inbound enum pattern: InboundMobileMsg with serde(tag=type) and per-variant renames"
  - "Router pattern: tokio::net::TcpListener bind + axum::serve + Arc<AppState> with_state"
  - "Static serving: ServeDir::new(path) via nest_service"

requirements-completed: [ENG-01, ENG-12, PROTO-01, PROTO-03]

# Metrics
duration: 4min
completed: 2026-05-02
---

# Phase 01 Plan 01: Cargo Workspace, Protocol Types, and Axum Router Skeleton Summary

**Rust Cargo workspace with 20 wire protocol types (ts-rs + serde), Axum router serving /ws/player, /ws/spectator, /mobile, /overlay with WebSocket upgrade stubs**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-02T15:25:15Z
- **Completed:** 2026-05-02T15:26:50Z
- **Tasks:** 3
- **Files modified:** 10 created

## Accomplishments

- Cargo workspace with engine-core member; all dependencies pinned to RESEARCH.md versions; `cargo build` exits 0
- All 20 wire protocol types implemented in protocol.rs: 17 message structs + PoseKeypoint, Position, HitEvent; each exported to TypeScript via ts-rs; MsgGameState includes wins field per FIX-02
- Axum router with WebSocket routes, static file serving, TcpListener startup; expiry task wired; no deprecated axum::Server::bind

## Task Commits

1. **Task 1: Cargo workspace, package manifests, ts-rs export config** - `351a88d` (chore)
2. **Task 2: protocol.rs — all wire message types** - `2556011` (feat)
3. **Task 3: main.rs — Axum router, WebSocket stubs, static serving** - `6387a36` (feat)

## Files Created/Modified

- `engine/Cargo.toml` — workspace manifest with engine-core member, resolver 2
- `engine/.cargo/config.toml` — TS_RS_EXPORT_DIR env config for ts-rs binding output
- `engine/engine-core/Cargo.toml` — package manifest with all required dependencies
- `engine/engine-core/src/protocol.rs` — all 20 wire message types with serde + ts-rs derives, InboundMobileMsg enum
- `engine/engine-core/src/main.rs` — Axum router, AppState, WebSocket handler stubs, static file serving, expiry task
- `engine/engine-core/src/room_manager.rs` — minimal stub: RoomManager with DashMap, expiry_task
- `engine/engine-core/src/room.rs` — stub (Plan 02)
- `engine/engine-core/src/input_delay.rs` — stub (Plan 02)
- `engine/engine-core/src/broadcast.rs` — stub (Plan 04)
- `engine/engine-core/src/game_loop.rs` — stub (Plan 03)

## Decisions Made

- Used `default_type_X()` fn per struct (not `&'static str` type) for `msg_type` to avoid ts-rs lifetime complications
- `MsgRoundEnd.winner` typed as `Option<u8>` without `skip_serializing_if` so None serializes as JSON null (matching TypeScript `winner: 1 | 2 | null`)
- `MsgGameState.wins: (u32, u32)` added per FIX-02 — required for spectator overlay reconnect correctness (REQUIREMENTS.md FIX-02)
- Room expiry task calls `state.rooms.rooms.clone()` to pass the DashMap directly (avoids holding Arc<RoomManager> in background task)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed Rust/Cargo (not present in environment)**
- **Found during:** Task 1 (pre-verification)
- **Issue:** `cargo` not on PATH; Rust not installed on the machine
- **Fix:** Installed via `curl https://sh.rustup.rs | sh -s -- -y --no-modify-path`; sourced `$HOME/.cargo/env`
- **Files modified:** None (environment setup only)
- **Verification:** `cargo --version` returns 1.95.0
- **Committed in:** N/A (environment, not code)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing tool)
**Impact on plan:** Rust installation was required to build and verify the plan. No scope creep.

## Issues Encountered

- ts-rs export path resolves to `.claude/worktrees/shared/` in worktree context (one extra directory depth vs. production). In the main repo, `../../shared` from `engine/` correctly resolves to repo root `shared/`. All 20 TypeScript binding files were generated; the configuration is correct for production use.

## Known Stubs

- `engine/engine-core/src/room.rs` — empty; wired in Plan 02
- `engine/engine-core/src/room_manager.rs` — minimal stub; DashMap+expiry_task only; full actor integration in Plan 03
- `engine/engine-core/src/input_delay.rs` — empty; ported in Plan 02
- `engine/engine-core/src/broadcast.rs` — empty; spectator fan-out in Plan 04
- `engine/engine-core/src/game_loop.rs` — empty; 60Hz tick in Plan 03
- `handle_player` and `handle_spectator` in main.rs — log + drop socket; wired to room actor in Plan 03

## Threat Flags

No new threat surface beyond the plan's threat model. T-01-01 mitigated: `InboundMobileMsg` serde deserialization rejects unknown `type` values with a deserialize error (log-and-continue pattern will be added in Plan 03 when the receive loop is wired).

## Next Phase Readiness

- Cargo workspace compiles; all downstream plans can import types from `protocol.rs`
- All 19 wire message structs exist per plan spec (19 message types + HitEvent, Position, PoseKeypoint embedded)
- Plan 02 can add game plugin trait and boxing plugin against protocol.rs types
- Plan 03 can add room actor and wire ws_player/ws_spectator handlers

## Self-Check: PASSED

- `engine/Cargo.toml` — FOUND
- `engine/.cargo/config.toml` — FOUND
- `engine/engine-core/Cargo.toml` — FOUND
- `engine/engine-core/src/protocol.rs` — FOUND
- `engine/engine-core/src/main.rs` — FOUND
- Commits 351a88d, 2556011, 6387a36 — FOUND in git log

---
*Phase: 01-engine-core*
*Completed: 2026-05-02*
