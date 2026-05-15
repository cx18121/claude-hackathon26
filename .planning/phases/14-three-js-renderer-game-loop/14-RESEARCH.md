# Phase 14: Three.js Renderer + Game Loop — Research

**Researched:** 2026-05-14
**Domain:** Three.js WebGL, Web Audio API, MediaPipe coordinate mapping, Spring physics
**Confidence:** HIGH (core Three.js stack), MEDIUM (audio synthesis recipes, spring constants)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Arms are live-keypoint-driven — shoulder/elbow/wrist from `smoothedKeypoints` drive 3D geometry each frame. No classifier.
- **D-02:** Geometry: Claude's discretion. Segmented cylinders (upper arm + forearm) are the baseline.
- **D-03:** Spring physics on arm extension — spring integrator (stiffness + damping), arms overshoot wrist target and settle.
- **D-04:** Velocity-scaled extension — `computeWristPeakSpeed` drives scale factor.
- **D-05:** MeshToonMaterial, flat color, thick outlines. Street Fighter / Guilty Gear aesthetic.
- **D-06:** Depth-separated scene pass for player arms (FPR-04 requirement).
- **D-07:** Camera shake damage-scaled to hit damage.
- **D-08:** On confirmed hit: color flash + opponent arm snap back + synthesized sound.
- **D-09:** Web Audio API synthesized sounds — throw (wrist velocity threshold), impact (MsgFpsHit), blocked.
- **D-10:** HUD as HTML overlay on Three.js canvas (CSS-animated), not 3D sprites.
- **D-11:** HP bars — player left, opponent right; color shifts red below 50%.
- **D-12:** Match end screen — WIN/LOSE overlay + rematch button (re-triggers calibration).
- **D-13:** Round timer top center between HP bars.
- **D-14:** Guard blocking — player raises arms to guard position to reduce damage.
- **D-15:** GPU delegate for MediaPipe — target 8-15ms inference; per-frame timing assertion in pose worker.
- **D-16:** Three.js at 60fps using last known keypoints + interpolation; MediaPipe at 30fps.
- **D-17:** OneEuroFilter params (min_cutoff=1.0, beta=0.007) need tuning — implementation concern, not research.

### Claude's Discretion
- Exact arm geometry (cylinder segments, tube, glove shape)
- Spring constants (stiffness, damping) — tune during implementation
- Exact color palette for P1/P2 arms — bold, distinct
- Web Audio synth parameters for punch/impact/blocked sounds

### Deferred Ideas (OUT OF SCOPE)
- Punch type classifier (`usePunchClassifier`) — built in Phase 13.1 but Phase 14 does not call it
- MediaPipe Holistic (hand landmarks + wrist rotation)
- WebRTC transport
- AI Commentary
</user_constraints>

---

## Summary

Phase 14 delivers the complete first-person Three.js in-game view for fps_boxing: keypoint-driven toon-shaded player arms, interpolated opponent arm rendering, hit feedback (camera shake, color flash, audio), and a full HUD. Three.js is not yet in `fps/package.json` — it needs to be installed. The current version is 0.184.0 (April 2026).

The primary rendering challenge is the dual-scene depth separation (D-06/FPR-04): player arms must always render in front of environment geometry. The canonical Three.js technique is `renderer.render(worldScene, camera) → renderer.clearDepth() → renderer.render(armsScene, armsCamera)` — a single WebGLRenderer, two scenes, explicit depth clear between passes. This is cheaper than OutlinePass post-processing and simpler than camera layers.

For toon outlines, `OutlineEffect` from `three/addons/effects/OutlineEffect.js` is the correct tool — it wraps WebGLRenderer with a backface-inflation second pass specifically designed for MeshToonMaterial. OutlinePass (EffectComposer) is for per-object post-processing selection highlighting and is not the right fit here.

**Primary recommendation:** Install `three@^0.184.0` and `@types/three`. Use a single `useGameRenderer` hook that owns the Three.js lifecycle, reads React state via refs, and runs `renderer.setAnimationLoop`. HUD is a React overlay above the canvas, not inside Three.js.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Player arm geometry + animation | Three.js (WebGL) | React hook (lifecycle) | 3D geometry must live in the GPU render layer |
| Opponent arm interpolation | Three.js (WebGL) | Socket state (data source) | Lerp between server ticks happens in the RAF loop |
| Depth separation (FPR-04) | Three.js (WebGL) | — | clearDepth() is a renderer-level operation |
| Toon shading + outlines | Three.js material | — | MeshToonMaterial + OutlineEffect |
| Camera shake | Three.js camera | — | Applies offset to camera.position in RAF loop |
| HUD (HP bars, timer, match end) | React / DOM | CSS | HTML overlay on canvas; no Three.js 3D needed |
| Audio synthesis | Web Audio API | React hook (trigger) | AudioContext lives outside React render cycle |
| Guard detection | React hook / pure fn | — | Landmark math — no GPU involvement |
| MediaPipe pose | Web Worker | React hook (consumer) | Existing pose.worker.ts; GPU delegate in same worker |
| Spring physics | Plain JS in RAF loop | — | Stateful spring state per arm in useRef |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| three | 0.184.0 | WebGL renderer, scene graph, geometry, materials | Official Three.js; latest stable as of April 2026 |
| @types/three | 0.184.0 | TypeScript types for Three.js | Maintained alongside three |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react | 19.2.5 | Component lifecycle, HUD overlay | Existing project dependency |
| @mediapipe/tasks-vision | 0.10.34 | Pose landmark detection | Already in fps/package.json |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| three (plain) | @react-three/fiber | R3F adds a declarative abstraction layer. For this project's imperative game loop pattern (useRef for scene, setAnimationLoop), plain Three.js is simpler and avoids bridging R3F's render loop with the existing socket/pose architecture. |
| OutlineEffect | OutlinePass + EffectComposer | OutlinePass is per-object selection highlighting with resolution/aliasing problems. OutlineEffect is designed for MeshToonMaterial and wraps the renderer directly — correct choice here. |
| clearDepth() dual-scene | depthTest: false on arm material | Setting depthTest:false means arms render through walls but ignores the opponent depth. clearDepth() preserves intra-arm depth ordering while always placing arms in front of the world — correct semantics. |

