# Phase 14: Three.js Renderer + Game Loop — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `fps/src/components/GameRenderer.tsx` | component | event-driven (RAF loop) | `fps/src/components/CalibrationScreen.tsx` | role-match |
| `fps/src/hooks/useGameRenderer.ts` | hook | event-driven (setAnimationLoop) | `fps/src/hooks/useCalibration.ts` | role-match |
| `fps/src/hooks/useSpring.ts` | hook | transform | `fps/src/hooks/useOneEuroFilter.ts` | role-match |
| `fps/src/hooks/useCameraShake.ts` | hook | transform | `fps/src/hooks/useOneEuroFilter.ts` | role-match |
| `fps/src/hooks/useBoxingAudio.ts` | hook | event-driven | `fps/src/hooks/usePunchClassifier.ts` | role-match |
| `fps/src/components/GameHud.tsx` | component | request-response | `fps/src/components/WaitingScreen.tsx` | exact |
| `fps/src/components/GameHud.css` | config | — | `fps/src/app.css` | exact |
| `fps/src/lib/armGeometry.ts` | utility | transform | `fps/src/lib/normalizeWindow.ts` | role-match |
| `fps/src/lib/coordinateMap.ts` | utility | transform | `fps/src/lib/velocity.ts` | role-match |
| `fps/src/lib/guardDetection.ts` | utility | transform | `fps/src/lib/velocity.ts` | exact |
| `fps/src/App.tsx` (modified) | component | request-response | self | exact |

---

## Pattern Assignments

### `fps/src/components/GameRenderer.tsx` (component, event-driven)

**Analog:** `fps/src/components/CalibrationScreen.tsx`

**Imports pattern** (CalibrationScreen.tsx lines 1-5):
```typescript
import { useEffect, useRef } from 'react';
import type React from 'react';
import type { PoseKeypoint } from '@shared/protocol';
import { useCalibration } from '../hooks/useCalibration';
```

**Props interface pattern** (CalibrationScreen.tsx lines 6-10):
```typescript
interface CalibrationScreenProps {
  stream: MediaStream | null;
  keypoints: PoseKeypoint[] | null;
  onCalibrationDone: (referenceVelocity: number) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}
```

**Core component pattern — hook + container ref** (CalibrationScreen.tsx lines 18-22):
```typescript
export function CalibrationScreen({ stream, keypoints, onCalibrationDone, videoRef: externalVideoRef }: CalibrationScreenProps) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;
  // useEffect wires stream to video element
  // hook handles all logic; component is thin
```

**GameRenderer props to follow:**
```typescript
interface GameRendererProps {
  smoothedKeypoints: PoseKeypoint[] | null;
  socket: UseGameSocketResult;
  playerSlot: 1 | 2;
}
// Mount point: a <div ref={containerRef} /> that fills the #game-canvas-root div.
// All Three.js lifecycle lives in useGameRenderer — component is thin.
```

---

### `fps/src/hooks/useGameRenderer.ts` (hook, event-driven)

**Analog:** `fps/src/hooks/useCalibration.ts` (for `useEffect` / `useRef` lifecycle pattern) and `fps/src/hooks/usePose.ts` (for refs-instead-of-closures pattern)

**Imports pattern** (usePose.ts lines 1-3, useCalibration.ts lines 11-18):
```typescript
import { useEffect, useRef, useState } from 'react';
import type { PoseKeypoint } from '@shared/protocol';
import { LANDMARK, computeWristPeakSpeed, type TimedFrame } from '../lib/velocity';
```

**Refs-instead-of-closures pattern** (usePose.ts lines 34-38):
```typescript
// Refs let the rAF loop read current values without stale closures
const workerBusyRef = useRef(false);
const detectSentAtRef = useRef<number | null>(null);
const latencyWindowRef = useRef<number[]>([]);
const warnedRef = useRef(false);
```

**Apply to useGameRenderer:** All Three.js objects and all mutable inputs (keypoints, socket state) must be stored in `useRef`. The `setAnimationLoop` callback reads from refs, never from closure-captured props.

