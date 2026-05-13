# Phase 13: MediaPipe + Calibration — Research

**Researched:** 2026-05-13
**Domain:** MediaPipe PoseLandmarker (Web Worker), OneEuroFilter jitter smoothing, arm-length calibration, React hooks
**Confidence:** HIGH

---

## Summary

Phase 13 extends the fps/ scaffold built in Phase 12 with three capabilities: (1) a continuous pose-detection loop that drives landmarks from the already-warmed worker into React state without blocking the main thread, (2) OneEuroFilter smoothing applied to every landmark coordinate before downstream consumers read it, and (3) an arm-length calibration screen that collects a `reference_velocity` value and sends `MsgCalibrationDone` to the server, which then emits `MsgMatchStart`.

**Critical protocol finding:** The phase description mentions `arm_reach` as the `MsgCalibrationDone` payload. This is incorrect. The actual wire protocol — both `shared/protocol.ts` and the Rust `protocol.rs` — uses `reference_velocity: number`. The fps/ calibration must reuse the identical `MsgCalibrationDone { type: "calibration_done", reference_velocity }` message that the mobile client already sends. The server's `FPSBoxingPlugin.on_calibration_complete` stores this value as `ref_vel` and uses it for hit-damage scaling. No server-side changes are needed. [VERIFIED: shared/protocol.ts line 37-39, engine/fps-boxing-plugin/src/lib.rs lines 140-144]

The good news is that all major pieces already exist: `fps/src/workers/pose.worker.ts` is a complete, production-ready detection worker (identical to mobile/), `fps/src/hooks/useWarmup.ts` keeps the worker alive and exposes a `workerRef`, and `mobile/src/hooks/useCalibration.ts` is a fully functional calibration hook that can be adapted for fps/. The OneEuroFilter is the only new external dependency — the `1eurofilter` npm package (v1.3.0) provides a TypeScript-native implementation. [VERIFIED: fps/src/workers/pose.worker.ts, fps/src/hooks/useWarmup.ts, mobile/src/hooks/useCalibration.ts, npm view 1eurofilter]