**Installation:**
```bash
cd fps && npm install three@^0.184.0 && npm install --save-dev @types/three@^0.184.0
```

**Version verification:** `npm view three version` → `0.184.0` (confirmed 2026-04-16). [VERIFIED: npm registry]

---

## Architecture Patterns

### System Architecture Diagram

```
MediaPipe Worker (30fps)
  └── worldLandmarks → usePose → useOneEuroFilter → smoothedKeypoints (App state)

App.tsx (showMatch branch)
  └── <GameRenderer
        smoothedKeypoints={smoothedKeypoints}
        socket={socket}          // lastHit, matchEnd, roundEnd
        playerSlot={effectiveSlot}
      />

GameRenderer component
  ├── useRef: renderer, worldScene, armsScene, armsCamera, worldCamera
  ├── useRef: springState (per arm: pos, vel, target)
  ├── useRef: latestKeypoints   ← updated from smoothedKeypoints prop
  ├── useRef: latestSocketState ← updated from socket prop
  ├── useEffect (mount): init Three.js, mount canvas into #game-canvas-root
  └── renderer.setAnimationLoop(tick):
        1. Read latestKeypoints + latestSocketState (no stale closures)
        2. Update spring integrators (player arm extension)
        3. Update player arm mesh positions (shoulder→elbow→wrist cylinders)
        4. Lerp opponent arm positions toward latest MsgFpsState targets
        5. Apply camera shake decay
        6. renderer.autoClear = false
        7. renderer.clear()        ← clear color + depth once
        8. renderer.render(worldScene, worldCamera)   ← environment + opponent
        9. renderer.clearDepth()   ← reset depth buffer only
       10. renderer.render(armsScene, armsCamera)     ← player arms always on top

HUD (React, positioned absolute over canvas)
  ├── HP bars (CSS width transition)
  ├── Round timer (text)
  └── Match end overlay (WIN/LOSE + rematch button)

Web Audio API (AudioContext, not in React render)
  └── playThrow(), playImpact(), playBlocked() — fire-and-forget synthesis
```

### Recommended Project Structure
```
fps/src/
├── components/
│   ├── GameRenderer.tsx       # Three.js canvas mount + lifecycle
│   ├── GameHud.tsx            # HP bars, timer, match end overlay (pure React)
│   └── GameHud.css            # HUD styling
├── hooks/
│   ├── useGameRenderer.ts     # Three.js scene setup, animation loop
│   ├── useSpring.ts           # Spring integrator (per-arm state)
│   ├── useCameraShake.ts      # Trauma-decay shake state
│   └── useBoxingAudio.ts      # AudioContext, synthesis functions
└── lib/
    ├── armGeometry.ts         # buildArmChain(), updateArmMeshes()
    ├── coordinateMap.ts       # keypointToWorld() transform
    └── guardDetection.ts      # isGuardPose() pure function
```

---

## Q1: Dual-Scene Depth Separation (FPR-04)

**Technique:** Two `THREE.Scene` objects, one `WebGLRenderer`, explicit `clearDepth()` between passes.

```typescript
// Source: Three.js docs — WebGLRenderer.autoClear, clearDepth()
// [VERIFIED: Context7 /mrdoob/three.js]

renderer.autoClear = false;  // Prevent auto-clear on each render() call

function tick() {
  renderer.clear();                          // clear color + depth once per frame
  renderer.render(worldScene, worldCamera);  // environment + opponent arms
  renderer.clearDepth();                     // reset depth buffer only (preserve color)
  renderer.render(armsScene, armsCamera);    // player arms — always render on top
}

renderer.setAnimationLoop(tick);
```

**Why this works:** `clearDepth()` zeroes the depth buffer so every fragment in the second render pass passes the depth test (nothing has written a closer depth yet). The color buffer retains the first pass output. Player arms always appear in front regardless of world geometry.

**Arms camera vs world camera:** Both cameras share the same FOV and orientation. The arms camera can have a slightly narrower near plane (0.05 vs 0.1) so arm meshes near the camera don't clip. Apply camera shake offset only to the world camera — arms stay stable relative to the viewer.

**Not needed:** `renderer.layers`, `camera.layers`, `Object3D.renderOrder`. Those are for per-object selection within a single render pass. clearDepth() is the correct and cheaper approach for viewmodel depth separation.

[VERIFIED: Context7 /mrdoob/three.js, Three.js docs WebGLRenderer.autoClear]

---

## Q2: Keypoint → 3D World Space Transform

MediaPipe pose landmarks come in two flavors from the worker:
- `landmarks` (image-space): x,y ∈ [0,1] normalized by image width/height; z is relative, scaled with x.
- `worldLandmarks` (metric space): x,y,z in meters; origin at hip midpoint; handed coordinate system.

