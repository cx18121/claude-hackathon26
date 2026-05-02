# Testing Patterns

**Analysis Date:** 2026-05-02

## Test Framework

### TypeScript (mobile/)

**Runner:**
- Vitest 4.x
- Config: `mobile/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`)

**Run Commands:**
```bash
npm run test              # Run all tests once (vitest run)
npm run test:watch        # Watch mode (vitest)
npm run test:coverage     # Coverage report (vitest run --coverage)
```

### Python (server/)

**Runner:**
- pytest 8.x
- Config: `server/pytest.ini`

**Assertion Library:**
- pytest built-in `assert`

**Async support:**
- pytest-asyncio 0.23+
- `asyncio_mode = auto` in `server/pytest.ini` — all async tests run automatically without needing `@pytest.mark.asyncio` being strictly required, though it is still applied explicitly on async tests for clarity

**Run Commands:**
```bash
cd server && pytest                     # Run all tests
cd server && pytest tests/test_rooms.py # Run single file
cd server && pytest -v                  # Verbose output
```

## Test File Organization

### TypeScript

**Location:** Co-located alongside source files
```
mobile/src/
  components/
    AvatarCanvas.tsx
    AvatarCanvas.test.tsx       # co-located
  hooks/
    useCalibration.ts
    useCalibration.test.ts      # co-located
    useGameSocket.ts
    useGameSocket.test.ts       # co-located
  lib/
    velocity.ts
    velocity.test.ts            # co-located
    skeleton.ts
    skeleton.test.ts            # co-located
  test/
    setup.ts                    # global setup only — no test cases here
```

**Naming:** `<ModuleName>.test.ts` or `<ComponentName>.test.tsx`

### Python

**Location:** Separate `server/tests/` directory
```
server/
  tests/
    __init__.py
    test_rooms.py
    test_damage.py
    test_hit_detection.py
    test_game_loop.py
    test_physics_polish.py
    test_sprint1.py
    test_sprint2.py
    test_sprint3.py
```

**Naming:** `test_<module_or_feature>.py`

## Test Structure

### TypeScript Suite Organization

```typescript
// Explicit imports — no globals (vitest.config.ts: globals: false)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ModuleName', () => {
  it('describes specific behavior', () => {
    // arrange
    // act
    // assert
    expect(result).toBe(expected);
  });
});

// Grouped by lifecycle stage or scenario:
describe('useCalibration -- lifecycle', () => { ... });
describe('useCalibration -- T-pose progression', () => { ... });
describe('useCalibration -- full happy path', () => { ... });
```

**Setup/Teardown:**
```typescript
beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
  // clear mock call counts
  mockCtx.clearRect.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

### Python Test Organization

**Function-per-test style (flat):**
```python
"""Module docstring describing test file scope."""
from __future__ import annotations
import os
os.environ.setdefault("TUNNEL", "false")   # must appear before app imports

from rooms import RoomManager

def test_create_room_returns_six_char_code():
    rm = RoomManager()
    code = rm.create_room()
    assert len(code) == 6
    assert code.isalnum()
```

**Class-based grouping (for related fix verification):**
```python
class TestTimestampVelocity:
    def test_nominal_30fps_when_timestamps_zero(self): ...
    def test_correct_speed_at_15fps(self): ...

class TestHitboxSweep:
    def test_wrist_inside_hitbox_on_middle_frame_is_caught(self): ...
```

**Async tests:**
```python
@pytest.mark.asyncio
async def test_hit_reduces_hp():
    room = make_room()
    gl = GameLoop(room)
    # ... arrange frames ...
    await gl._tick()
    assert gl.hp[1] < initial_hp
```

## Mocking

### TypeScript

**Framework:** `vi` from Vitest

**Canvas API mock (jsdom doesn't implement canvas 2D):**
```typescript
const mockCtx = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  fillStyle: '',
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockReturnValue(390)
  vi.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockReturnValue(844)
})
```

**Time mocking:**
```typescript
let mockNow = 0;
beforeEach(() => {
  mockNow = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
});
afterEach(() => {
  vi.restoreAllMocks();
});
```

**Callback spies:**
```typescript
const onComplete = vi.fn();
// ... trigger ...
expect(onComplete).toHaveBeenCalledTimes(1);
expect(onComplete).toHaveBeenCalledWith(result.current.referenceVelocity);
```

**What to Mock:**
- Browser APIs that jsdom does not implement (Canvas 2D context, layout dimensions)
- `performance.now()` when testing time-dependent logic
- Callback props passed to hooks (`vi.fn()`)

**What NOT to Mock:**
- Pure computation functions (`computeWristVelocity`, `smoothKeypoints`) — test directly with real data
- Pydantic models on the Python side — always instantiate real objects

### Python

**Fake WebSocket objects** used for spectator/broadcast tests:
```python
class FakeWS:
    async def send_text(self, text: str) -> None:
        received.append(text)