```typescript
// Pattern: sync props into refs each render so the animation loop never stalls
const latestKeypointsRef = useRef(smoothedKeypoints);
const latestSocketRef = useRef(socket);
useEffect(() => { latestKeypointsRef.current = smoothedKeypoints; }, [smoothedKeypoints]);
useEffect(() => { latestSocketRef.current = socket; }, [socket]);
```

**Mount / cleanup lifecycle pattern** (usePose.ts lines 40-46, 162-172):
```typescript
useEffect(() => {
  if (!cameraReady) return;
  const worker = workerRef.current;
  if (!worker) return;

  let cancelled = false;
  // ... setup ...

  scheduleNext();

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    // DO NOT terminate worker — it belongs to useWarmup
  };
}, [cameraReady, workerRef, videoRef]);
```

**Apply to useGameRenderer:**
```typescript
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  // init renderer, scenes, cameras, OutlineEffect, lights
  // set renderer.autoClear = false
  renderer.setAnimationLoop(tick);  // preferred over rAF for Three.js
  return () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    container.removeChild(renderer.domElement);
  };
}, []);  // empty deps — runs once; reads from refs inside tick
```

**Latency warning pattern** (usePose.ts lines 121-138): Copy the rolling-window latency warn pattern for the D-15 per-frame timing assertion. Instead of `warnedRef.current = true` (warn once), log every frame where inference exceeds 25ms into `console.warn` — per D-15 requirement for "per-frame assertion".

---

### `fps/src/hooks/useSpring.ts` (hook, transform)

**Analog:** `fps/src/hooks/useOneEuroFilter.ts` — stateful per-frame transform hook that stores filter state in `useRef` and returns a transformed value each call.

**Pattern** (useOneEuroFilter.ts lines 1-35):
```typescript
import { useRef } from 'react';
// ... external lib import ...

export function useOneEuroFilter(
  keypoints: PoseKeypoint[] | null,
  freq = 60,
  mincutoff = 1.0,
  // ...
): PoseKeypoint[] | null {
  const filtersRef = useRef<Map<string, OneEuroFilter>>(new Map());
  const lastTsRef = useRef<number>(0);

  if (!keypoints) return null;

  // stateful transform — mutate ref, return result synchronously
  const filters = filtersRef.current;
  return keypoints.map((kp, i) => {
    // ...apply filter per axis...
  });
}
```

**Apply to useSpring:** `useSpring` stores `SpringState` (pos, vel) per arm in `useRef`. The spring step is called from the `setAnimationLoop` tick (not from React render). `useSpring` may be a plain module export of `stepSpring()` + a per-arm `SpringState` interface rather than a React hook, since spring state lives in the game loop's `useRef` collection, not in React state.

```typescript
// Preferred: plain module (not a hook) — called from tick()
export interface SpringState { pos: number; vel: number; }

export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  stiffness = 300,
  damping = 18,
): void {
  const force = stiffness * (target - state.pos) - damping * state.vel;
  state.vel += force * dt;   // semi-implicit: velocity first
  state.pos += state.vel * dt;
}
```

---

### `fps/src/hooks/useCameraShake.ts` (hook, transform)

**Analog:** `fps/src/hooks/useOneEuroFilter.ts` — same pattern: stateful transform, state in `useRef`, called per frame.

Same pattern as useSpring: prefer a plain module export of `ShakeState` + `addTrauma()` + `tickShake()`, called from the `setAnimationLoop` tick rather than a React hook. If it is a hook, follow the `useRef`-for-mutable-state pattern from `useOneEuroFilter.ts`.

---

### `fps/src/hooks/useBoxingAudio.ts` (hook, event-driven)

**Analog:** `fps/src/hooks/usePunchClassifier.ts` — hook that loads a resource once on mount (`useEffect([], [])`) and exposes fire-and-forget functions.