The pose hook currently passes `worldLandmarks` as `keypoints` and `landmarks` as `imageKeypoints`. [VERIFIED: reading pose.worker.ts]

**Use `worldLandmarks` (world-space, in meters) for 3D positioning.** These give real metric distances — a shoulder-to-wrist distance of ~0.65m is realistic.

**Coordinate transform:**

MediaPipe world coordinates:
- +X = right (person's right, viewer's left on front-facing camera)
- +Y = up
- +Z = toward camera

Three.js default:
- +X = right
- +Y = up
- +Z = toward viewer

The two systems align on Y. The X axis needs a **mirror flip** because webcam input is front-facing: the person's right hand appears on the screen's left, so raw MediaPipe X is already in camera-space. Whether to flip depends on whether the game should show "natural" mirrored arms or laterally-correct arms.

For a first-person view where the player sees their own arms: **flip X** (`threeX = -mediapipeX`) so the player's right arm appears on the right side of screen. Without flip, controls feel reversed.

```typescript
// Source: MediaPipe PoseLandmarker worldLandmarks docs
// [CITED: developers.google.com/mediapipe/solutions/vision/pose_landmarker]
// [ASSUMED: flip direction — confirm against live webcam during implementation]

function keypointToWorld(kp: PoseKeypoint, scale = 1.0): THREE.Vector3 {
  return new THREE.Vector3(
    -kp.x * scale,   // flip X: MediaPipe left = Three.js right
     kp.y * scale,   // Y is up in both
    -kp.z * scale,   // MediaPipe +Z toward camera → Three.js -Z into scene
  );
}
```

**Scale factor:** World landmarks are in meters. A scale of 1.0 puts one meter = one Three.js unit. The arm scene FOV should be tuned so the arms fill the lower quadrant of the screen at this scale. If the arm is too small/large, adjust scale (try 2.0–3.0) rather than changing the coordinate formula.

**Positioning in scene:** Translate the entire arm group so the shoulder anchor sits at an appropriate camera-relative position. A natural first-person arm position places the shoulders at approximately (±0.2, -0.3, -0.5) in camera space.

[CITED: developers.google.com/mediapipe/solutions/vision/pose_landmarker]
[ASSUMED: flip direction, suggested translation values — verify against live webcam]

---

## Q3: Spring Physics for Arm Extension

**Integrator:** Semi-implicit Euler (symplectic). Stable and simple for this use case.

```typescript
// [ASSUMED: stiffness/damping starting values — tune during implementation]

interface SpringState {
  pos: number;   // current extension (0 = rest, 1 = full punch extension)
  vel: number;   // current velocity
}

function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  stiffness = 300,  // k — spring constant; higher = snappier return
  damping = 18,     // b — damping coefficient; sqrt(4*k) = critical; use ~0.6x for overshoot
): void {
  const force = stiffness * (target - state.pos) - damping * state.vel;
  state.vel += force * dt;          // semi-implicit: velocity first
  state.pos += state.vel * dt;      // then position from new velocity
}
```

**Starting values for "punchy" feel:**
- `stiffness = 300, damping = 18` → under-damped, ~1.5 oscillation cycles. Snappy overshoot.
- `stiffness = 150, damping = 20` → softer overshoot, more ARMS-like rubbery feel.
- Critical damping threshold = `2 * sqrt(stiffness)` ≈ 34.6 for stiffness=300.
- At damping=18, ratio ζ ≈ 18/34.6 ≈ 0.52 → under-damped (overshoot expected).

**Usage:** Each arm has a `SpringState` stored in a `useRef`. Each frame, `target` is set from `computeWristPeakSpeed` scaled to [0,1]. The spring pos drives a `scaleZ` or `translateZ` on the forearm mesh group.

**Stability note:** Semi-implicit Euler is stable for stiffness values up to approximately `2/dt²`. At 60fps (dt≈0.0167s), max stable stiffness ≈ 7200. Values of 150–500 are well within stability bounds.

[CITED: gafferongames.com/post/integration_basics — semi-implicit Euler]
[ASSUMED: starting stiffness/damping — tune against live feel]

---

## Q4: MeshToonMaterial + Outlines

**Toon shading setup:**

```typescript
// Source: Context7 /mrdoob/three.js — MeshToonMaterial
// [VERIFIED: Context7 /mrdoob/three.js]

// Gradient texture: 2-band (sharp shadow boundary)
const tones = new Uint8Array([0, 0, 0, 255, 255, 255]);  // shadow → lit
const gradientMap = new THREE.DataTexture(tones, 2, 1, THREE.RGBFormat);
gradientMap.needsUpdate = true;
// REQUIRED: NearestFilter for sharp toon band
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;

const armMaterial = new THREE.MeshToonMaterial({
  color: 0xe8440a,   // bold orange-red for P1 (Claude's discretion)
  gradientMap,
});
```

**Outline technique: `OutlineEffect` (backface inflation — NOT OutlinePass)**

```typescript
// Source: Context7 /mrdoob/three.js — OutlineEffect
// [VERIFIED: Context7 /mrdoob/three.js]
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.008,   // thicker = bolder Street Fighter look
  defaultColor: [0, 0, 0],
  defaultAlpha: 1.0,
  defaultKeepAlive: true,    // cache internal materials for performance
});

// In tick loop: replace renderer.render() with effect.render()
// Note: OutlineEffect wraps renderer, not a post-process pass
outlineEffect.render(armsScene, armsCamera);
```

