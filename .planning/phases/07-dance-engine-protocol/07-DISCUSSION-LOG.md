# Phase 7: Dance Engine + Protocol - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 07-dance-engine-protocol
**Areas discussed:** Calibration skip, Spectator snapshot API, TypeScript protocol sync, Dance message structs in Rust

---

## Calibration Skip

| Option | Description | Selected |
|--------|-------------|----------|
| New trait method `requires_calibration() -> bool` | Default true; DancePlugin overrides to false. Clean plugin boundary, no string comparison in engine core. | ✓ |
| Infer from `game_type() == "dance"` | Engine checks game_type string to skip calibration. Simpler but couples engine to dance specifics. | |

**User's choice:** "just use what u recommend" — Claude chose trait method approach.
**Notes:** User deferred all decisions to Claude's recommended options across all areas.

---

## Spectator Snapshot API

| Option | Description | Selected |
|--------|-------------|----------|
| New trait method `spectator_snapshot(&self, state) -> Option<Value>` | Engine calls on spectator join; plugin returns its own payload. Respects PLUG-04 (engine never inspects state). | ✓ |
| Engine reads game_type and downcasts DanceState directly | Breaks PLUG-04 abstraction. | |

**User's choice:** Claude recommended, user deferred.
**Notes:** Payload uses `type: "dance_snapshot"` to distinguish from live `dance_score` events. Only returns `Some` when a round is in progress.

---

## TypeScript Protocol Sync

| Option | Description | Selected |
|--------|-------------|----------|
| Add `#[derive(TS)]` Rust structs, run ts-rs export | Single source of truth in Rust. Consistent with existing `#[derive(TS)]` pattern in protocol.rs. | ✓ |
| Manually add types to shared/protocol.ts | Faster but diverges from established ts-rs pattern. | |

**User's choice:** Claude recommended, user deferred.
**Notes:** Python gen script comment in protocol.ts should be updated to reflect Rust source.

---

## Dance Message Structs in Rust

| Option | Description | Selected |
|--------|-------------|----------|
| Add typed MsgDanceBeat / MsgDanceScore structs in protocol.rs | Matches wire format DancePlugin already emits. Enables golden-file roundtrip tests. | ✓ |
| TypeScript-only interfaces | Faster but no compile-time shape guarantee on Rust side. | |

**User's choice:** Claude recommended, user deferred.
**Notes:** Struct shapes must exactly match existing `json!()` payloads in DancePlugin — no plugin code changes needed.

---

## Claude's Discretion

- Exact name/invocation of ts-rs export command
- Whether `MsgDanceBeat.target_pose` uses `Vec<[f64; 4]>` or a named wrapper struct
- Whether `spectator_snapshot` returns a plain `dance_score`-shaped payload with `type` field, or a dedicated `MsgDanceSnapshot` struct

## Deferred Ideas

- Mobile calibration skip UI — Phase 9 (DIMPL-05)
- Dance DESIGN.md / target pose visual spec — Phase 8 (DDES-01 through DDES-03)
- Dance overlay HUD, Pixi.js target skeleton, dance match end — Phase 9
