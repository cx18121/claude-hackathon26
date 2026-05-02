---
phase: 02-plugin-trait-boxing
plan: "02"
subsystem: boxing-plugin
tags: [rust, boxing, hit-detection, damage, tdd]
dependency_graph:
  requires: ["02-01"]
  provides: ["engine/boxing-plugin/src/damage.rs", "engine/boxing-plugin/src/hit_detection.rs", "engine/boxing-plugin/src/lib.rs"]
  affects: ["02-03", "02-04"]
tech_stack:
  added: []
  patterns: ["TDD RED/GREEN", "pure-Rust velocity arithmetic", "VecDeque sliding window", "Y-up coordinate convention"]
key_files:
  created:
    - engine/boxing-plugin/src/lib.rs
    - engine/boxing-plugin/src/bot.rs
    - engine/boxing-plugin/src/damage.rs
    - engine/boxing-plugin/src/hit_detection.rs
  modified: []
decisions:
  - "Velocity-relative punch threshold scales with ref_velocity (PUNCH_THRESHOLD/3.0 * ref_vel) rather than fixed 2.5 m/s — intentional deviation from Python to make threshold proportional to calibrated pace"
  - "speed_3d exported as pub with #[allow(dead_code)] — Plan 03 will use it; avoids spurious lint warning"
  - "detect_kick ignores ref_velocity parameter (uses fixed KICK_THRESHOLD=2.0) — matches Python _kick_threshold behavior at default ref_vel"
metrics:
  duration: "4 minutes"
  completed_date: "2026-05-02"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
  tests_added: 11
---

# Phase 2 Plan 02: Boxing Utility Modules (damage.rs + hit_detection.rs) Summary

**One-liner:** Pure-Rust port of server/hit_detection.py and server/damage.py — velocity-scaled damage (9 regions), punch/kick detection with guard-raise veto, guard blocking, and Y-up coordinate convention.

## What Was Built

### Task 1: boxing-plugin crate skeleton and damage.rs

Created the boxing-plugin crate files needed for compilation and the complete damage module:

- **engine/boxing-plugin/src/lib.rs** — module declarations (`mod hit_detection`, `mod damage`, `mod bot`), public re-exports, and `HIT_COOLDOWN_TICKS = 12` constant
- **engine/boxing-plugin/src/bot.rs** — `Difficulty` enum stub (Plan 03 fills in bot logic)
- **engine/boxing-plugin/src/damage.rs** — `base_damage()` with all 9 `BodyRegion` match arms; `compute_damage()` implementing the linear velocity-scaled formula from `server/damage.py`

All 5 damage unit tests pass:
- `compute_damage_at_ref_vel_is_midpoint_head_face` — t=0.5, raw=17.5, rounds to 18
- `compute_damage_zero_velocity_returns_base_min` — t=0, raw=base_min=20
- `compute_damage_double_ref_vel_returns_base_max` — t=1.0, raw=base_max=4
- `compute_damage_no_ref_vel_uses_fallback_3` — fallback ref=3.0, raw=6.75→7
- `compute_damage_extreme_vel_clamped_to_base_max` — t clamped to 1.0

### Task 2: hit_detection.rs

Complete port of `server/hit_detection.py` as `engine/boxing-plugin/src/hit_detection.rs`:

**Constants:** All 8 landmark indices (WRIST_LEFT through RIGHT_SHOULDER), all threshold constants (REL_HEAD_Y=1.45, REL_TORSO_HI_Y=0.70, REL_KICK_MID_Y=-0.30, REL_GUARD_HEAD_Y=1.10, REL_GUARD_TORSO_Y=0.35, DEFAULT_BODY_SCALE=0.30, PUNCH_THRESHOLD=2.5, KICK_THRESHOLD=2.0)

**Velocity helpers:**
- `velocity_3d()` — central-difference velocity over last 3 frames
- `peak_speed()` — max speed across consecutive frame pairs (VecDeque windows)
- `speed_3d()` — 3D magnitude helper (exported for Plan 03)