**OutlineEffect vs OutlinePass:**
- `OutlineEffect` (backface inflation): renders each mesh twice — normal pass + scaled-out inverted-normal pass. Single draw call per mesh extra. Designed for MeshToonMaterial. Compatible with the dual-scene clearDepth pattern. **Use this.**
- `OutlinePass` (screen-space edge detection): requires EffectComposer, adds full-resolution ping-pong render targets, has aliasing issues at typical resolutions, adds ~2ms at 1080p. Not designed for toon outlines. **Do not use.**

**Lighting for toon:** MeshToonMaterial requires a light. Add one `THREE.DirectionalLight` from a fixed direction in world space. No shadows needed — toon's flat bands already read clearly. Optionally add `THREE.AmbientLight` at 0.3 intensity to prevent fully-dark shadows.

**Color palette suggestion (Claude's discretion):**
- P1 (self): `0xe8440a` (bold orange-red)
- P2 (opponent): `0x1a7fe8` (bold blue)
- These are bold, high-contrast, distinct from each other and from typical green/gym backgrounds.

[VERIFIED: Context7 /mrdoob/three.js for OutlineEffect, MeshToonMaterial, DataTexture gradient]

---

## Q5: Web Audio API Synthesis

All sounds are synthesized on-demand from `AudioContext`. No audio files needed.

**Throw sound** (triggered when wrist velocity exceeds threshold, e.g. >2.0 m/s):

```typescript
// [CITED: sonoport.github.io/synthesising-sounds-webaudio.html]
// [CITED: developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques]

function playThrow(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Woosh: filtered noise burst
  const bufferSize = ctx.sampleRate * 0.15;  // 150ms
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.15);
}
```

**Impact sound** (triggered on MsgFpsHit received):

```typescript
// [CITED: sonoport.github.io/synthesising-sounds-webaudio.html — kick drum recipe]

function playImpact(ctx: AudioContext, damage: number): void {
  const now = ctx.currentTime;
  const intensity = Math.min(1.0, damage / 25);  // normalize to [0,1]

  // Low-end thud: sine oscillator, pitch decay
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(120 + intensity * 80, now);
  osc1.frequency.exponentialRampToValueAtTime(40, now + 0.1);

  // Noise crack: short noise burst
  const crackBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const crackData = crackBuf.getChannelData(0);
  for (let i = 0; i < crackData.length; i++) crackData[i] = Math.random() * 2 - 1;
  const crack = ctx.createBufferSource();
  crack.buffer = crackBuf;

  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.value = 2000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6 + intensity * 0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc1.connect(gain);
  crack.connect(crackFilter);
  crackFilter.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc1.stop(now + 0.15);
  crack.start(now);
  crack.stop(now + 0.05);
}
```

**Blocked sound** (triggered when punch_type === "blocked"):

```typescript
function playBlocked(ctx: AudioContext): void {
  const now = ctx.currentTime;

  // Dull thud with metallic ring
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}
```

**AudioContext creation:** Create lazily on first user gesture (browser autoplay policy). Store in `useRef`. Create `AudioContext` once; reuse for all sounds.

[CITED: sonoport.github.io, developer.mozilla.org/Web_Audio_API/Advanced_techniques]
[ASSUMED: specific frequency/duration values — tune during implementation]

---

## Q6: Camera Shake (Eiserloh Trauma-Decay Pattern)

```typescript
// [CITED: Squirrel Eiserloh GDC 2016 — "Juicing Your Cameras With Math"]
// mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf

interface ShakeState {
  trauma: number;   // [0, 1] — added on hit, decays each frame
}

const MAX_TRANSLATE_SHAKE = 0.05;  // meters
const MAX_ROTATION_SHAKE = 0.02;   // radians

function addTrauma(state: ShakeState, amount: number): void {
  state.trauma = Math.min(1.0, state.trauma + amount);
}

// damage → trauma mapping (D-07)
function damageToTrauma(damage: number): number {
  // body shot (6-13 dmg) → 0.2-0.3 trauma
  // head shot (15-25 dmg) → 0.4-0.6 trauma
  return Math.min(0.6, damage / 40);
}

function tickShake(
  state: ShakeState,
  camera: THREE.PerspectiveCamera,
  basePosition: THREE.Vector3,
  dt: number,
): void {
  const shake = state.trauma * state.trauma;  // quadratic: gentle start, strong peak

  // Perlin-like: use time-varying noise — simple Math.random() works for short bursts
  camera.position.x = basePosition.x + (Math.random() * 2 - 1) * MAX_TRANSLATE_SHAKE * shake;
  camera.position.y = basePosition.y + (Math.random() * 2 - 1) * MAX_TRANSLATE_SHAKE * shake;
  camera.rotation.z = (Math.random() * 2 - 1) * MAX_ROTATION_SHAKE * shake;

  // Decay: trauma → 0 over ~0.5 seconds
  state.trauma = Math.max(0, state.trauma - dt * 2.0);
}
```

**Key properties:**
- Shake magnitude = trauma². Quadratic means small traumas produce very subtle shake; large hits produce sharp shake.
- Trauma decays linearly (`-= dt * 2.0` → full decay in 0.5s). Tune the decay rate.
- Applied only to `worldCamera` (background + opponent). `armsCamera` stays fixed — arms shouldn't shake with the world.

[CITED: mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf]

---

## Q7: GPU Delegate for MediaPipe in Web Worker

**Current state:** `pose.worker.ts` already tries GPU first with try/catch fallback to CPU. [VERIFIED: reading fps/src/workers/pose.worker.ts]

**The existing code already implements GPU delegate:**
```typescript
// Already in pose.worker.ts — GPU-first with CPU fallback
landmarker = await PoseLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: msg.modelUrl, delegate: 'GPU' },
  runningMode: 'VIDEO',
  numPoses: 1,
});
```

**D-15 requirement (per-frame timing assertion):** The worker needs to measure inference latency and post a warning if it exceeds 25ms (indicating CPU fallback). `usePose.ts` already has this logic (`LATENCY_THRESHOLD_MS = 25`, warns at >25ms average). [VERIFIED: reading fps/src/hooks/usePose.ts]

**Gap:** The timing warning is already in `usePose.ts` but only warns once (`warnedRef.current`). D-15 asks for a "timing assertion" — this could mean either (a) the existing console.warn is sufficient, or (b) surface the fallback state to UI. This is an implementation decision, not a research question.

**WASM MIME type:** Vite serves `.wasm` files with the correct `application/wasm` MIME type automatically. No additional configuration needed. [ASSUMED: Vite version-dependent — verify if WASM fails to load]

**Worker context + OffscreenCanvas:** The worker already uses `OffscreenCanvas` for GPU-accelerated image decoding (`supportsOffscreen()`). GPU delegate (`WebGL`) is available in Workers via `OffscreenCanvas` in Chrome 90+, Firefox 105+, Safari 16.4+. These are the minimum browser targets for WebGL-capable mobile browsers.

[VERIFIED: reading fps/src/workers/pose.worker.ts, fps/src/hooks/usePose.ts]

---

## Q8: React + Three.js Integration Pattern

**Confirmed pattern:** `useRef` for all Three.js scene objects; `useEffect` for lifecycle; `renderer.setAnimationLoop` (not `requestAnimationFrame` directly).

```typescript
// [VERIFIED: Context7 /mrdoob/three.js — setAnimationLoop]

function useGameRenderer(
  containerRef: React.RefObject<HTMLElement | null>,
  smoothedKeypoints: PoseKeypoint[] | null,
  socket: UseGameSocketResult,
  playerSlot: 1 | 2,
) {
  // Three.js objects in refs — NOT state (no React re-renders)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const worldSceneRef = useRef<THREE.Scene | null>(null);
  const armsSceneRef = useRef<THREE.Scene | null>(null);
  const worldCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const armsCameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Sync latest props into refs (avoids stale closures in setAnimationLoop callback)
  const latestKeypointsRef = useRef(smoothedKeypoints);
  const latestSocketRef = useRef(socket);
  useEffect(() => { latestKeypointsRef.current = smoothedKeypoints; }, [smoothedKeypoints]);
  useEffect(() => { latestSocketRef.current = socket; }, [socket]);

  // Init Three.js once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ... scene setup, OutlineEffect, lights ...

    renderer.setAnimationLoop(tick);  // preferred over rAF for Three.js

    return () => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);  // empty deps — runs once

  // tick reads from refs, not closure-captured props
  function tick() {
    const keypoints = latestKeypointsRef.current;
    const socket = latestSocketRef.current;
    // ... update arm meshes, lerp opponent, apply shake ...
  }
}
```

**Critical pattern:** Props that change each frame (keypoints, socket state) must be synced into refs via `useEffect`. The `setAnimationLoop` callback captures these refs, not the closure-time prop values. This is the established pattern for avoiding stale closure bugs in Three.js + React.

**setAnimationLoop vs requestAnimationFrame:** Three.js docs recommend `setAnimationLoop` because it integrates with WebXR and handles the frame loop correctly under the renderer's context. For non-XR use, both work but `setAnimationLoop` is the documented preferred approach. [VERIFIED: Context7 /mrdoob/three.js]

---

## Q9: Lerp Smoothing for Opponent Arms

Server sends `MsgFpsState` at ~30Hz (every ~33ms). Three.js renders at 60fps (~16ms).

**Frame-rate-independent exponential lerp:**

```typescript
// [CITED: rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/]

// α-based lerp: position = lerp(position, target, 1 - Math.exp(-lambda * dt))
// lambda controls response speed: higher = faster convergence
// lambda=10 → reaches 63% of target in 100ms; 99% in ~460ms

function lerpVec3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  dt: number,
): void {
  const alpha = 1 - Math.exp(-lambda * dt);
  current.lerp(target, alpha);
}

// In tick():
// dt = (currentTime - lastTime) / 1000  (seconds)
lerpVec3(opponentShoulderPos, targetShoulderPos, 12, dt);
lerpVec3(opponentElbowPos, targetElbowPos, 12, dt);
lerpVec3(opponentWristPos, targetWristPos, 12, dt);
```

**Should lambda be framerate-independent?** Yes — using `1 - Math.exp(-lambda * dt)` instead of a fixed `t` value makes the smoothing consistent regardless of whether the frame runs at 30, 60, or 120fps.

**lambda = 12** converges quickly (punches land crisply) while still smoothing out the 30Hz jitter. For snappier opponent response, use lambda=15–20. For smoother/laggier feel, use 8.

**On hit (snap back):** When `MsgFpsHit` arrives, forcibly set target position to "retracted" position (elbow and wrist pull back toward shoulder). The lerp will animate the snap-back naturally. Set lambda much higher (50–100) for the snap-back frame only.

[CITED: rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/]

---

## Q10: Guard Detection

Guard pose: both wrists raised above shoulder height in MediaPipe world coordinates.

```typescript
// [VERIFIED: reading fps/src/lib/velocity.ts — LANDMARK constants]
// [CITED: MediaPipe Pose landmark index docs]

import { LANDMARK } from '../lib/velocity.ts';

// Pure function — no Three.js dependency
function isGuardPose(
  keypoints: PoseKeypoint[] | null,
  threshold = 0.05,   // wrist must be this much ABOVE shoulder (in world-Y)
): boolean {
  if (!keypoints || keypoints.length <= LANDMARK.RIGHT_WRIST) return false;

  const leftShoulder  = keypoints[LANDMARK.LEFT_SHOULDER];
  const rightShoulder = keypoints[LANDMARK.RIGHT_SHOULDER];
  const leftWrist     = keypoints[LANDMARK.LEFT_WRIST];
  const rightWrist    = keypoints[LANDMARK.RIGHT_WRIST];

  // MediaPipe world Y: negative = up (inverted from screen Y)
  // Check wrist Y < shoulder Y (both in world coords; more negative = higher)
  const leftGuard  = leftShoulder.y  - leftWrist.y  > threshold;
  const rightGuard = rightShoulder.y - rightWrist.y > threshold;

  return leftGuard && rightGuard;
}
```

**Hysteresis to prevent flickering:** Add enter/exit thresholds.

```typescript
interface GuardState {
  active: boolean;
  consecutiveFrames: number;
}

const ENTER_FRAMES = 3;  // must hold guard for 3 frames to activate
const EXIT_FRAMES  = 5;  // must drop guard for 5 frames to deactivate

function updateGuard(state: GuardState, raw: boolean): void {
  if (raw && !state.active) {
    state.consecutiveFrames++;
    if (state.consecutiveFrames >= ENTER_FRAMES) state.active = true;
  } else if (!raw && state.active) {
    state.consecutiveFrames++;
    if (state.consecutiveFrames >= EXIT_FRAMES) state.active = false;
  } else {
    state.consecutiveFrames = 0;
  }
}
```

**MediaPipe Y-axis convention:** In worldLandmarks, Y is positive downward (screen-space convention). Shoulder Y ≈ 0 (hip midpoint is origin), wrist raised above shoulder has a more-negative Y. The sign in `isGuardPose` may need to be flipped — mark as [ASSUMED], confirm against live data.

[VERIFIED: LANDMARK constants from fps/src/lib/velocity.ts]
[ASSUMED: Y-axis direction in worldLandmarks — confirm against live webcam during implementation]

---

## Arm Geometry — Recommended Approach (D-02, Claude's Discretion)

**Recommended: Tapered cylinders with a simple sphere cap at the wrist.**

Two cylinders per arm:
1. Upper arm: `CylinderGeometry(0.06, 0.05, length, 8)` — slightly tapered shoulder to elbow
2. Forearm: `CylinderGeometry(0.05, 0.04, length, 8)` — slightly tapered elbow to wrist

Segment count = 8 gives a faceted cartoonish look consistent with Guilty Gear/Street Fighter aesthetics. Low enough to be cheap at 60fps.

```typescript
// Source: Context7 /mrdoob/three.js — CylinderGeometry
// [VERIFIED: Context7 /mrdoob/three.js]

function buildArmSegment(radiusTop: number, radiusBottom: number, length: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 8, 1);
  return new THREE.Mesh(geo, mat);
}
```

**Cylinder pivot alignment:** `CylinderGeometry` is centered on its Y-axis. For shoulder→elbow: pivot at the top (shoulder end). Shift geometry by `length/2` in Y so the top of the cylinder is at y=0. Then `mesh.position.copy(shoulderWorld)` and point the cylinder toward `elbowWorld` using `lookAt` on a helper.

**Practical update pattern per frame:**

```typescript
function updateArmSegment(
  mesh: THREE.Mesh,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  const length = from.distanceTo(to);
  mesh.scale.y = length;  // scale instead of rebuilding geometry
  mesh.lookAt(to);
  mesh.rotateX(Math.PI / 2);  // CylinderGeometry Y-axis → world up; rotate to align
}
```

Scaling `mesh.scale.y` instead of rebuilding geometry each frame is the correct approach — geometry creation is expensive.

[VERIFIED: Context7 /mrdoob/three.js CylinderGeometry docs]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toon outlines | Custom backface shader | `OutlineEffect` from `three/addons` | Handles MeshToonMaterial edge cases, cached materials, correct normal flipping |
| Audio synthesis | External audio files | Web Audio API oscillators (shown above) | Zero assets, programmatic control of pitch/intensity |
| Frame-rate-independent lerp | `lerp(a, b, 0.1)` (fixed t) | `lerp(a, b, 1 - exp(-lambda * dt))` | Fixed t lerp is framerate-dependent — breaks at non-60fps |
| Arm mesh updates | Rebuild CylinderGeometry each frame | Scale + rotate existing mesh | Geometry creation causes GC pressure; scale is GPU-only |
| Multiple render targets for depth sep | WebGLRenderTarget depth textures | `renderer.clearDepth()` | 3 lines of code vs significant render target complexity |

**Key insight:** Three.js addons (OutlineEffect, postprocessing passes) solve the toon-specific edge cases that seem trivial but have subtleties (normal averaging, material caching, two-pass ordering). Don't replicate them.

---

## Common Pitfalls

### Pitfall 1: Stale Closure in setAnimationLoop
**What goes wrong:** The `setAnimationLoop` callback captures `props` or `state` at setup time. Socket updates and new keypoints are never seen.
**Why it happens:** `useEffect([], [])` runs once; the closure freezes.
**How to avoid:** Sync all mutable inputs into `useRef` objects. The animation loop reads from refs, not props.
**Warning signs:** Arms freeze at startup position; HP bar never updates.

### Pitfall 2: Y-Axis Inversion in MediaPipe WorldLandmarks
**What goes wrong:** Arms appear upside-down or guard detection logic is inverted.
**Why it happens:** MediaPipe worldLandmarks Y+ = down (hip-centric, screen convention). Three.js Y+ = up.
**How to avoid:** Negate Y when mapping (`threeY = -mediapipeY`). Verify with a visual debug sphere at the shoulder position before implementing arm geometry.
**Warning signs:** Wrist position appears above the elbow visually when the player's arm is at their side.

### Pitfall 3: autoClear = true with dual-scene render
**What goes wrong:** The second `renderer.render()` call clears the color buffer, wiping the world scene output.
**Why it happens:** `autoClear` defaults to `true`. Each `render()` call clears before drawing.
**How to avoid:** Set `renderer.autoClear = false` at setup. Call `renderer.clear()` manually once per frame before the first render.
**Warning signs:** Only player arms render; world/opponent is invisible.

### Pitfall 4: CylinderGeometry Y-axis vs arm direction
**What goes wrong:** Arm cylinders point straight up regardless of joint positions.
**Why it happens:** `mesh.lookAt()` orients the mesh's Z-axis toward the target. CylinderGeometry extends along Y, not Z.
**How to avoid:** After `lookAt`, apply `mesh.rotateX(Math.PI / 2)` to rotate Y→Z alignment, OR use a parent `Object3D` for lookAt and keep the cylinder as a child.
**Warning signs:** Cylinders all vertical even as wrist moves.

### Pitfall 5: AudioContext Autoplay Block
**What goes wrong:** `AudioContext` throws `NotAllowedError` or audio never plays.
**Why it happens:** Browser requires user gesture before audio playback.
**How to avoid:** Create `AudioContext` lazily inside the first user-triggered event (click, touch). Cache it in a ref afterward.
**Warning signs:** Console shows `AudioContext was not allowed to start`.

### Pitfall 6: OutlineEffect + clearDepth interaction
**What goes wrong:** Outlines appear on world scene objects rendered before clearDepth(), not just player arms.
**Why it happens:** OutlineEffect wraps the whole renderer; if used for the world scene pass it applies outlines everywhere.
**How to avoid:** Use OutlineEffect only for the arms scene pass. Use plain `renderer.render()` for the world scene pass.
**Warning signs:** Opponent arm outlines appear, environment outlines appear — very expensive.

---

## Code Examples

### Full Dual-Scene Render Loop
```typescript
// [VERIFIED: Three.js docs WebGLRenderer.autoClear, clearDepth()]
renderer.autoClear = false;

const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.008,
  defaultColor: [0, 0, 0],
  defaultKeepAlive: true,
});

renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - lastTime) / 1000, 0.05);  // cap dt at 50ms
  lastTime = time;

  // Update game state (spring, lerp, shake) via refs
  updateArms(dt);
  updateOpponent(dt);
  updateShake(dt);

  // Render pass 1: world (environment + opponent)
  renderer.clear();
  renderer.render(worldScene, worldCamera);

  // Render pass 2: player arms — always in front
  renderer.clearDepth();
  outlineEffect.render(armsScene, armsCamera);
});
```

### MeshToonMaterial with 2-band gradient
```typescript
// [VERIFIED: Context7 /mrdoob/three.js]
const tones = new Uint8Array([80, 80, 80, 255, 255, 255]);
const gradientMap = new THREE.DataTexture(tones, 2, 1, THREE.RGBFormat);
gradientMap.needsUpdate = true;
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
const mat = new THREE.MeshToonMaterial({ color: 0xe8440a, gradientMap });
```

### Frame-rate-independent opponent lerp
```typescript
// [CITED: rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/]
const alpha = 1 - Math.exp(-12 * dt);
opponentWristPos.lerp(targetWristFromServer, alpha);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `requestAnimationFrame` loop in Three.js apps | `renderer.setAnimationLoop()` | Three.js r70+ | Integrates with WebXR; preferred for all Three.js apps |
| Separate `three` and `three-examples` packages | `three/addons/` imports | r139+ | All addons (OutlineEffect, postprocessing) now from `three/addons/` |
| `THREE.RGBFormat` DataTexture | `THREE.RGBFormat` still valid | — | Still the correct format for 1D gradient maps |
| requestVideoFrameCallback missing types | Workaround type cast in usePose.ts | Existing code | Already handled in fps/ codebase |

**Deprecated/outdated:**
- `THREE.GradientTexture`: Does not exist as a class. Use `DataTexture` with a 1D array and NearestFilter.
- `renderer.render()` called multiple times with `autoClear = true`: Will wipe previous passes. Always set `autoClear = false` for multi-pass.
- `OutlinePass` for toon outlines: Wrong tool. Use `OutlineEffect`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | Install three | Assumed present | — | — |
| three | Three.js rendering | NOT YET INSTALLED | — | Must install |
| @types/three | TypeScript types | NOT YET INSTALLED | — | Must install |
| WebGL 2 | WebGLRenderer | Available in target browsers | — | — |
| AudioContext | Web Audio synthesis | Available in all target browsers | — | — |
| OffscreenCanvas | GPU pose worker | Already in use in pose.worker.ts | — | CPU fallback (existing) |

**Missing dependencies that block execution:**
- `three` and `@types/three` must be installed before any Phase 14 work begins. Install command: `cd fps && npm install three@^0.184.0 && npm install --save-dev @types/three@^0.184.0`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | X flip needed: `threeX = -mediapipeX` for correct arm laterality | Q2 coordinate transform | Arms appear on wrong side; punch controls feel reversed |
| A2 | worldLandmarks Y+ = down (hip-centric) so `threeY = -mediapipeY` | Q10 guard detection, Q2 | Arms appear upside-down; guard logic inverted |
| A3 | Scale factor 1.0–3.0 for arm scene world size | Q2 | Arms too small/large; adjust during implementation |
| A4 | Suggested shoulder anchor position (±0.2, -0.3, -0.5) | Q2 | Arms not visible or in wrong position |
| A5 | Spring stiffness=300, damping=18 as starting values | Q3 | Punch extension feels wrong; tune during implementation |
| A6 | Web Audio frequency/duration values for sounds | Q5 | Sounds unconvincing; adjust during implementation |
| A7 | Vite serves WASM with correct MIME type automatically | Q7 | MediaPipe fails to load; fix: add vite-plugin-wasm if needed |
| A8 | lambda=12 for opponent lerp provides good feel | Q9 | Opponent arms lag or jitter; adjust during implementation |
| A9 | ENTER_FRAMES=3, EXIT_FRAMES=5 for guard hysteresis | Q10 | Guard activates too easily or misses real guards |

---

## Open Questions

1. **Y-axis sign in worldLandmarks**
   - What we know: MediaPipe normalizedLandmarks has Y+ downward (screen). WorldLandmarks uses hip-midpoint origin.
   - What's unclear: Whether worldLandmarks Y is positive-down or positive-up (docs are ambiguous).
   - Recommendation: Add a debug sphere at landmark[0] (nose) and landmark[11] (left shoulder) and verify on first implementation day. Flip Y if nose is below shoulder in Three.js world.

2. **Arm scale vs camera FOV tuning**
   - What we know: World landmarks are in meters (~0.65m arm length).
   - What's unclear: The exact FOV and camera position for the arms camera to make arms feel "right-sized" in first-person.
   - Recommendation: Start with FOV=60, arms camera at origin facing -Z, shoulder anchored at (±0.22, -0.25, -0.4). Iterate quickly — this is feel, not formula.

3. **OutlineEffect + dual-scene: can one OutlineEffect instance render two scenes?**
   - What we know: OutlineEffect wraps the renderer and calls `renderer.render()` internally.
   - What's unclear: Whether `outlineEffect.render(armsScene, ...)` works after a plain `renderer.render(worldScene, ...)` with autoClear=false.
   - Recommendation: Use OutlineEffect only for the arms scene pass. Test first with plain `renderer.render()` for both passes to confirm depth separation, then add OutlineEffect on the arms pass only.

---

## Plan Decomposition Recommendation

**Suggested split: 4 PLAN files.**

| Plan | Title | Contents | Dependencies |
|------|-------|----------|--------------|
| 14-01 | Three.js Setup + Arm Geometry | Install three; GameRenderer mount; dual-scene setup; arm cylinder geometry from keypoints (no spring yet); MeshToonMaterial gradient; OutlineEffect | None — foundational |
| 14-02 | Spring Physics + Velocity Extension + Opponent Lerp | Spring integrator; computeWristPeakSpeed → extension scale; opponent arm lerp from MsgFpsState; guard detection | 14-01 (needs arm meshes) |
| 14-03 | Hit Feedback — Camera Shake + Flash + Audio | Web Audio synthesis (throw/impact/blocked); camera shake on MsgFpsHit; color flash overlay (CSS); opponent arm snap back | 14-01, 14-02 |
| 14-04 | HUD + Game Loop — HP Bars + Timer + Match End | GameHud React component; HP bar animation; round timer display; match end overlay + rematch; guard damage reduction wiring | 14-01, socket state |

**Rationale:** 14-01 is the load-bearing foundation. 14-02 and 14-03 can be written in parallel once 14-01 ships (they both depend on the scene being mounted). 14-04 is pure React/CSS and can be developed alongside 14-03. The coarse granularity setting means one PLAN per capability cluster is appropriate.

---

## Sources

### Primary (HIGH confidence)
- Context7 `/mrdoob/three.js` — WebGLRenderer.autoClear, clearDepth(), setAnimationLoop, MeshToonMaterial, OutlineEffect, OutlinePass, CylinderGeometry, DataTexture, Object3D.renderOrder
- `fps/src/workers/pose.worker.ts` — GPU delegate already implemented; CPU fallback pattern
- `fps/src/hooks/usePose.ts` — latency warning already in place; worldLandmarks vs landmarks distinction
- `fps/src/lib/velocity.ts` — LANDMARK constants, computeWristPeakSpeed
- `fps/package.json` — three.js NOT yet installed; confirmed dependencies

### Secondary (MEDIUM confidence)
- sonoport.github.io/synthesising-sounds-webaudio.html — kick drum / snare percussion synthesis
- developer.mozilla.org Web Audio API Advanced Techniques
- rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/ — frame-rate-independent exponential lerp formula
- mathforgameprogrammers.com/gdc2016 Squirrel Eiserloh GDC talk — trauma-decay camera shake pattern
- ryanjuckett.com/damped-springs/ — spring integrator theory, under-damped parameter guidance

### Tertiary (LOW confidence / ASSUMED)
- Coordinate flip direction (X, Y) — requires live webcam verification
- Spring constant starting values — tuned by feel during implementation
- Audio frequency/duration values — subjective; tune during implementation

**Research date:** 2026-05-14
**Valid until:** 2026-06-14 (Three.js stable; 30-day window before re-check advised)