room.spectators.add(FakeWS())
await gl._tick()
assert len(received) == 1
```

**Environment variable stubbing:**
```python
# Top of every test file, before any app imports
os.environ.setdefault("TUNNEL", "false")
```

**No unittest.mock usage observed** — fake objects constructed inline instead.

## Fixtures and Factories

### TypeScript

**Keypoint factory pattern** — reused across all test files:
```typescript
function makeKeypoints(
  overrides: Partial<Record<number, Partial<PoseKeypoint>>> = {},
  defaultVis = 1.0,
): PoseKeypoint[] {
  const out: PoseKeypoint[] = [];
  for (let i = 0; i < 33; i++) {
    out.push({ x: 0, y: 0, z: 0, visibility: defaultVis, ...overrides[i] });
  }
  return out;
}

function makeFrame(t: number, kp: PoseKeypoint[]): TimedFrame {
  return { t, keypoints: kp };
}
```

**Important rule — each `feed()` call must produce a NEW array reference:**
```typescript
// Reusing a single array across rerenders short-circuits the useEffect
// via Object.is. Must spread on each feed:
rerender({ keypoints: kp.map((p) => ({ ...p })), active, onComplete });
```

**Location:** Defined inline within test files — no shared fixtures directory.

### Python

**Frame factory:**
```python
def kp(x=0.0, y=0.0, z=0.0) -> PoseKeypoint:
    return PoseKeypoint(x=x, y=y, z=z, visibility=1.0)

def make_frame(overrides: dict | None = None) -> MsgPoseFrame:
    pts = [kp()] * 33
    pts = list(pts)
    pts[LEFT_HIP]      = kp(x=-0.1)
    pts[RIGHT_HIP]     = kp(x= 0.1)
    pts[LEFT_SHOULDER] = kp(x=-0.2, y=-0.25)
    pts[RIGHT_SHOULDER] = kp(x= 0.2, y=-0.25)
    if overrides:
        for idx, point in overrides.items():
            pts[idx] = point
    return MsgPoseFrame(type="pose_frame", timestamp=0.0, keypoints=pts)
```

**Room factory:**
```python
def make_room() -> RoomState:
    room = RoomState(code="TEST01")
    room.players[1].connected = True
    room.players[1].reference_velocity = 3.0
    room.players[2].connected = True
    room.players[2].reference_velocity = 3.0
    return room
```

**Note:** `kp()` and `make_frame()` helper functions are redefined in each test file rather than shared. `server/tests/__init__.py` is present but empty.

## Coverage

**Requirements:** None enforced (no coverage threshold in `vitest.config.ts`)

**View Coverage (TypeScript):**
```bash
cd mobile && npm run test:coverage
```
Coverage powered by `@vitest/coverage-v8`.

**View Coverage (Python):**
```bash
cd server && pytest --cov
```
`pytest-cov` is not listed in `requirements.txt` — coverage collection not currently wired for Python.

## Test Types

**Unit Tests:**
- Pure computation functions tested directly: `computeWristVelocity`, `smoothKeypoints`, `compute_damage`, `detect_punch`, `detect_kick`, `_velocity`
- Data structures tested in isolation: `RoomManager`, `PlayerSlot`, `RoomState`
- No external dependencies, no mocking needed

**Integration Tests:**
- `GameLoop` tick tested with fake room state and `FakeWS` spectators — `test_game_loop.py`
- FastAPI HTTP and WebSocket endpoints tested via `fastapi.testclient.TestClient` — `test_sprint1.py`, `test_sprint2.py`
- React hooks tested with `@testing-library/react` `renderHook` + `act` — `useCalibration.test.ts`

**E2E Tests:**
- Not present

## Common Patterns

**Async Testing (Python):**
```python
@pytest.mark.asyncio
async def test_frames_released_after_delay():
    room = make_room()
    gl = GameLoop(room)
    frame = make_frame()
    gl.add_pose_frame(1, frame)
    await gl._tick()
    assert len(gl._processed[1]) == 1
```

**Async Testing (TypeScript — hooks):**
```typescript
import { renderHook, act } from '@testing-library/react';

const { result, rerender } = renderHook((props) => useCalibration(props), {
  initialProps: initial,
});

act(() => {
  rerender({ keypoints: null, active: true, onComplete });
});

expect(result.current.stage).toBe('tpose');
```

**Floating Point Assertions:**
```typescript
expect(v).toBeCloseTo(3.0, 5);   // 5 decimal places
expect(v).toBeLessThan(2.0);
```

**Parametrize (Python):**
```python
@pytest.mark.parametrize("region", list(BASE_DAMAGE))
def test_zero_velocity_gives_minimum(self, region: str):
    lo, _ = BASE_DAMAGE[region]
    assert compute_damage(region, 0.0, 3.0) == lo
```

**Error / None path testing:**
```python
assert detect_punch(deque(), deque()) is None
assert detect_kick(slow, static_deque()) is None
```

```typescript
it('returns 0 when fewer than 3 frames are available', () => {
  expect(computeWristVelocity([], 'left')).toBe(0);
});
```

**Inline assertion messages (Python):**
```python
assert d == lo, f"{region}: expected floor {lo}, got {d}"
```

## Global Test Setup

**TypeScript — `mobile/src/test/setup.ts`:**
- Polyfills `performance.now` for jsdom
- `afterEach` hook present as placeholder for future cleanup
- Loaded via `setupFiles: ['./src/test/setup.ts']` in `vitest.config.ts`

**Python — no conftest.py** — each test file sets `os.environ.setdefault("TUNNEL", "false")` independently at the top before any app imports.

---

*Testing analysis: 2026-05-02*
