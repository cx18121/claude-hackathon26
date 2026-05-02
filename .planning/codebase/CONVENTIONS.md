# Coding Conventions

**Analysis Date:** 2026-05-02

## Naming Patterns

**Files (TypeScript):**
- Components: PascalCase matching the exported component — `AvatarCanvas.tsx`, `CameraView.tsx`, `HitFlash.tsx`
- Hooks: camelCase with `use` prefix — `useGameSocket.ts`, `useCalibration.ts`, `usePose.ts`
- Libraries/utilities: camelCase — `velocity.ts`, `skeleton.ts`, `interpolate.ts`
- Test files: co-located alongside source, same name + `.test.ts` / `.test.tsx` suffix — `velocity.test.ts`, `AvatarCanvas.test.tsx`

**Files (Python):**
- All lowercase snake_case — `hit_detection.py`, `game_loop.py`, `input_delay.py`
- Test files: `test_<module>.py` naming under `server/tests/` — `test_rooms.py`, `test_damage.py`

**Functions and Variables (TypeScript):**
- Functions: camelCase — `computeWristVelocity`, `normalizeWsUrl`, `smoothKeypoints`
- Variables: camelCase — `mockNow`, `hitRegion`, `poseStreamRef`
- Constants: UPPER_SNAKE_CASE for module-level primitives — `RECONNECT_DELAY_MS`, `PUNCH_PEAK_THRESHOLD`, `HIT_DURATION_MS`
- Object constant maps use UPPER_SNAKE_CASE — `LANDMARK`, `REGION_KEYPOINTS`, `CONNECTIONS`

**Functions and Variables (Python):**
- Public functions: snake_case — `detect_punch`, `compute_damage`, `broadcast_to_spectators`
- Private/internal functions: leading underscore + snake_case — `_velocity`, `_body_scale`, `_attack_region`, `_apply_guard`
- Constants: UPPER_SNAKE_CASE — `PUNCH_THRESHOLD`, `KICK_THRESHOLD`, `BASE_DAMAGE`, `_FRAME_DT`
- Private module-level constants: leading underscore + UPPER_SNAKE_CASE — `_REL_HEAD_Y`, `_HIT_COOLDOWN_TICKS`

**Types and Interfaces (TypeScript):**
- Interfaces: PascalCase — `UseGameSocketResult`, `TimedFrame`, `PlayerPoseState`
- Type aliases: PascalCase — `SocketStatus`, `GamePhase`, `CalibrationStage`
- Props interfaces: named `Props` (local to the component file) — `interface Props { keypoints: PoseKeypoint[] | null; hitRegion: string | null }`

**Classes (Python):**
- PascalCase — `RoomManager`, `RoomState`, `PlayerSlot`, `HitResult`, `Region`
- Dataclasses used for data carriers (`PlayerSlot`, `RoomState`, `HitResult`)
- Plain classes with string constants used as enums (`Region`)

**Message Types (cross-language):**
- Always prefixed `Msg` — `MsgJoin`, `MsgPoseFrame`, `MsgGameState`, `MsgYouWereHit`
- Discriminated union with `type` literal field — `{ type: "pose_frame", ... }`
- Python and TypeScript types are kept in sync: `server/protocol.py` and `shared/protocol.ts` (generated via `scripts/gen_protocol.py`)

## Code Style