**Primary recommendation:** Build three new fps/ modules — `usePose` (detection loop consuming the pre-warmed worker), `useOneEuroFilter` (per-landmark smoothing), `useCalibration` (adapted from mobile/) — and a `CalibrationScreen` component. Wire them into `App.tsx` by responding to `socket.phase === 'calibration'`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pose detection (WASM inference) | Web Worker (off-thread) | — | MediaPipe WASM must not block the main JS thread; worker is already warmed from Phase 12 |
| Landmark delivery to React state | Frontend React (main thread) | Web Worker posts results | Worker posts `{ type: 'result', worldLandmarks, landmarks }`; hook reads onmessage |
| Jitter smoothing (OneEuroFilter) | Frontend React (main thread) | — | Filter runs on received landmarks before state is set; pure JS, negligible cost |
| Calibration logic (punch detection) | Frontend React (main thread) | — | Stateful hook consuming smoothed keypoints; mirrors mobile/src/hooks/useCalibration.ts |
| Calibration result delivery | Frontend WebSocket client | Server stores ref_vel | Client sends MsgCalibrationDone; server emits MsgMatchStart when both players done |
| Match start gate | Server (FPSBoxingPlugin) | Frontend reads MsgMatchStart | Engine emits match_start only after both players submit calibration_done |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WCI-01 | Player's pose is tracked from laptop webcam via MediaPipe PoseLandmarker running in a Web Worker (off main thread) | Worker already complete in fps/src/workers/pose.worker.ts; usePose hook pattern verified in mobile/src/hooks/usePose.ts; rAF + OffscreenCanvas capture pattern confirmed |
| WCI-02 | Raw landmark stream is smoothed with OneEuroFilter before punch detection to eliminate jitter false-positives | `1eurofilter` npm package v1.3.0 provides TypeScript-native API; starting params `freq=60, mincutoff=1.0, beta=0.007, dcutoff=1.0` confirmed in STATE.md and Context7 docs |
| WCI-04 | Player completes a brief arm-length calibration step before entering a match (normalizes reach to player's real dimensions) | Protocol confirmed: MsgCalibrationDone carries `reference_velocity` (NOT arm_reach); server FPSBoxingPlugin.on_calibration_complete stores ref_vel; mobile/useCalibration.ts is the reference UI/logic pattern |
</phase_requirements>

---

## P1: Critical Findings (Blockers and Protocol Facts)

### P1-A: `arm_reach` does not exist — wire protocol uses `reference_velocity`

**Finding:** The phase description and success criterion mention `MsgCalibrationDone` carrying `arm_reach`. This field does not exist anywhere in the codebase. The actual wire protocol is:

```typescript
// shared/protocol.ts (line 37-39) — VERIFIED
export interface MsgCalibrationDone {
  type: "calibration_done";
  reference_velocity: number;
}
```

The Rust server reads `MsgCalibrationDone.reference_velocity` and stores it as `FPSBoxingState.ref_vel` (clamped to [0.5, 15.0]). [VERIFIED: engine/fps-boxing-plugin/src/lib.rs lines 140-144, engine/engine-core/src/protocol.rs lines 70-73]

**Consequence:** The fps/ calibration hook must output a velocity measurement — the same `reference_velocity` concept the mobile client uses (average peak wrist velocity across 3 punches, in m/s). The calibration UI goal of "normalizes reach to player's real dimensions" is achieved through this velocity baseline, not a separate arm_reach measurement.

**Action:** fps/ sends `{ type: 'calibration_done', reference_velocity: <measured_value> }`. No protocol changes needed.

### P1-B: fps/ pose worker is already complete — no extension needed

**Finding:** `fps/src/workers/pose.worker.ts` is byte-for-byte identical to `mobile/src/workers/pose.worker.ts`. Both already handle:
- `{ type: 'init', wasmUrl, modelUrl }` — GPU→CPU fallback initialization
- `{ type: 'detect', bitmap: ImageBitmap, timestampMs: number }` — detectForVideo call
- Posts `{ type: 'ready' }`, `{ type: 'result', worldLandmarks, landmarks }`, `{ type: 'error', message }`
- Monotonic timestamp guard (`lastTimestampMs`)
- `bitmap.close()` in `finally` block to prevent memory leaks

[VERIFIED: fps/src/workers/pose.worker.ts and mobile/src/workers/pose.worker.ts — files are identical]

**Consequence:** Phase 13 does NOT extend the worker file. All Phase 13 work is in new hook files and a new component.

### P1-C: `useWarmup` already keeps the worker alive and exposes `workerRef`

**Finding:** `fps/src/hooks/useWarmup.ts` was built in Phase 12 with this specific concern in mind. It:
- Stores the Worker in `workerRef: React.MutableRefObject<Worker | null>`
- Returns `workerRef` in its result object
- Has a comment explicitly stating the worker must NOT be terminated so Phase 13 can reuse it
- Phase 13 must receive this `workerRef` from App state (or via props/context) rather than spawning a new worker

[VERIFIED: fps/src/hooks/useWarmup.ts lines 17-56]

**Consequence:** `usePose` in fps/ must accept a `workerRef` parameter (or the already-initialized worker) rather than spawning its own. This is different from mobile/'s `usePose` which spawns the worker internally. The App.tsx already stores `workerRef` via `useWarmup()`.

### P1-D: `socket.phase === 'calibration'` is the trigger for CalibrationScreen

**Finding:** `fps/src/hooks/useGameSocket.ts` already handles `calibration_start` by setting `phase = 'calibration'`. `App.tsx` has `showWaiting = screen === 'waiting' && socket.phase === 'lobby'` — when both players join, `socket.phase` changes to `'calibration'`, and the `showWaiting` flag becomes false. Phase 13 must render `CalibrationScreen` when `socket.phase === 'calibration'`.

[VERIFIED: fps/src/hooks/useGameSocket.ts lines 176-179, fps/src/App.tsx lines 36-37]

---

## P2: Important — Implementation Details

### P2-A: Detection loop pattern (WCI-01)

The fps/ `usePose` hook follows the mobile pattern exactly but takes the pre-warmed `workerRef` instead of spawning a new worker. Key properties of the detection loop:

1. **Frame capture:** Use `OffscreenCanvas.transferToImageBitmap()` for zero-copy transfer. Fall back to `createImageBitmap(video)` if OffscreenCanvas is unavailable.
2. **Frame scheduling:** Use `requestVideoFrameCallback` when available (reduces latency); fall back to `requestAnimationFrame`.
3. **Backpressure:** Skip frame if `workerBusyRef.current === true`. This prevents queue buildup during fast punches.
4. **Main thread cost:** Only `postMessage` + `onmessage` handler. The WASM inference runs in the worker. Main thread cost per frame is O(1) — setting React state with 33 keypoints.

The detection loop signature for fps/:

```typescript
// Source: adapted from mobile/src/hooks/usePose.ts
export function usePose(
  videoRef: RefObject<HTMLVideoElement | null>,
  cameraReady: boolean,
  workerRef: React.MutableRefObject<Worker | null>,  // fps/ only — pre-warmed from useWarmup
): UsePoseResult
```

[VERIFIED: mobile/src/hooks/usePose.ts — full detection loop pattern]

### P2-B: OneEuroFilter usage (WCI-02)

The `1eurofilter` package (v1.3.0, BSD-3-Clause, 0 dependencies) provides a TypeScript-native `OneEuroFilter` class. [VERIFIED: npm view 1eurofilter, Context7 docs /casiez/oneeurofilter]

**API:**
```typescript
import { OneEuroFilter } from '1eurofilter';

// One filter instance per scalar channel (x, y, z per landmark = 33 * 3 = 99 instances)
const filter = new OneEuroFilter(
  60,    // freq — nominal capture rate (matches MediaPipe VIDEO mode)
  1.0,   // mincutoff — reduces jitter at rest; higher = more smoothing, more lag
  0.007, // beta — speed-adaptive responsiveness; higher = less lag during fast motion
  1.0,   // dcutoff — derivative cutoff (leave at 1.0)
);

const smoothedX = filter.filter(rawX, timestampSeconds);
```

**Parameter choice rationale (from STATE.md):** Starting values `mincutoff=1.0, beta=0.007` are the documented defaults and match what STATE.md flags as needing tuning. These values work well for 60fps cursor tracking; for pose landmarks they may need mincutoff lowered (less aggressive smoothing) at cost of more jitter at rest. [CITED: STATE.md "Phase 13 — OneEuroFilter tuning" note]

**Implementation approach:** A `useOneEuroFilter` hook that maintains a `Map<string, OneEuroFilter>` (keyed as `"${landmarkIndex}_x"` etc.) and processes a `PoseKeypoint[]` array into a smoothed `PoseKeypoint[]`. The hook re-uses the same filter instances across frames (required — filters are stateful).

**Alternative:** Inline the filter in `usePose` rather than a separate hook. Either works. A separate hook is testable in isolation.

### P2-C: CalibrationScreen UI and flow (WCI-04)

The roadmap specifies: "video preview + 3-punch prompt". The mobile/ calibration stage machine is:

1. `tpose` — hold T-pose (arms out wide) for 30 stable frames (~0.5s at 60fps)
2. `punches` — throw 3 punches at full speed; each peak velocity is recorded
3. `neutral` — return to neutral stance for 60 still frames (~1s)
4. `done` — `onComplete(referenceVelocity)` is called

For fps/, the same stage machine applies. The calibration screen must show:
- A live video preview (the camera feed) — so the player can see their pose
- Stage-appropriate instruction text from `useCalibration.instruction`
- A progress indicator (tpose progress bar, punch counter "1/3 2/3 3/3")

The `useCalibration` hook from mobile/ is directly reusable with one adaptation: it calls `onComplete(referenceVelocity)` with a number, and fps/ sends `MsgCalibrationDone { type: 'calibration_done', reference_velocity: value }` at that point.

After `MsgCalibrationDone` is sent, fps/ waits for `MsgMatchStart` from the server. `useGameSocket` already handles this: `match_start` sets `phase = 'match'`. App.tsx advances to the game screen when `socket.phase === 'match'`.

[VERIFIED: mobile/src/hooks/useCalibration.ts full source, fps/src/hooks/useGameSocket.ts lines 183-185]

### P2-D: Landmark indices for arm-reach computation

MediaPipe PoseLandmarker world landmarks use metric coordinates (meters, origin at hip center). The arm landmarks used in both `useCalibration` and `fps-boxing-plugin` are:

| Index | Name | Constant |
|-------|------|----------|
| 11 | LEFT_SHOULDER | `LANDMARK.LEFT_SHOULDER` |
| 12 | RIGHT_SHOULDER | `LANDMARK.RIGHT_SHOULDER` |
| 13 | LEFT_ELBOW | `LANDMARK.LEFT_ELBOW` |
| 14 | RIGHT_ELBOW | `LANDMARK.RIGHT_ELBOW` |
| 15 | LEFT_WRIST | `LANDMARK.LEFT_WRIST` |
| 16 | RIGHT_WRIST | `LANDMARK.RIGHT_WRIST` |
| 23 | LEFT_HIP | `LANDMARK.LEFT_HIP` |
| 24 | RIGHT_HIP | `LANDMARK.RIGHT_HIP` |

These are the same 8 landmarks checked in `useCalibration.TPOSE_VISIBILITY_LANDMARKS`. [VERIFIED: mobile/src/lib/velocity.ts LANDMARK constants, mobile/src/hooks/useCalibration.ts lines 45-53]

The `reference_velocity` is computed as the average peak wrist speed (m/s) across 3 punches — not a geometric arm-length measurement. The "arm length calibration" language in the requirements refers to the velocity baseline approach normalizing per player, not a literal wrist-to-shoulder distance calculation.

### P2-E: `useCalibration` adaptation from mobile/ to fps/

`mobile/src/hooks/useCalibration.ts` imports from `../lib/velocity` (for `computeWristVelocity`, `computeWristPeakSpeed`, `LANDMARK`, `TimedFrame`). fps/ does not yet have a `src/lib/velocity.ts` module — this must be added.

The mobile calibration hook is stable and well-tested (has `useCalibration.test.ts`). The fps/ adaptation:
1. Copy `mobile/src/lib/velocity.ts` to `fps/src/lib/velocity.ts`
2. Adapt `mobile/src/hooks/useCalibration.ts` to `fps/src/hooks/useCalibration.ts` — the logic is identical; only the import path changes (`../lib/velocity`).
3. The `onComplete(referenceVelocity)` callback triggers `socket.send({ type: 'calibration_done', reference_velocity: referenceVelocity })`.

[VERIFIED: mobile/src/hooks/useCalibration.ts — no fps/-specific dependencies; pure landmark math]

### P2-F: GPU timing assertion for Phase 13 (from STATE.md blocker)

STATE.md flags: "GPU delegation improves inference from 40-80ms to 8-15ms, but silent CPU fallback with no error. Add per-frame timing assertions in Phase 13 to detect fallback."

The worker already falls back silently. A timing check in `usePose` (logging a warning if frame processing exceeds 25ms over a rolling window) would surface this. This is diagnostic, not a correctness requirement — but STATE.md explicitly requests it.

[CITED: .planning/STATE.md blockers section]

### P2-G: `worldLandmarks` vs `landmarks` — which to use

The worker posts both:
- `worldLandmarks` — 3D metric coordinates (meters, origin at hip center). Used by `useCalibration` for velocity computation (real-world distances).
- `landmarks` — normalized 2D image coordinates [0..1]. Used for rendering overlays on the video frame.

For calibration and punch detection: use `worldLandmarks`. For CalibrationScreen video overlay (if implemented): use `landmarks`. [VERIFIED: fps/src/workers/pose.worker.ts lines 68-78]

---

## P3: Nice-to-Know / Deferred

### P3-A: Smoothing placement — before or after calibration

OneEuroFilter smoothing eliminates jitter false-positives (WCI-02). For calibration punch detection, the velocity peak must NOT be over-smoothed — high beta reduces lag on fast motion, so the filter passes punch peaks through. At rest (between punches), low mincutoff smooths away micro-jitter. The filter parameters in STATE.md are calibrated for this scenario.

### P3-B: Per-landmark filter instance count

99 OneEuroFilter instances (33 landmarks × 3 axes) is not a performance concern — each instance is a few floats and one multiply per frame. Total per-frame cost is ~99 multiply-add operations.

### P3-C: CalibrationScreen video preview

The `videoRef` (HTMLVideoElement) showing the camera feed is already available from Phase 12's `useCamera` hook (stored in `cameraStreamRef`). The CalibrationScreen receives it as a prop and sets `videoElement.srcObject = stream` (or the parent sets it). This is the same pattern mobile/ uses in its calibration UI.

### P3-D: MsgMatchStart → game screen transition

`useGameSocket` already sets `phase = 'match'` on `match_start`. App.tsx Phase 13 must add: when `socket.phase === 'match'`, advance `screen` to `'game'` (or render the game placeholder). This is a one-liner addition to App.tsx.

---

## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | fps/ sends `MsgCalibrationDone { reference_velocity }` — NOT `arm_reach` | Wire protocol is fixed; no server change needed; mobile/ already uses this exact shape |
| D2 | `usePose` in fps/ accepts pre-warmed `workerRef` from `useWarmup`, does not spawn a new worker | Prevents double WASM load; workerRef pattern already established in fps/hooks/useWarmup.ts |
| D3 | `useCalibration` is adapted from mobile/ verbatim (with adjusted import path) | Logic is correct and tested; zero reason to reinvent it |
| D4 | `useOneEuroFilter` is a new hook wrapping `1eurofilter` npm package | No hand-rolling; package has 0 dependencies, TypeScript-native, last published 2 months ago |
| D5 | Smoothing applied to `worldLandmarks` in the main thread after worker posts results | Pure JS, negligible cost; keeps worker protocol clean (worker always posts raw landmarks) |
| D6 | `fps/src/lib/velocity.ts` is copied from `mobile/src/lib/velocity.ts` | Required by useCalibration; no shared library path that both apps can import |

---

## Standard Stack

### Core (Phase 13 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| 1eurofilter | 1.3.0 | OneEuroFilter jitter smoothing | Official reference implementation from the algorithm authors; 0 deps; TypeScript-native |

[VERIFIED: npm view 1eurofilter — version 1.3.0, published 2026-03]

**Installation:**
```bash
cd fps && npm install 1eurofilter@1.3.0
```

### Existing (carried from Phase 12)

| Library | Version | Purpose |
|---------|---------|---------|
| @mediapipe/tasks-vision | 0.10.34 | PoseLandmarker inference (in worker) |
| react / react-dom | 19.2.5 | UI |
| vitest | 4.1.5 | Unit tests |
| @testing-library/react | 16.3.2 | Hook + component tests |

---

## Architecture Patterns

### System Architecture Diagram

```
fps/ Browser
  │
  ├── [App.tsx — screen router]
  │    phase: 'lobby'          → WaitingScreen
  │    phase: 'calibration'    → CalibrationScreen  ← NEW (Phase 13)
  │    phase: 'match'          → game (Phase 14)
  │
  ├── [useWarmup hook — Phase 12]
  │    └── workerRef: Worker (init + ready, KEPT ALIVE)
  │
  ├── [usePose hook — NEW]         WCI-01
  │    ├── receives workerRef from App state
  │    ├── rAF/rVFC loop → captures video frame → OffscreenCanvas.transferToImageBitmap()
  │    ├── postMessage({ type:'detect', bitmap, timestampMs })  → Worker
  │    ├── Worker processes detectForVideo off main thread
  │    └── onmessage { type:'result' } → setRawKeypoints(worldLandmarks)
  │
  ├── [useOneEuroFilter hook — NEW]  WCI-02
  │    ├── receives rawKeypoints[]
  │    ├── 99 OneEuroFilter instances (33 landmarks × x/y/z)
  │    └── returns smoothedKeypoints[]
  │
  ├── [useCalibration hook — NEW]    WCI-04
  │    ├── receives smoothedKeypoints[]
  │    ├── stage machine: idle → tpose → punches → neutral → done
  │    ├── on done: onComplete(referenceVelocity)
  │    └── CalibrationScreen renders stage/progress/instruction
  │
  └── [useGameSocket hook — Phase 12]
       ├── sends MsgCalibrationDone { reference_velocity }  ← WCI-04
       ├── receives MsgMatchStart → phase = 'match'
       └── receives calibration_start → phase = 'calibration'

Web Worker (fps/src/workers/pose.worker.ts) — ALREADY COMPLETE
  ├── handles { type:'init' }   → ready
  └── handles { type:'detect' } → { type:'result', worldLandmarks, landmarks }

Axum Server (FPSBoxingPlugin)
  ├── receives MsgCalibrationDone → stores ref_vel[slot] clamped to [0.5, 15.0]
  └── when both players calibrated → emits MsgMatchStart to both
```

### Recommended File Structure (Phase 13 additions)

```
fps/src/
├── lib/
│   └── velocity.ts            # COPY from mobile/src/lib/velocity.ts (computeWristVelocity etc.)
├── hooks/
│   ├── useWarmup.ts            # Phase 12 — no changes
│   ├── useGameSocket.ts        # Phase 12 — no changes
│   ├── usePose.ts              # NEW — detection loop, accepts workerRef
│   ├── useOneEuroFilter.ts     # NEW — wraps 1eurofilter for PoseKeypoint[]
│   └── useCalibration.ts       # NEW — adapted from mobile/src/hooks/useCalibration.ts
├── components/
│   ├── CalibrationScreen.tsx   # NEW — video preview + stage instructions + progress
│   ├── PermissionScreen.tsx    # Phase 12 — no changes
│   ├── WarmupScreen.tsx        # Phase 12 — no changes
│   └── WaitingScreen.tsx       # Phase 12 — no changes
└── App.tsx                     # EXTEND — wire socket.phase → CalibrationScreen
```

### Pattern 1: usePose (detection loop with pre-warmed worker)

```typescript
// Source: adapted from mobile/src/hooks/usePose.ts
// Key difference: accepts workerRef instead of spawning
export function usePose(
  videoRef: RefObject<HTMLVideoElement | null>,
  cameraReady: boolean,
  workerRef: React.MutableRefObject<Worker | null>,
): { keypoints: PoseKeypoint[] | null; imageKeypoints: PoseKeypoint[] | null; fps: number } {
  // rAF/rVFC loop:
  //   1. Skip if workerBusyRef.current (backpressure)
  //   2. captureCanvas.drawImage(video, ...) → transferToImageBitmap()
  //   3. worker.postMessage({ type:'detect', bitmap, timestampMs }, [bitmap])
  //   4. onmessage { type:'result' } → setKeypoints(worldLandmarks)
  //   5. bitmap.close() handled in worker's finally block
}
```

### Pattern 2: useOneEuroFilter (per-landmark smoothing)

```typescript
// Source: Context7 /casiez/oneeurofilter + adaptation for PoseKeypoint[]
import { OneEuroFilter } from '1eurofilter';

export function useOneEuroFilter(
  keypoints: PoseKeypoint[] | null,
  freq = 60,
  mincutoff = 1.0,
  beta = 0.007,
): PoseKeypoint[] | null {
  // filtersRef: Map<string, OneEuroFilter>  — "11_x", "11_y", "11_z", ...
  // For each landmark: filter x, y, z independently
  // Pass timestampMs/1000 (seconds) to filter.filter(value, timestamp)
  // Keep filter instances alive across frames (stateful)
}
```

### Pattern 3: App.tsx extension for CalibrationScreen

```typescript
// Source: fps/src/App.tsx (existing) + Phase 13 extension
// Add to screen type and rendering:

const showCalibration = socket.phase === 'calibration';

// In render:
{showCalibration && (
  <CalibrationScreen
    videoRef={videoRef}
    keypoints={smoothedKeypoints}
    onCalibrationDone={(referenceVelocity) => {
      socket.send({ type: 'calibration_done', reference_velocity: referenceVelocity });
    }}
  />
)}
{socket.phase === 'match' && (
  <div id="game-canvas-root" />
)}
```

### Anti-Patterns to Avoid

- **Sending `arm_reach` in MsgCalibrationDone:** The field is `reference_velocity`. The server will reject or ignore any unknown field — the calibration handshake will never complete.
- **Spawning a new Worker in usePose:** The warmup cost is 1-2s. The worker from useWarmup must be reused. Spawning a second worker doubles WASM load and silently creates two competing landmarkers.
- **Creating new OneEuroFilter instances each render:** Filters are stateful (they hold the previous sample). The filter map must live in a `useRef`, not recreated each call.
- **Using `landmarks` (image-space) for velocity computation:** Use `worldLandmarks` (metric). Image-space coordinates change with camera zoom/position and produce velocity values that don't map to m/s.
- **Applying OneEuroFilter inside the Web Worker:** The filter state must persist between calls on the main thread. Worker message passing is asynchronous and stateless — keeping filter state there would require complex serialization.
- **Blocking on `MsgMatchStart` in the calibration component:** Just let `useGameSocket` drive phase transitions. When `socket.phase === 'match'`, App.tsx hides CalibrationScreen automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Jitter smoothing | Custom EMA / Kalman filter | `1eurofilter` npm package | OneEuroFilter is the algorithm the REQUIREMENTS.md names; it outperforms simple EMA on speed-adaptive responsiveness |
| Calibration velocity measurement | New approach | Adapt mobile/src/hooks/useCalibration.ts | Already correct, tested, tuned — handles T-pose gate, tracker arm/disarm, neutral settle |
| Landmark velocity computation | New distance/velocity math | Copy mobile/src/lib/velocity.ts | Already handles timing, multi-frame windows, per-axis distance |
| Detection loop | Custom camera capture | Copy mobile/src/hooks/usePose.ts rAF loop | Handles OffscreenCanvas, rVFC, backpressure, error surface |

---

## Common Pitfalls

### Pitfall 1: Protocol mismatch — `arm_reach` vs `reference_velocity`
**What goes wrong:** CalibrationDone is sent with `arm_reach` field; server's `serde_json` deserialization into `MsgCalibrationDone` fails (unknown field) and the calibration handshake never completes — the server never emits `MsgMatchStart`.
**Why it happens:** Phase description incorrectly labels the payload field.
**How to avoid:** Use `{ type: 'calibration_done', reference_velocity: value }` — exactly matching `MsgCalibrationDone` in `shared/protocol.ts`.
**Warning signs:** Both players appear calibrated on client but `MsgMatchStart` never arrives.

### Pitfall 2: Creating a second Worker in usePose
**What goes wrong:** 2-3 second extra delay on the `calibration` screen as a second worker spawns and loads WASM again. May also cause two concurrent `detectForVideo` calls on separate landmarker instances if both workers receive `detect` messages.
**Why it happens:** Mobile's `usePose` spawns its own worker. Copying it verbatim into fps/ bypasses the pre-warmed worker.
**How to avoid:** fps/ `usePose` must accept `workerRef` as a parameter and skip the spawn logic.
**Warning signs:** Console shows two "Model loaded successfully" or equivalent log entries.

### Pitfall 3: OneEuroFilter instances recreated each render
**What goes wrong:** Filter loses its previous-sample state on every render; every frame reads as the raw unsmoothed value. WCI-02 is not satisfied.
**Why it happens:** `new OneEuroFilter(...)` called inside the hook body without a `useRef`.
**How to avoid:** Store the `Map<string, OneEuroFilter>` in `useRef`. Initialize lazily on first landmark frame.
**Warning signs:** At rest, landmark coordinates still jitter at the raw MediaPipe noise level (~0.002–0.005m).

### Pitfall 4: Calibration never exits `tpose` stage
**What goes wrong:** Stage machine stays in `tpose` forever; player cannot proceed.
**Why it happens:** `worldLandmarks` visibility values are < 0.5 for some required landmarks (e.g., hip landmarks partially offscreen, or sitting too close to camera). The tpose gate requires all 8 landmarks (both shoulders, elbows, wrists, hips) to be visible.
**How to avoid:** CalibrationScreen instruction text should explicitly prompt "Step back so your full upper body is visible". The `TPOSE_VISIBILITY_THRESHOLD = 0.5` in useCalibration is the check.
**Warning signs:** tposeProgress stays at 0 even when player holds arms out.

### Pitfall 5: Smoothed keypoints used for velocity (instead of world keypoints)
**What goes wrong:** OneEuroFilter attenuates fast motion; punch peaks are under-reported; reference velocity is too low; hits do minimal damage in the match.
**Why it happens:** Using over-smoothed coordinates (high mincutoff) for velocity computation.
**How to avoid:** `beta=0.007` is speed-adaptive — the filter passes fast motion through. But if mincutoff is raised significantly (e.g., 3.0), the filter introduces lag that kills peak velocity. Keep starting values from STATE.md.
**Warning signs:** 3 punches complete calibration but `reference_velocity` < 1.0 m/s (should be 2-5 m/s for typical punches).

### Pitfall 6: GPU delegate fallback not detected (STATE.md concern)
**What goes wrong:** Worker silently falls back to CPU (8-15ms → 40-80ms per frame). At 60fps, CPU inference takes 40-80ms per frame, which exceeds the 16ms frame budget — the main thread frame rate is not affected (inference is off-thread), but per-frame detection latency increases dramatically, causing pose lag visible as "sticky" arm tracking.
**Why it happens:** The worker catches GPU init failure silently and continues with CPU.
**How to avoid:** In `usePose`, add a timing diagnostic: if the rolling average time between `detect` sent and `result` received exceeds 25ms, log a console warning. This surfaces GPU fallback without blocking the detection loop.
**Warning signs:** Detection loop runs at < 25fps even on a modern laptop with discrete GPU.

---

## Code Examples

### OneEuroFilter hook for PoseKeypoint array

```typescript
// Source: Context7 /casiez/oneeurofilter + adaptation
import { useRef } from 'react';
import { OneEuroFilter } from '1eurofilter';
import type { PoseKeypoint } from '@shared/protocol';

export function useOneEuroFilter(
  keypoints: PoseKeypoint[] | null,
  freq = 60,
  mincutoff = 1.0,
  beta = 0.007,
  dcutoff = 1.0,
): PoseKeypoint[] | null {
  const filtersRef = useRef<Map<string, OneEuroFilter>>(new Map());
  const lastTsRef = useRef<number>(0);

  if (!keypoints) return null;

  const now = performance.now() / 1000; // seconds
  // Guard: filter requires strictly increasing timestamps
  const ts = now > lastTsRef.current ? now : lastTsRef.current + 1 / freq;
  lastTsRef.current = ts;

  const filters = filtersRef.current;
  return keypoints.map((kp, i) => {
    const axes: Array<keyof PoseKeypoint> = ['x', 'y', 'z'];
    const result = { ...kp };
    for (const axis of axes) {
      const key = `${i}_${axis}`;
      if (!filters.has(key)) {
        filters.set(key, new OneEuroFilter(freq, mincutoff, beta, dcutoff));
      }
      (result as Record<string, number>)[axis] = filters.get(key)!.filter(kp[axis] as number, ts);
    }
    return result;
  });
}
```

### MsgCalibrationDone send on calibration complete

```typescript
// Source: fps/src/hooks/useGameSocket.ts (send pattern) + shared/protocol.ts
// In CalibrationScreen or App.tsx onCalibrationDone callback:
socket.send({
  type: 'calibration_done',
  reference_velocity: referenceVelocity,  // number in m/s, avg of 3 punch peaks
});
// Server stores ref_vel[slot] clamped to [0.5, 15.0]
// Server emits MsgMatchStart when both players have submitted
```

### App.tsx extension for phase-driven screen routing

```typescript
// Source: fps/src/App.tsx (existing Phase 12 code + Phase 13 extension)
const showWaiting     = screen === 'waiting' && socket.phase === 'lobby';
const showCalibration = screen === 'waiting' && socket.phase === 'calibration';
const showMatch       = screen === 'waiting' && socket.phase === 'match';

// In render:
{showCalibration && (
  <CalibrationScreen
    stream={cameraStreamRef.current}
    workerRef={warmup.workerRef}
    onCalibrationDone={(refVel) => {
      socket.send({ type: 'calibration_done', reference_velocity: refVel });
    }}
  />
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Running MediaPipe on main thread | Web Worker + postMessage | mobile/ v1.0 | Main thread free for rendering; no Three.js frame drops |
| ImageData copy to worker | `OffscreenCanvas.transferToImageBitmap()` (zero-copy transfer) | mobile/ v1.0 | Eliminates pixel-data copy cost |
| EMA (exponential moving average) smoothing | OneEuroFilter (speed-adaptive cutoff) | v2.0 spec | Better balance: smooth at rest, responsive during fast punches |
| Phone-based pose input | Laptop webcam + Web Worker | v2.0 | Enables first-person view; no phone required |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `reference_velocity` value (m/s wrist peak velocity) is a valid normalization for hit damage across players with different arm lengths; no separate geometric arm-reach measurement is needed | P1-A | Low — the server already uses this approach for boxing; FPSBoxingPlugin.on_calibration_complete confirms it |
| A2 | `1eurofilter` v1.3.0 works correctly in Vite + jsdom test environment (it uses standard ES module exports) | P2-B | Low — package has 0 deps; if it fails in jsdom, use `vi.mock('1eurofilter')` in tests |
| A3 | Starting OneEuroFilter params `mincutoff=1.0, beta=0.007` produce acceptable smoothing for 640×480 webcam at 60fps | P2-B / STATE.md | Medium — STATE.md explicitly flags these as needing tuning; they are a starting point, not final values |

---

## Open Questions

1. **Should `usePose` be a standalone hook or inline in CalibrationScreen?**
   - What we know: Detection must run before calibration and continue into Phase 14 (game loop). A standalone hook is more reusable.
   - Recommendation: `usePose` as a hook in `fps/src/hooks/usePose.ts`, called from App.tsx or a context, with output passed as props to CalibrationScreen and eventually to the Phase 14 game view.

2. **Does CalibrationScreen show a skeleton overlay on the video preview?**
   - What we know: Roadmap says "video preview + 3-punch prompt"; REQUIREMENTS.md says "arm-length calibration step". No mention of skeleton overlay in Phase 13.
   - Recommendation: Defer skeleton overlay to Phase 14 (FPR-01 owns arm rendering). Phase 13 shows raw video + text instructions only. This is simpler and keeps Phase 13 scope tight.

3. **What happens if one player takes >60s to complete calibration?**
   - What we know: No server-side calibration timeout is implemented. The server waits indefinitely for `calibration_done` from both players before emitting `match_start`.
   - Recommendation: Accept for now. A client-side timer showing "waiting for opponent to calibrate" is a Phase 14 polish item.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | fps/ build | Verified (Phase 12) | 20 (Dockerfile) | — |
| npm | fps/ install | Verified (Phase 12) | — | — |
| 1eurofilter | WCI-02 | Not yet installed in fps/ | 1.3.0 (latest) | No fallback — must install |
| MediaPipe WASM (CDN) | WCI-01 | Verified (Phase 12 warmup runs) | 0.10.34 | No fallback — CDN required |

**Missing dependencies with no fallback:**
- `1eurofilter` must be installed in fps/ with `npm install 1eurofilter@1.3.0`

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | fps/vitest.config.ts |
| Quick run command | `cd fps && npx vitest run` |
| Full suite command | `cd fps && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WCI-01 | usePose receives worldLandmarks from worker and exposes them in state | unit (hook) | `cd fps && npx vitest run src/hooks/usePose.test.ts` | Wave 0 |
| WCI-01 | Detection loop skips frame when workerBusy is true | unit (hook) | `cd fps && npx vitest run src/hooks/usePose.test.ts` | Wave 0 |
| WCI-02 | useOneEuroFilter returns smoothed values (not raw input) | unit (hook) | `cd fps && npx vitest run src/hooks/useOneEuroFilter.test.ts` | Wave 0 |
| WCI-02 | Filter instances are reused across renders (stateful) | unit (hook) | `cd fps && npx vitest run src/hooks/useOneEuroFilter.test.ts` | Wave 0 |
| WCI-04 | useCalibration advances stage tpose→punches→neutral→done | unit (hook) | `cd fps && npx vitest run src/hooks/useCalibration.test.ts` | Wave 0 |
| WCI-04 | onComplete called with average of 3 peak velocities | unit (hook) | `cd fps && npx vitest run src/hooks/useCalibration.test.ts` | Wave 0 |
| WCI-04 | CalibrationDone sends MsgCalibrationDone with reference_velocity field | unit (component/integration) | `cd fps && npx vitest run src/components/CalibrationScreen.test.tsx` | Wave 0 |

### Sampling Rate

- **Per task commit:** `cd fps && npx vitest run`
- **Per wave merge:** `cd fps && npx vitest run`
- **Phase gate:** Full fps/ suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `fps/src/hooks/usePose.test.ts` — covers WCI-01 detection loop and backpressure
- [ ] `fps/src/hooks/useOneEuroFilter.test.ts` — covers WCI-02 smoothing and statefulness
- [ ] `fps/src/hooks/useCalibration.test.ts` — covers WCI-04 stage machine and velocity output
- [ ] `fps/src/components/CalibrationScreen.test.tsx` — covers WCI-04 MsgCalibrationDone send
- [ ] `fps/src/lib/velocity.test.ts` — covers computeWristVelocity / computeWristPeakSpeed (can be copied from mobile/ test)

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `reference_velocity` is clamped server-side to [0.5, 15.0] — no client-side input trust needed |
| V6 Cryptography | no | — |

No new attack surface. Landmark data never leaves the client (only the scalar `reference_velocity` is sent to the server over the existing authenticated WebSocket).

---

## Sources

### Primary (HIGH confidence)

- `shared/protocol.ts` — MsgCalibrationDone shape confirmed (`reference_velocity`, not `arm_reach`)
- `engine/fps-boxing-plugin/src/lib.rs` — on_calibration_complete stores ref_vel, clamping verified
- `engine/engine-core/src/protocol.rs` — Rust MsgCalibrationDone struct confirmed
- `fps/src/workers/pose.worker.ts` — complete worker already handles init + detect
- `fps/src/hooks/useWarmup.ts` — workerRef exposed and worker kept alive
- `fps/src/hooks/useGameSocket.ts` — calibration_start → phase='calibration', match_start → phase='match'
- `fps/src/App.tsx` — current screen routing, Phase 13 hook point confirmed
- `mobile/src/hooks/usePose.ts` — detection loop pattern (rAF, OffscreenCanvas, backpressure)
- `mobile/src/hooks/useCalibration.ts` — calibration stage machine, thresholds, velocity computation
- `mobile/src/lib/velocity.ts` — LANDMARK indices, computeWristVelocity, TimedFrame
- `fps/vitest.config.ts` — test configuration confirmed
- npm registry: `1eurofilter` 1.3.0 — no deps, TypeScript-native [VERIFIED: npm view 1eurofilter]

### Secondary (MEDIUM confidence)

- Context7 /casiez/oneeurofilter — API examples and parameter documentation [CITED]
- `.planning/STATE.md` — OneEuroFilter starting params mincutoff=1.0, beta=0.007 [CITED]
- `.planning/ROADMAP.md` — "video preview + 3-punch prompt" UI description [CITED]

---

## Metadata

**Confidence breakdown:**
- Protocol facts: HIGH — MsgCalibrationDone shape verified in shared/protocol.ts and Rust source
- Standard stack: HIGH — worker complete; 1eurofilter verified on npm
- Architecture: HIGH — all hooks verified in existing codebase; adaptation paths are clear
- Pitfalls: HIGH — P1-A (arm_reach) is a definite error in the task description; P1-C (workerRef) is verified in Phase 12 code

**Research date:** 2026-05-13
**Valid until:** 2026-06-12 (stable — 1eurofilter is a mature algorithm; MediaPipe pinned version)
