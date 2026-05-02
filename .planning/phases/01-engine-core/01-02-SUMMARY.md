---
phase: "01-engine-core"
plan: "02"
subsystem: "engine-core/protocol"
tags: ["rust", "serde", "testing", "fixtures", "protocol", "golden-file"]
dependency_graph:
  requires: ["01-01"]
  provides: ["protocol_roundtrip_tests", "json_fixtures", "capture_fixtures_script"]
  affects: ["engine-core", "scripts"]
tech_stack:
  added: ["serde_json (test integration)", "golden-file test pattern"]
  patterns: ["golden-file roundtrip tests", "cargo integration test with env!('CARGO_MANIFEST_DIR')"]
key_files:
  created:
    - engine/engine-core/tests/protocol_roundtrip.rs
    - engine/engine-core/tests/fixtures/msg_ping.json
    - engine/engine-core/tests/fixtures/msg_pong.json
    - engine/engine-core/tests/fixtures/msg_joined.json
    - engine/engine-core/tests/fixtures/msg_pose_frame.json
    - engine/engine-core/tests/fixtures/msg_game_state.json
    - engine/engine-core/tests/fixtures/msg_lobby_update.json
    - engine/engine-core/tests/fixtures/msg_round_start.json
    - engine/engine-core/tests/fixtures/msg_round_end.json
    - engine/engine-core/tests/fixtures/msg_round_end_draw.json
    - engine/engine-core/tests/fixtures/msg_pose_update.json
    - engine/engine-core/tests/fixtures/msg_calibration_done.json
    - engine/engine-core/tests/fixtures/msg_match_start.json
    - engine/engine-core/tests/fixtures/msg_match_end.json
    - engine/engine-core/tests/fixtures/msg_player_disconnected.json
    - engine/engine-core/tests/fixtures/msg_calibration_start.json
    - engine/engine-core/tests/fixtures/msg_rematch_start.json
    - engine/engine-core/tests/fixtures/msg_you_were_hit.json
    - engine/engine-core/tests/.gitkeep
    - engine/engine-core/src/lib.rs
    - scripts/capture_fixtures.py
  modified:
    - engine/engine-core/Cargo.toml
    - scripts/gen_protocol.py
decisions:
  - "D-04 applied: gen_protocol.py replaced with deprecation guard (sys.exit(1)); ts-rs is now the sole source of protocol.ts generation"
  - "D-05: capture_fixtures.py connects to ws://localhost:8000 for live fixture capture against Python server; handcrafted fixtures unblock CI"
  - "18 tests written (17 per-type roundtrips + inbound_mobile_msg_discriminator) instead of minimum 12 — full coverage of all fixture types"
  - "lib.rs added to expose engine_core::protocol to integration tests; [lib] section added to Cargo.toml"
metrics:
  duration: "175 seconds"
  completed_date: "2026-05-02T15:33:59Z"
  tasks_completed: 2
  files_created: 22
  files_modified: 2
---

# Phase 01 Plan 02: Protocol Fixtures and Roundtrip Tests Summary

**One-liner:** 17 golden-file JSON fixtures and 18 Cargo integration tests proving serde roundtrip correctness for all wire message types, with deprecation guard on gen_protocol.py (D-04).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write handcrafted golden-file fixtures | 60e60f3 | 18 files (17 fixtures + .gitkeep) |
| 2 | protocol_roundtrip.rs + capture_fixtures.py + deprecate gen_protocol.py | b831748 | 5 files (lib.rs, Cargo.toml, roundtrip.rs, capture_fixtures.py, gen_protocol.py) |

## What Was Built

**Fixture files (17):** One JSON file per wire message type under `engine/engine-core/tests/fixtures/`. Each fixture matches the field names and discriminator literals defined in `shared/protocol.ts`. Notable cases:
- `msg_round_end_draw.json` uses `"winner": null` for draw semantics
- `msg_game_state.json` includes the `wins` field (FIX-02) and `poses` as array-of-arrays
- All tuples in Rust structs (`hp`, `wins`, `final_hp`, `poses`) serialize as JSON arrays, matching Python server output

**Integration test suite (`protocol_roundtrip.rs`):** 18 tests, all passing. Tests use `env!("CARGO_MANIFEST_DIR")` to construct absolute fixture paths, making them portable across working directories. The `inbound_mobile_msg_discriminator` test validates all 5 inbound variants without fixture files (inline JSON).

**`scripts/capture_fixtures.py`:** Ready to connect to a live Python server at `ws://localhost:8000` and overwrite fixtures with real wire captures for `msg_joined`, `msg_pong`, and `msg_lobby_update`. Synthetic fixtures for all other types are written only if the file doesn't exist (no overwrite of live captures).

**`engine/engine-core/src/lib.rs`:** Exposes `pub mod protocol` so integration tests can use `engine_core::protocol::*`. The `[lib]` section was added to `Cargo.toml` alongside the existing `[[bin]]`.

**Deprecation guard (`scripts/gen_protocol.py`):** D-04 applied. The old code-gen script is replaced with a message to stderr and `sys.exit(1)`. Cannot silently overwrite `shared/protocol.ts`.

## Deviations from Plan

### Auto-added (beyond minimum)

**1. [Rule 2 - Completeness] Added roundtrip tests for 6 additional message types**
- **Found during:** Task 2
- **Issue:** Plan specified >= 12 tests; 6 message types (MsgMatchStart, MsgMatchEnd, MsgPlayerDisconnected, MsgCalibrationStart, MsgRematchStart, MsgYouWereHit) had fixtures created in Task 1 but no tests in the plan's skeleton
- **Fix:** Added 6 additional roundtrip tests for full coverage of all fixture files
- **Result:** 18 tests total instead of minimum 12

## Threat Surface Scan

No new network endpoints or auth paths introduced. Fixture files contain only synthetic game data (no PII). The deprecation guard on `gen_protocol.py` directly mitigates threat T-02-04 (tampering via accidental script execution).

## Known Stubs

None. Fixture data is intentionally synthetic — this is the expected state for Phase 1.

## Self-Check: PASSED

All files exist. Both commits verified. 17 fixtures, 18 tests confirmed.
