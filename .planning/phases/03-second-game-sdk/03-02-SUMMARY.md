---
phase: 03-second-game-sdk
plan: "02"
subsystem: engine-core
tags: [rust, axum, plugin-registry, lobby, http-routes, dance-plugin]
dependency_graph:
  requires:
    - engine/dance-plugin (DancePlugin, DanceConfig — built in plan 03-01)
    - engine/boxing-plugin (BoxingPlugin, BoxingConfig — built in phase 02)
    - engine/plugin-trait (GamePlugin trait)
    - engine/engine-core/src/room_manager.rs (create_room, expiry_task)
  provides:
    - engine/engine-core/src/main.rs (plugin registry, POST /rooms, GET / lobby, Option A ws_player)
    - engine/engine-core/Cargo.toml (dance-plugin dependency)
  affects:
    - WebSocket player connection flow (Option A enforcement)
    - HTTP surface (two new routes: GET /, POST /rooms)
tech_stack:
  added:
    - dance-plugin crate dependency in engine-core
    - axum::extract::Query for query param parsing
    - axum::routing::post for POST handler
    - serde Deserialize/Serialize for request/response structs
    - std::collections::HashMap for plugin registry
  patterns:
    - Plugin registry as HashMap built before Arc::new (immutable-after-wrap, Pitfall 2)
    - POST /rooms validates game param via registry lookup (unknown → 400 BAD_REQUEST)
    - Option A ws_player: early return with tracing::warn on unknown room code
    - Lobby HTML as Rust const &str (zero filesystem reads, no amplification vector)
    - OKLCH color tokens in :root CSS custom properties
key_files:
  created: []
  modified:
    - engine/engine-core/Cargo.toml (added dance-plugin dependency)
    - engine/engine-core/src/main.rs (plugin registry, two new routes, Option A, lobby HTML)
decisions:
  - "Registry built as HashMap before Arc::new — cannot mutate after wrapping (Pitfall 2 prevention)"
  - "ws_player Option A: no on-demand room creation; unknown room_code returns early with warn log"
  - "Lobby HTML as const &str: zero filesystem read latency, no external resource, no amplification"
  - "POST /rooms defaults game param to boxing when absent (backward-compatible)"
  - "Error response echoes game name (T-03-P2-04 accepted — game names are not secrets)"
metrics:
  duration: "8 minutes"
  completed_date: "2026-05-02"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 3 Plan 02: Engine Wiring — Plugin Registry, Routes, Lobby Summary

**One-liner:** Dance plugin wired into engine via HashMap registry replacing single plugin; POST /rooms and GET / lobby added; ws_player Option A enforced — server now supports game selection per room.

## What Was Built

Two-task implementation wiring the dance plugin into the engine core and adding the HTTP surface for game selection.

### Task 1: Cargo.toml dependency

Added `dance-plugin = { path = "../dance-plugin" }` to `engine/engine-core/Cargo.toml` [dependencies] section — one line after `boxing-plugin`.

### Task 2: main.rs surgical rewrite (5 targeted changes)

| Change | Description |
|--------|-------------|
| Imports | Added `Query`, `post`, `Json`, `HashMap`, `serde`, `dance_plugin` |
| AppState | Replaced `plugin: Arc<dyn GamePlugin>` with `plugins: HashMap<String, Arc<dyn GamePlugin>>` |
| main() | Built HashMap registry before Arc::new; registered "boxing" and "dance"; added two new routes |
| ws_player | Option A: unknown room → `tracing::warn` + early return (removed on-demand creation) |
| New handlers | `lobby_html()` serving `LOBBY_HTML` const; `create_room()` POST handler; supporting structs |

## Registry Approach

`HashMap<String, Arc<dyn GamePlugin + Send + Sync>>` is constructed before `Arc::new(AppState { ... })`. This guarantees the map is immutable after wrapping — no runtime mutation path exists. This directly addresses Pitfall 2 from the RESEARCH.md.

## ws_player Option A Rationale

The lobby flow is: operator visits GET /, clicks a game button → POST /rooms returns a 6-char code → operator hands code to players who enter it in the mobile app. On-demand room creation from ws_player would bypass game selection entirely (all rooms would be boxing). Option A removes this shortcut and makes the lobby the only room creation path.

## UI-SPEC Compliance

| Token / Property | Value in code | Verified |
|-----------------|---------------|---------|
| `--bg-deep` | `oklch(7% 0.008 22)` | yes |
| `--bg-mid` | `oklch(11% 0.009 22)` | yes |
| `--bg-surface` | `oklch(17% 0.01 22)` | yes |
| `--accent` | `oklch(44% 0.22 22)` | yes |
| `--accent-bright` | `oklch(60% 0.25 22)` | yes |
| `--text-primary` | `oklch(95% 0.008 85)` | yes |
| `--text-secondary` | `oklch(65% 0.008 85)` | yes |
| `--text-dim` | `oklch(38% 0.006 85)` | yes |
| button `min-height` | `52px` | yes |
| h1 `font-size` | `1.75rem` | yes |
| h1 `font-weight` | `800` | yes |
| h1 `text-transform` | `uppercase` | yes |
| h1 `letter-spacing` | `0.12em` | yes |
| `#room-code` `font-size` | `2rem` | yes |
| `#room-code` `letter-spacing` | `0.2em` | yes |
| `#room-code.error` color | `#ff9b9b` | yes |
| Network error copy | `Could not reach server` | yes |
| Button disabled on click | `buttons.forEach(b => b.disabled = true)` | yes |
| Re-enable in finally | `buttons.forEach(b => b.disabled = false)` | yes |
| Error class on #room-code | `rc.className = 'error'` | yes |

## Build Verification

```
cargo build --workspace
Finished `dev` profile [unoptimized + debuginfo] target(s) in 22.54s
```

Exits 0. All warnings are pre-existing (MsgPlayerDisconnected unused, etc.) — none introduced by this plan.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both plugins are fully instantiated with real configs. The lobby HTML is fully functional. POST /rooms creates real rooms via `room_manager::RoomManager::create_room`.

## Threat Surface Scan

Two new HTTP routes introduced:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-http-endpoint | engine/engine-core/src/main.rs | POST /rooms?game= — validates game param via registry; unknown → 400; covered by T-03-P2-01 |
| threat_flag: new-http-endpoint | engine/engine-core/src/main.rs | GET / — static const &str response; no user input; covered by T-03-P2-05 |

Both threats were anticipated in the plan's `<threat_model>` (T-03-P2-01 and T-03-P2-05). No unplanned threat surface.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1: Cargo.toml dep | `a1932cc` | Add dance-plugin dependency to engine-core Cargo.toml |
| 2: main.rs rewrite | `5477333` | Plugin registry, POST /rooms, GET / lobby, ws_player Option A |

## Self-Check: PASSED

Files exist:
- engine/engine-core/Cargo.toml: FOUND
- engine/engine-core/src/main.rs: FOUND

Commits exist:
- a1932cc: FOUND
- 5477333: FOUND