**Body geometry:**
- `body_scale()` — hip-to-shoulder distance clamped [0.12, 0.55]; Y-up adapted (shoulder_y > hip_y)
- `classify_region()` — maps target_y to HeadFace/TorsoUpper/TorsoLower/LegThigh
- `refine_head_region()` — subdivides HeadFace into HeadChin/HeadFace/HeadThroat

**Guard logic:**
- `is_primarily_upward()` — `vel.1 > |vx| + |vz|` (Y-up convention; Python uses `vy < 0` for MediaPipe Y-down)
- `apply_guard()` — reclassifies HeadFace→BlockHand, TorsoUpper→BlockForearm when wrists above guard thresholds

**Public API:**
- `detect_punch()` — guard-raise veto, velocity-relative threshold, wrist peak speed, region classification, guard application
- `detect_kick()` — ankle peak speed, ankle elevation check (REL_KICK_MID_Y), lower-body region classification
- `HitResult` struct — region, velocity (f64), position (f64, f64)

**Unit tests (6 hit_detection + 5 damage = 11 total):**
- `detect_punch_empty_frames_returns_none`
- `body_scale_normal_pose` — expects ~0.3 for shoulder_y=0.3, hip_y=0.0
- `body_scale_clamped_minimum` — tiny scale clamped to 0.12
- `is_primarily_upward_positive_vy_dominates` — Y-up: positive vy = upward
- `is_primarily_upward_lateral_motion_not_upward` — lateral motion is not upward
- `guard_raise_veto_prevents_punch` — both wrists moving up → None

## Verification Results

```
cargo test -p boxing-plugin   → 11 passed, 0 failed
cargo build -p boxing-plugin  → Finished (exit 0)
grep -c detect_punch|detect_kick|HitResult hit_detection.rs → 3
grep "vel.1 >" hit_detection.rs → vel.1 > vel.0.abs() + vel.2.abs()
grep -c BodyRegion:: damage.rs → 14 (9 match arms + 5 test references)
```

## Deviations from Plan

### Design Decisions (Intentional)

**1. [Rule N/A - Design Decision] Velocity-relative punch threshold**
- **Found during:** Task 2 implementation
- **What:** Plan specified `threshold = ref_vel * (PUNCH_THRESHOLD / 3.0)` as an intentional deviation from Python's fixed threshold. Implemented as specified.
- **Rationale:** Threshold scales with calibrated pace so all players have equal trigger difficulty regardless of how fast they move.
- **Files:** `engine/boxing-plugin/src/hit_detection.rs`

**2. [Rule N/A - Design Decision] speed_3d exported pub with #[allow(dead_code)]**
- **Found during:** Task 2 cleanup
- **What:** `speed_3d` is a utility function not called by Task 2 code directly but needed by Plan 03's bot logic.
- **Fix:** Exported as `pub` with `#[allow(dead_code)]` to suppress lint warning without removing the function.
- **Files:** `engine/boxing-plugin/src/hit_detection.rs`

## Known Stubs

- `engine/boxing-plugin/src/bot.rs` — `Difficulty` enum only; `tick_bot` and bot constants deferred to Plan 03 (BOX-10)
- `engine/boxing-plugin/src/lib.rs` — stub for `detect_kick`'s `_ref_velocity` parameter (kick threshold currently fixed; future plan may make it velocity-relative)

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. Files are pure computation with no I/O. The threat mitigations from the plan's threat register are applied:

- **T-02-06** (tampering via reference_velocity): `compute_damage` guards with `max(ref_v, 0.1)` to prevent division near zero — implemented.
- **T-02-07** (phantom hits from manipulated keypoints): `peak_speed` requires sustained wrist speed across multiple consecutive frames — implemented via VecDeque window scan.

## TDD Gate Compliance

Both tasks used TDD:
- Task 1 RED: `compute_damage` function absent → compilation failure confirmed
- Task 1 GREEN: full `compute_damage` implementation → 5 tests pass
- Task 2 RED: `detect_punch`/`detect_kick` were `todo!()` stubs → compilation failure if tests existed
- Task 2 GREEN: full hit_detection implementation → 6 new tests pass, all 11 total pass

## Self-Check: PASSED

All created files exist on disk. Both task commits found in git log.