**Resource-load-on-mount pattern** (usePunchClassifier.ts lines 67-86):
```typescript
useEffect(() => {
  let cancelled = false;
  async function loadModel() {
    try {
      const session = await ort.InferenceSession.create('/models/punch_classifier_int8.onnx', {
        executionProviders: ['wasm'],
      });
      if (!cancelled) {
        sessionRef.current = session;
      }
    } catch (err) {
      console.error('[usePunchClassifier] model load failed:', err);
    }
  }
  loadModel();
  return () => { cancelled = true; };
}, []);
```

**Apply to useBoxingAudio:** `AudioContext` is created lazily on first user gesture (D-09 / browser autoplay policy). Store in `useRef`. Expose `playThrow()`, `playImpact(damage)`, `playBlocked()` as stable function refs. Do NOT create `AudioContext` in the `useEffect` mount — create it inside the first `play*` call.

```typescript
export function useBoxingAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }

  // playThrow, playImpact, playBlocked call getCtx() then synthesize
  return { playThrow, playImpact, playBlocked };
}
```

---

### `fps/src/components/GameHud.tsx` (component, request-response)

**Analog:** `fps/src/components/WaitingScreen.tsx` — thin presentational component, all data via props, no internal logic.

**Pattern** (WaitingScreen.tsx lines 1-20):
```typescript
interface WaitingScreenProps {
  roomCode: string;
  slot: 1 | 2;
  opponentConnected: boolean;
}

export function WaitingScreen({ roomCode, slot, opponentConnected }: WaitingScreenProps) {
  return (
    <div className="waiting-screen">
      <h1 className="title">SPECTRE</h1>
      // ... purely declarative JSX; no useEffect, no useRef
    </div>
  );
}
```

**Apply to GameHud:**
```typescript
interface GameHudProps {
  playerHp: number;        // 0..800
  opponentHp: number;      // 0..800
  roundTimer: number;      // seconds remaining
  matchEnd: { winner: 1 | 2 } | null;
  playerSlot: 1 | 2;
  onRematch: () => void;
}

export function GameHud({ playerHp, opponentHp, roundTimer, matchEnd, playerSlot, onRematch }: GameHudProps) {
  // HP bar widths as CSS percentages: (hp / 800) * 100
  // Color class: hp < 400 → 'hp-bar--danger' (CSS shifts to red)
  // matchEnd truthy → full-screen overlay with WIN/LOSE + rematch button
}
```

---

### `fps/src/components/GameHud.css` (styling)

**Analog:** `fps/src/app.css` — uses CSS custom properties from `:root`, follows oklch color tokens.

**Color token pattern** (app.css lines 1-10):
```css
:root {
  --bg-deep:        oklch(7% 0.008 22);
  --bg-mid:         oklch(11% 0.009 22);
  --bg-surface:     oklch(17% 0.01 22);
  --accent:         oklch(44% 0.22 22);
  --accent-bright:  oklch(60% 0.25 22);
  --text-primary:   oklch(95% 0.008 85);
  --text-secondary: oklch(65% 0.008 85);
  --text-dim:       oklch(38% 0.006 85);
}
```

**Apply to GameHud.css:** Use the existing CSS tokens. Add HUD-specific tokens for HP bar colors (healthy green → danger red). Position HUD as `position: absolute; inset: 0; pointer-events: none;` over the canvas. Use CSS `transition: width 150ms ease-out` for HP bar animation. Use `transition: background-color 300ms ease` for the danger color shift below 50%.

---

### `fps/src/lib/armGeometry.ts` (utility, transform)

**Analog:** `fps/src/lib/normalizeWindow.ts` — pure function module, no React, operates on typed data structures, returns computed result.

**Pattern** (normalizeWindow.ts lines 1-45):
```typescript
import type { PoseKeypoint } from '@shared/protocol';

/**
 * JSDoc describing critical contract (e.g. "must match train.py formula exactly").
 */
export function normalizeWindow(
  buffer: PoseKeypoint[][],
  jointIndices: number[],
): Float32Array {
  // pure computation — no side effects, no React
  const data = new Float32Array(T * J * C);
  // ... loop ...
  return data;
}
```