**Formatting (TypeScript):**
- No Prettier config detected — formatting enforced via ESLint + TypeScript ESLint
- Both `mobile/` and `overlay/` use the same `eslint.config.js` shape: `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- Quote style varies between double-quotes (mobile) and single-quotes (overlay) within files; no enforced rule observed

**Linting:**
- `eslint .` via `npm run lint` in each app package
- Rules: `tseslint.configs.recommended`, `reactHooks.configs.flat.recommended`, `reactRefresh.configs.vite`
- Deliberate suppressions use inline `/* eslint-disable ... */` with a block comment explaining the reason (see `useCalibration.ts` — `react-hooks/set-state-in-effect` suppression with 5-line justification)

**Formatting (Python):**
- No Black/Ruff/isort config detected
- Vertical alignment of assignment lists used for readability in constant blocks — landmark index assignments in `hit_detection.py` and `rooms.py` align the `=` sign across multiple lines

## Import Organization

**TypeScript order (observed):**
1. React/framework imports — `import { useEffect, useRef, useState } from 'react'`
2. `@shared/protocol` type imports — `import type { PoseKeypoint } from '@shared/protocol'`
3. Local relative imports — `import { CONNECTIONS, REGION_KEYPOINTS } from '../lib/skeleton'`

**Type-only imports:**
- Always use `import type { ... }` for types that are not used as values — `import type { PoseKeypoint }`, `import type { TimedFrame }`

**Path Aliases:**
- `@shared` resolves to `../shared` (configured in `mobile/vite.config.ts` and `overlay/vite.config.ts`)
- Used universally for cross-package protocol types

**Python import order (observed):**
1. `from __future__ import annotations` — every source file uses this unconditionally
2. Standard library
3. Third-party (`fastapi`, `pydantic`, `numpy`)
4. Local app modules
- `TYPE_CHECKING` guard used to avoid circular imports: `if TYPE_CHECKING: from fastapi import WebSocket`

## Error Handling

**Python:**
- WebSocket errors caught silently with bare `except Exception` in broadcast helpers (`broadcast.py`) — dead connections are pruned but no error is logged
- FastAPI WebSocketDisconnect raised and caught at the handler level in `main.py`
- Protocol parsing via Pydantic `TypeAdapter.validate_python` — validation errors propagate as exceptions to the WebSocket handler

**TypeScript:**
- WebSocket `onerror` / `onclose` events update status state to `'error'` or `'disconnected'`
- No `try/catch` around WebSocket send — caller is responsible for checking status before calling `send()`
- Nullish coalescing (`??`) and optional chaining (`?.`) used throughout for defensive access

## Logging

**Python:**
- `logging.basicConfig(level=logging.INFO)` set in `main.py`
- Module-level logger: `log = logging.getLogger(__name__)` in `main.py` and `game_loop.py`
- Use `log.info(...)` / `log.warning(...)` — not `print()`

**TypeScript:**
- No structured logger — `console.log` / `console.warn` used sparingly; no logging in lib utilities

## Comments

**When to Comment:**
- Explain non-obvious physics or coordinate system choices inline — `# Y axis is positive DOWNWARD` docstring in test files, inline coordinate comments throughout `hit_detection.py`
- Document the _why_ of lint suppressions: never suppress without a multi-line justification
- Generated files annotated at top: `// Generated from server/protocol.py — do not edit by hand.`

**Docstrings (Python):**
- Module-level docstrings on all test files — `"""Room creation, slot filling, and disconnect handling."""`
- Function docstrings on non-trivial helpers — `"""Central-difference velocity over the last 3 frames using actual timestamps."""`
- Trivial dataclasses and model classes do not require docstrings

**JSDoc/TSDoc:**
- Not used; inline comments preferred for non-obvious logic

## Function Design

**Size:** Functions stay small and single-purpose. Private helpers (prefixed `_`) isolate sub-computations (`_hip_mid_y`, `_y_up`, `_body_scale`, `_guarded_zones`).

**Parameters:** Keyword-argument-style via dataclasses / Pydantic models on the Python side. TypeScript functions take positional parameters; complex arg groups use interfaces.

**Return Values:**
- Python: `None` returned explicitly for "no result" paths — `detect_punch` and `detect_kick` always return `HitResult | None`
- TypeScript: union types with `null` for absent values — `referenceVelocity: number | null`

## Module Design

**Python exports:** No `__all__` used. Internal names prefixed `_` signal private API. Public surface is flat — callers import directly: `from hit_detection import detect_punch, PUNCH_THRESHOLD`.

**TypeScript exports:** Named exports only — no default exports observed across hooks, libs, or components. Each module exports exactly what it implements.

**Barrel files:** Not used. Consumers import directly from the source module path.

## Protocol / Cross-Language Parity

- `server/protocol.py` is the source of truth; `shared/protocol.ts` is generated from it
- Do not manually edit `shared/protocol.ts` — run `python scripts/gen_protocol.py`
- Wire format uses `snake_case` field names matching Pydantic models (e.g., `room_code`, `reference_velocity`)
- Discriminated by `type` field as a string literal; both sides use discriminated unions for parsing

---

*Convention analysis: 2026-05-02*
