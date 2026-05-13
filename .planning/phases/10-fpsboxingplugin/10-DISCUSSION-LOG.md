# Phase 10: FPSBoxingPlugin - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 10-FPSBoxingPlugin
**Areas discussed:** Hit detection sharing, Protocol message placement, Arm landmark format in MsgFpsState, Bot and guard scope

---

## Hit Detection Sharing

| Option | Description | Selected |
|--------|-------------|----------|
| New `boxing-core` crate | Extract hit_detection.rs + damage.rs into a shared crate; both boxing-plugin and fps-boxing-plugin depend on it | ✓ |
| fps-boxing depends on boxing-plugin | Add boxing-plugin as dep of fps-boxing-plugin; pub re-export detect_punch / compute_damage | |
| Duplicate and diverge | Copy hit_detection.rs into fps-boxing-plugin (violates FPSP-02) | |

**User's choice:** New `boxing-core` crate (recommended)
**Notes:** Both boxing-plugin and fps-boxing-plugin refactored to use boxing-core — deletes internal copies from boxing-plugin. bot.rs stays in boxing-plugin for now; deferred to Phase 14.

---

## Protocol Message Placement

| Option | Description | Selected |
|--------|-------------|----------|
| engine-core/protocol.rs + shared/protocol.ts | Typed structs in Rust, generated TypeScript; follows DancePlugin pattern | ✓ |
| Ad-hoc JSON in fps-boxing-plugin | serde_json::json! inline, no protocol.rs changes | |

**User's choice:** engine-core/protocol.rs + shared/protocol.ts (recommended)
**Notes:** MsgFpsState = 6 arm landmarks + HP + round_timer (minimum per FPSP-03). MsgFpsHit = punch_type + damage. punch_type reuses existing boxing string enum values.

---

## Arm Landmark Format in MsgFpsState

| Option | Description | Selected |
|--------|-------------|----------|
| Named struct fields | left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist — each a PoseKeypoint | ✓ |
| Ordered array of 6 keypoints | arm_landmarks: [PoseKeypoint; 6], index-ordered | |
| x + y + visibility only (no z) | Omit z per plugin-trait docs ("near-zero, safe to ignore") | |
| Full PoseKeypoint (x, y, z, visibility) | Reuse existing type; include z for depth | ✓ |

**User's choice:** Named struct fields + full PoseKeypoint (x, y, z, visibility)
**Notes:** User noted z-coordinates are needed for first-person arm depth positioning in Phase 14. Named fields preferred for self-documenting protocol. Opponent landmarks only — each player captures their own pose locally.

---

## Bot and Guard Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Omit entirely | Phase 14 adds bot and guard fresh when client exists | ✓ |
| Include disabled stubs | Add bot.rs and guard detection disabled by config flag | |

**User's choice:** Omit entirely (recommended)
**Notes:** GML-03 and GML-04 are Phase 14 requirements. No stubs in Phase 10.

---

## Claude's Discretion

None — all areas had a clear user decision.

## Deferred Ideas

- **MediaPipe z-depth reliability (Phase 13):** User raised concern mid-discussion about whether MediaPipe provides reliable z-coordinates. Noted for Phase 13 model selection evaluation.
- **Bot mode (GML-03):** Phase 14
- **Guard blocking (GML-04):** Phase 14