**Apply to armGeometry.ts:** Two pure functions with no Three.js state:
- `buildArmSegment(radiusTop, radiusBottom, length, mat)` → `THREE.Mesh`
- `updateArmSegment(mesh, from, to)` → `void` — positions + scales existing mesh, never rebuilds geometry.

Use `THREE.CylinderGeometry` centered on Y-axis; apply `mesh.rotateX(Math.PI / 2)` after `lookAt` to align Y-axis to the direction vector.

---

### `fps/src/lib/coordinateMap.ts` (utility, transform)

**Analog:** `fps/src/lib/velocity.ts` — pure utility functions operating on `PoseKeypoint`, exports constants + named functions.

**Pattern** (velocity.ts lines 1-22):
```typescript
import type { PoseKeypoint } from '@shared/protocol';

export interface TimedFrame {
  keypoints: PoseKeypoint[];
  t: number;
}

export const LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  // ...
} as const;

function distance(a: PoseKeypoint, b: PoseKeypoint): number { ... }

export function computeWristPeakSpeed(frames: TimedFrame[], wrist: 'left' | 'right'): number { ... }
```

**Apply to coordinateMap.ts:**
```typescript
import type { PoseKeypoint } from '@shared/protocol';
import * as THREE from 'three';

// Pure mapping — no React, no Three.js scene state
export function keypointToWorld(kp: PoseKeypoint, scale = 1.0): THREE.Vector3 {
  return new THREE.Vector3(
    -kp.x * scale,   // flip X: person's right → screen right in first-person
    -kp.y * scale,   // flip Y: MediaPipe Y+ down → Three.js Y+ up
    -kp.z * scale,   // MediaPipe +Z toward camera → Three.js -Z into scene
  );
}
// Note: Y flip direction is [ASSUMED A2] — verify against live webcam on day 1
```

---

### `fps/src/lib/guardDetection.ts` (utility, transform)

**Analog:** `fps/src/lib/velocity.ts` — pure function, uses `LANDMARK` constants imported from velocity.ts, operates on `PoseKeypoint[]`.

**Pattern** (velocity.ts lines 51-66):
```typescript
export function computeWristPeakSpeed(
  frames: TimedFrame[],
  wrist: 'left' | 'right',
): number {
  if (frames.length < 2) return 0;
  const idx = wrist === 'left' ? LANDMARK.LEFT_WRIST : LANDMARK.RIGHT_WRIST;
  // guard check at top, then loop
}
```

**Apply to guardDetection.ts:**
```typescript
import type { PoseKeypoint } from '@shared/protocol';
import { LANDMARK } from './velocity';

// Pure function — no Three.js, no React
export function isGuardPose(keypoints: PoseKeypoint[] | null, threshold = 0.05): boolean {
  if (!keypoints || keypoints.length <= LANDMARK.RIGHT_WRIST) return false;
  // Compare wrist Y vs shoulder Y
  // [ASSUMED A2]: Y sign direction — verify against live webcam
}

export interface GuardState { active: boolean; consecutiveFrames: number; }
export function updateGuard(state: GuardState, raw: boolean): void { ... }
```

---

### `fps/src/App.tsx` (modified — mount GameRenderer)

**Analog:** Self. Current `showMatch` branch (App.tsx lines 48, 80-82).

**Current pattern** (App.tsx lines 80-82):
```typescript
{showMatch && (
  <div id="game-canvas-root" />
)}
```

**Modified pattern — pass props to GameRenderer:**
```typescript
import { GameRenderer } from './components/GameRenderer';

{showMatch && (
  <GameRenderer
    smoothedKeypoints={smoothedKeypoints}
    socket={socket}
    playerSlot={effectiveSlot}
  />
)}
```

`smoothedKeypoints` is already available at App level (line 32). `socket` is the `UseGameSocketResult` from `useGameSocket()` (line 24). `effectiveSlot` is already defined (line 49). No additional state needed in App.tsx.

---

## Shared Patterns

### useRef for Non-Reactive Game State
**Source:** `fps/src/hooks/usePose.ts` (lines 34-38), `fps/src/hooks/useGameSocket.ts` (lines 111-122)
**Apply to:** `useGameRenderer.ts`, `useBoxingAudio.ts`, `useSpring.ts`, `useCameraShake.ts`
```typescript
// Three.js objects, timers, and state that must not trigger re-renders → useRef
const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
const worldSceneRef = useRef<THREE.Scene | null>(null);
const springStateRef = useRef<{ left: SpringState; right: SpringState }>({
  left: { pos: 0, vel: 0 },
  right: { pos: 0, vel: 0 },
});
```

### Props-to-Refs Sync (Stale Closure Prevention)
**Source:** `fps/src/hooks/usePose.ts` (lines 34-38), confirmed by RESEARCH.md Q8
**Apply to:** `useGameRenderer.ts` (critical — setAnimationLoop callback captures refs, not props)
```typescript
const latestKeypointsRef = useRef(smoothedKeypoints);
const latestSocketRef = useRef(socket);
useEffect(() => { latestKeypointsRef.current = smoothedKeypoints; }, [smoothedKeypoints]);
useEffect(() => { latestSocketRef.current = socket; }, [socket]);
```

### Cancellation Flag in useEffect
**Source:** `fps/src/hooks/usePose.ts` (line 45), `fps/src/hooks/usePunchClassifier.ts` (line 67)
**Apply to:** Any `useEffect` with async setup or subscriptions
```typescript
useEffect(() => {
  let cancelled = false;
  // async setup...
  return () => { cancelled = true; };
}, []);
```

### Null-Guard at Top of Hook
**Source:** `fps/src/hooks/usePunchClassifier.ts` (line 89), `fps/src/hooks/useCalibration.ts` (line 126)
**Apply to:** `useGameRenderer.ts`, `useBoxingAudio.ts`, `guardDetection.ts`
```typescript
if (!keypoints || !sessionRef.current) return;
// or
if (!keypoints || keypoints.length <= LANDMARK.RIGHT_WRIST) return false;
```

### CSS Custom Properties (Design Tokens)
**Source:** `fps/src/app.css` (lines 1-10)
**Apply to:** `fps/src/components/GameHud.css`
Use existing `--bg-*`, `--accent`, `--text-primary` tokens. Add HUD-specific vars:
```css
--hp-healthy: oklch(55% 0.18 145);   /* green */
--hp-danger:  oklch(55% 0.22 25);    /* red — shifts below 50% HP */
--hud-font:   system-ui, sans-serif; /* matches app.css font-family */
```

### @shared/protocol Import
**Source:** All hooks (`useGameSocket.ts` line 1, `usePose.ts` line 2, `velocity.ts` line 1)
**Apply to:** All new files that use `PoseKeypoint` or message types
```typescript
import type { PoseKeypoint } from '@shared/protocol';
```
`MsgFpsState` and `MsgFpsHit` types come from `.claude/worktrees/shared/` — check tsconfig path aliases for the exact import path used in the project.

---

## No Analog Found

All Phase 14 files have adequate analogs in the codebase. The following files introduce genuinely new capabilities but map well to existing patterns:

| File | Role | Data Flow | Note |
|---|---|---|---|
| `fps/src/hooks/useBoxingAudio.ts` | hook | event-driven | Web Audio API is new to the codebase — follow usePunchClassifier lazy-load pattern for AudioContext creation |
| Three.js renderer code (WebGL) | — | — | Three.js is not yet installed. Install first: `cd fps && npm install three@^0.184.0 && npm install --save-dev @types/three@^0.184.0` |

---

## Metadata

**Analog search scope:** `fps/src/` (all subdirectories)
**Files read:** 14
**Pattern extraction date:** 2026-05-14
