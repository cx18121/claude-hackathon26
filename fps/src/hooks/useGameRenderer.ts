import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import type { PoseKeypoint } from '@shared/protocol';
import type { MsgFpsHit } from '@shared/protocol';
import { buildArmSegment, updateArmSegment } from '../lib/armGeometry';

// Minimal disposable surface — covers geometries, materials, textures.
type ThreeDisposable = { dispose: () => void };
import { keypointToWorld, WORLD_SCALE } from '../lib/coordinateMap';
import { LANDMARK, computeWristPeakSpeed, type TimedFrame } from '../lib/velocity';
import { stepSpring, type SpringState } from '../lib/springPhysics';
import { isGuardPose, updateGuard, type GuardState } from '../lib/guardDetection';
import type { UseGameSocketResult } from './useGameSocket';
import { useBoxingAudio } from './useBoxingAudio';

interface ArmMeshes {
  leftUpper: THREE.Mesh;
  leftFore: THREE.Mesh;
  rightUpper: THREE.Mesh;
  rightFore: THREE.Mesh;
}

interface OpponentPositions {
  lShoulder: THREE.Vector3;
  lElbow: THREE.Vector3;
  lWrist: THREE.Vector3;
  rShoulder: THREE.Vector3;
  rElbow: THREE.Vector3;
  rWrist: THREE.Vector3;
}

/** Build a 2-band toon gradient DataTexture for MeshToonMaterial. */
function buildGradientMap(): THREE.DataTexture {
  const tones = new Uint8Array([80, 80, 80, 255, 255, 255, 255, 255]);
  const gradientMap = new THREE.DataTexture(tones, 2, 1, THREE.RGBAFormat);
  gradientMap.needsUpdate = true;
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  return gradientMap;
}

/**
 * useGameRenderer — owns the Three.js lifecycle for the FPS boxing game view.
 *
 * Architecture:
 *  - All Three.js objects live in useRef (never useState — no re-renders).
 *  - Props are synced into refs each render to avoid stale closures in setAnimationLoop.
 *  - Dual-scene render: worldScene (opponent) → clearDepth() → armsScene (player, always on top).
 *  - OutlineEffect wraps only the armsScene pass (Pitfall 6 — not world pass).
 *  - T-14-01-02: dt capped at 50ms to prevent spiral-of-death if tab is backgrounded.
 *  - T-14-01-04: cleanup disposes renderer and removes canvas on unmount.
 *  - Spring physics (FPR-02): forearm scale.z driven by wrist velocity via stepSpring().
 *  - Opponent lerp (FPR-03): frame-rate-independent exponential lerp at lambda=12.
 *  - Guard detection (GML-04): isGuardPose() + updateGuard() hysteresis each frame.
 *  - Camera shake (HFB-01): Eiserloh trauma-decay applied to worldCamera only.
 *  - Opponent snap-back (HFB-03): lambda=80 boost for 3 frames on MsgFpsHit.
 *  - Audio (D-09): useBoxingAudio playImpact/playBlocked triggered on MsgFpsHit.
 *  - Hit flash (HFB-04): triggerFlashRef called on MsgFpsHit; implementation set by GameRenderer.
 *
 * @param containerRef - ref to the div that will contain the Three.js canvas
 * @param smoothedKeypoints - filtered keypoints from usePose + useOneEuroFilter
 * @param socket - game socket result (reads lastFpsState each frame via ref)
 * @param playerSlot - 1 or 2; determines player arm color
 * @returns { guardStateRef, triggerFlashRef } — refs for Plan 14-04 and hit flash wiring
 */
export function useGameRenderer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  smoothedKeypoints: PoseKeypoint[] | null,
  socket: UseGameSocketResult,
  playerSlot: 1 | 2,
): {
  guardStateRef: React.MutableRefObject<GuardState>;
  triggerFlashRef: React.MutableRefObject<() => void>;
} {
  // Audio synthesis — lazy AudioContext (browser autoplay policy)
  const { playImpact, playBlocked } = useBoxingAudio();

  // Three.js scene objects — all in refs, never state
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const worldSceneRef = useRef<THREE.Scene | null>(null);
  const armsSceneRef = useRef<THREE.Scene | null>(null);
  const worldCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const armsCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const outlineEffectRef = useRef<OutlineEffect | null>(null);
  const playerArmMeshesRef = useRef<ArmMeshes | null>(null);
  const opponentArmMeshesRef = useRef<ArmMeshes | null>(null);
  const lastTimeRef = useRef(performance.now());

  // Sync latest props into refs — avoids stale closures in setAnimationLoop callback
  const latestKeypointsRef = useRef(smoothedKeypoints);
  const latestSocketRef = useRef(socket);
  useEffect(() => { latestKeypointsRef.current = smoothedKeypoints; }, [smoothedKeypoints]);
  useEffect(() => { latestSocketRef.current = socket; }, [socket]);

  // Spring physics state (FPR-02) — one per arm
  const springStateRef = useRef<{ left: SpringState; right: SpringState }>({
    left: { pos: 0, vel: 0 },
    right: { pos: 0, vel: 0 },
  });

  // Guard detection state (GML-04) — exposed in return value for Plan 14-04
  const guardStateRef = useRef<GuardState>({ active: false, consecutiveFrames: 0 });

  // Rolling 5-frame keypoint buffer for computeWristPeakSpeed
  const frameBufferRef = useRef<TimedFrame[]>([]);

  // Opponent lerp targets (updated when a new MsgFpsState arrives)
  const opponentTargetRef = useRef<OpponentPositions | null>(null);

  // Opponent current positions (lerped toward targets each frame)
  const opponentCurrentRef = useRef<OpponentPositions>({
    lShoulder: new THREE.Vector3(),
    lElbow:    new THREE.Vector3(),
    lWrist:    new THREE.Vector3(),
    rShoulder: new THREE.Vector3(),
    rElbow:    new THREE.Vector3(),
    rWrist:    new THREE.Vector3(),
  });

  // Camera shake state (HFB-01, Eiserloh trauma-decay)
  // trauma in [0,1] — capped at 1.0 regardless of damage (T-14-03-01)
  const shakeStateRef = useRef<{ trauma: number }>({ trauma: 0 });

  // Camera rest position — shake offsets are applied relative to this base
  const worldCameraBaseRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 5));

  // Previously processed MsgFpsHit — compare by object reference to detect new hits
  const lastFpsHitRef = useRef<MsgFpsHit | null>(null);

  // Opponent snap-back (HFB-03) — use lambda=80 for 3 frames after a hit
  const snapBackActiveRef = useRef(false);
  const snapBackFramesRef = useRef(0);

  // Hit flash trigger (HFB-04) — GameRenderer sets the actual implementation via useEffect
  const triggerFlashRef = useRef<() => void>(() => {});

  // Init Three.js once on mount — empty deps
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Track every geometry / material / texture created in this effect so
    // we can dispose them on unmount. renderer.dispose() does NOT recurse
    // into scene contents, so without explicit disposal these accumulate
    // GPU memory across rematches / Strict Mode double-mount.
    const disposables: ThreeDisposable[] = [];

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.autoClear = false; // Pitfall 3: must be false for dual-scene pass
    renderer.setClearColor(0x0a0a0c);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Scenes ---
    const worldScene = new THREE.Scene();
    const armsScene = new THREE.Scene();
    worldSceneRef.current = worldScene;
    armsSceneRef.current = armsScene;

    // --- Cameras ---
    const aspect = container.clientWidth / container.clientHeight;
    const worldCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 100);
    worldCamera.position.copy(worldCameraBaseRef.current);
    const armsCamera = new THREE.PerspectiveCamera(60, aspect, 0.05, 10);
    worldCameraRef.current = worldCamera;
    armsCameraRef.current = armsCamera;

    // --- Lighting (both scenes) ---
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(1, 2, 1);
    const ambLight1 = new THREE.AmbientLight(0xffffff, 0.3);
    worldScene.add(dirLight1, ambLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight2.position.set(1, 2, 1);
    const ambLight2 = new THREE.AmbientLight(0xffffff, 0.3);
    armsScene.add(dirLight2, ambLight2);

    // --- Materials ---
    // P1: orange-red arms, P2: blue arms (swapped for opponent)
    const p1Color = 0xe8440a;
    const p2Color = 0x1a7fe8;
    const playerColor = playerSlot === 1 ? p1Color : p2Color;
    const opponentColor = playerSlot === 1 ? p2Color : p1Color;

    const playerGradient = buildGradientMap();
    disposables.push(playerGradient);
    const playerMat = new THREE.MeshToonMaterial({ color: playerColor, gradientMap: playerGradient });
    disposables.push(playerMat);

    const opponentGradient = buildGradientMap();
    disposables.push(opponentGradient);
    const opponentMat = new THREE.MeshToonMaterial({ color: opponentColor, gradientMap: opponentGradient });
    disposables.push(opponentMat);

    // --- Player arm meshes (arms scene — depth separated) ---
    const playerArms: ArmMeshes = {
      leftUpper:  buildArmSegment(0.06, 0.05, playerMat),
      leftFore:   buildArmSegment(0.05, 0.04, playerMat),
      rightUpper: buildArmSegment(0.06, 0.05, playerMat),
      rightFore:  buildArmSegment(0.05, 0.04, playerMat),
    };
    armsScene.add(playerArms.leftUpper, playerArms.leftFore, playerArms.rightUpper, playerArms.rightFore);
    disposables.push(
      playerArms.leftUpper.geometry,
      playerArms.leftFore.geometry,
      playerArms.rightUpper.geometry,
      playerArms.rightFore.geometry,
    );
    playerArmMeshesRef.current = playerArms;

    // --- Opponent arm meshes (world scene) ---
    const opponentArms: ArmMeshes = {
      leftUpper:  buildArmSegment(0.06, 0.05, opponentMat),
      leftFore:   buildArmSegment(0.05, 0.04, opponentMat),
      rightUpper: buildArmSegment(0.06, 0.05, opponentMat),
      rightFore:  buildArmSegment(0.05, 0.04, opponentMat),
    };
    worldScene.add(opponentArms.leftUpper, opponentArms.leftFore, opponentArms.rightUpper, opponentArms.rightFore);
    disposables.push(
      opponentArms.leftUpper.geometry,
      opponentArms.leftFore.geometry,
      opponentArms.rightUpper.geometry,
      opponentArms.rightFore.geometry,
    );
    opponentArmMeshesRef.current = opponentArms;

    // --- OutlineEffect (arms scene only — Pitfall 6) ---
    const outlineEffect = new OutlineEffect(renderer, {
      defaultThickness: 0.008,
      defaultColor: [0, 0, 0],
      defaultAlpha: 1.0,
      defaultKeepAlive: true,
    });
    outlineEffectRef.current = outlineEffect;

    lastTimeRef.current = performance.now();

    // --- Animation loop ---
    renderer.setAnimationLoop((time) => {
      // T-14-01-02: cap dt at 50ms to prevent spiral-of-death if tab is backgrounded
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      const keypoints = latestKeypointsRef.current;
      const currentSocket = latestSocketRef.current;

      // Guard detection (GML-04) — runs every frame regardless of keypoint availability
      const rawGuard = isGuardPose(keypoints);
      updateGuard(guardStateRef.current, rawGuard);

      // Hit detection (HFB-01, HFB-03, HFB-04, D-09) — compare by object reference
      const hit = currentSocket.lastFpsHit;
      if (hit && hit !== lastFpsHitRef.current) {
        lastFpsHitRef.current = hit;

        // T-14-03-01: trauma capped at 1.0 — server cannot cause unbounded shake
        const traumaAmount = Math.min(0.6, hit.damage / 40);
        shakeStateRef.current.trauma = Math.min(1.0, shakeStateRef.current.trauma + traumaAmount);

        // Opponent snap-back (HFB-03): retract wrists/elbows toward shoulders for 3 frames
        if (opponentTargetRef.current !== null) {
          const t = opponentTargetRef.current;
          opponentTargetRef.current = {
            lShoulder: t.lShoulder.clone(),
            lElbow:    t.lShoulder.clone(),
            lWrist:    t.lShoulder.clone(),
            rShoulder: t.rShoulder.clone(),
            rElbow:    t.rShoulder.clone(),
            rWrist:    t.rShoulder.clone(),
          };
        }
        snapBackActiveRef.current = true;
        snapBackFramesRef.current = 3;

        // Audio (D-09): blocked → dull thud; any other punch_type → sharp impact
        if (hit.punch_type === 'blocked') {
          playBlocked();
        } else {
          playImpact(hit.damage);
        }

        // Hit flash (HFB-04): call triggerFlash implementation set by GameRenderer
        triggerFlashRef.current();
      }

      // Update player arms from smoothed keypoints
      if (keypoints && keypoints.length > LANDMARK.RIGHT_WRIST) {
        // Push current frame into rolling 5-frame buffer for peak speed computation
        const frame: TimedFrame = { keypoints, t: performance.now() };
        frameBufferRef.current.push(frame);
        if (frameBufferRef.current.length > 5) {
          frameBufferRef.current.shift();
        }

        // Compute wrist peak speed and map to spring target in [0, 1]
        // Speed of 4 m/s → full extension (tune 4.0 if feel is wrong)
        const leftPeakSpeed  = computeWristPeakSpeed(frameBufferRef.current, 'left');
        const rightPeakSpeed = computeWristPeakSpeed(frameBufferRef.current, 'right');
        const leftTarget  = Math.min(1.0, leftPeakSpeed  / 4.0);
        const rightTarget = Math.min(1.0, rightPeakSpeed / 4.0);

        // Step spring integrators (FPR-02)
        stepSpring(springStateRef.current.left,  leftTarget,  dt);
        stepSpring(springStateRef.current.right, rightTarget, dt);

        // Shoulder anchor offset: translate keypoints so arms sit naturally in first-person view
        // [ASSUMED A4] — tune against live webcam; shoulders ~(±0.22, -0.25, -0.4) in camera space
        const anchorOffset = new THREE.Vector3(0, -0.25 * WORLD_SCALE, -0.4 * WORLD_SCALE);

        const lShoulder = keypointToWorld(keypoints[LANDMARK.LEFT_SHOULDER], WORLD_SCALE).add(anchorOffset);
        const lElbow    = keypointToWorld(keypoints[LANDMARK.LEFT_ELBOW],    WORLD_SCALE).add(anchorOffset);
        const lWrist    = keypointToWorld(keypoints[LANDMARK.LEFT_WRIST],    WORLD_SCALE).add(anchorOffset);
        const rShoulder = keypointToWorld(keypoints[LANDMARK.RIGHT_SHOULDER], WORLD_SCALE).add(anchorOffset);
        const rElbow    = keypointToWorld(keypoints[LANDMARK.RIGHT_ELBOW],    WORLD_SCALE).add(anchorOffset);
        const rWrist    = keypointToWorld(keypoints[LANDMARK.RIGHT_WRIST],    WORLD_SCALE).add(anchorOffset);

        updateArmSegment(playerArms.leftUpper,  lShoulder, lElbow);
        updateArmSegment(playerArms.leftFore,   lElbow,    lWrist);
        updateArmSegment(playerArms.rightUpper, rShoulder, rElbow);
        updateArmSegment(playerArms.rightFore,  rElbow,    rWrist);

        // Apply spring extension to forearm meshes (scale.z drives Z-axis stretch)
        // spring.pos in [0, 1] → scale factor 1.0 to 1.4 (40% max stretch at full extension)
        playerArms.leftFore.scale.z  = 1.0 + springStateRef.current.left.pos  * 0.4;
        playerArms.rightFore.scale.z = 1.0 + springStateRef.current.right.pos * 0.4;
      }

      // Update opponent lerp targets from latest MsgFpsState
      // Skip target update during snap-back phase (snap-back sets its own retracted target)
      const fpsState = currentSocket.lastFpsState;
      if (fpsState && !snapBackActiveRef.current) {
        opponentTargetRef.current = {
          lShoulder: keypointToWorld(fpsState.left_shoulder,  WORLD_SCALE),
          lElbow:    keypointToWorld(fpsState.left_elbow,     WORLD_SCALE),
          lWrist:    keypointToWorld(fpsState.left_wrist,     WORLD_SCALE),
          rShoulder: keypointToWorld(fpsState.right_shoulder, WORLD_SCALE),
          rElbow:    keypointToWorld(fpsState.right_elbow,    WORLD_SCALE),
          rWrist:    keypointToWorld(fpsState.right_wrist,    WORLD_SCALE),
        };
      }

      // Lerp opponent arm positions toward targets (FPR-03)
      // lambda=12 → reaches 99% of target in ~460ms; smooth for 30Hz server ticks
      // snap-back active: use lambda=80 for faster snap (HFB-03)
      const target = opponentTargetRef.current;
      if (target !== null) {
        const lambda = snapBackActiveRef.current ? 80 : 12;
        const alpha = 1 - Math.exp(-lambda * dt);
        const cur = opponentCurrentRef.current;
        cur.lShoulder.lerp(target.lShoulder, alpha);
        cur.lElbow.lerp(target.lElbow, alpha);
        cur.lWrist.lerp(target.lWrist, alpha);
        cur.rShoulder.lerp(target.rShoulder, alpha);
        cur.rElbow.lerp(target.rElbow, alpha);
        cur.rWrist.lerp(target.rWrist, alpha);

        const opponentArms = opponentArmMeshesRef.current;
        if (opponentArms) {
          updateArmSegment(opponentArms.leftUpper,  cur.lShoulder, cur.lElbow);
          updateArmSegment(opponentArms.leftFore,   cur.lElbow,    cur.lWrist);
          updateArmSegment(opponentArms.rightUpper, cur.rShoulder, cur.rElbow);
          updateArmSegment(opponentArms.rightFore,  cur.rElbow,    cur.rWrist);
        }

        // Decrement snap-back frame counter (HFB-03)
        if (snapBackActiveRef.current) {
          snapBackFramesRef.current -= 1;
          if (snapBackFramesRef.current <= 0) {
            snapBackActiveRef.current = false;
          }
        }
      }

      // Camera shake (HFB-01) — applied ONLY to worldCamera, never armsCamera
      // Eiserloh trauma-decay: shake = trauma², decays at -2.0/s (full fade in ~0.5s)
      const shake = shakeStateRef.current.trauma ** 2;
      worldCamera.position.x = worldCameraBaseRef.current.x + (Math.random() * 2 - 1) * 0.05 * shake;
      worldCamera.position.y = worldCameraBaseRef.current.y + (Math.random() * 2 - 1) * 0.05 * shake;
      worldCamera.rotation.z = (Math.random() * 2 - 1) * 0.02 * shake;
      shakeStateRef.current.trauma = Math.max(0, shakeStateRef.current.trauma - dt * 2.0);

      // Dual-scene render pass (FPR-04 depth separation)
      // OutlineEffect + autoClear=false verified: CONFIRMED — renderer.clearDepth() before
      // outlineEffect.render() prevents depth bleed; no autoClear override needed on OutlineEffect
      // (OutlineEffect does not clobber the world pass when clearDepth() precedes it — Plan 14-01b Task 2 spike B)
      renderer.clear(); // clear color + depth once per frame
      renderer.render(worldScene, worldCamera); // pass 1: world (environment + opponent)
      renderer.clearDepth(); // reset depth buffer — player arms always render on top
      outlineEffect.render(armsScene, armsCamera); // pass 2: player arms with toon outlines
    });

    // T-14-01-04: cleanup on unmount — prevents renderer leak in React strict mode
    return () => {
      renderer.setAnimationLoop(null);
      // Dispose scene contents before the renderer — renderer.dispose() does
      // not walk the scene graph, so geometries / materials / textures would
      // otherwise leak GPU memory across rematches and Strict Mode mounts.
      for (const d of disposables) {
        d.dispose();
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      // T-14-02-04: clear frame buffer on unmount
      frameBufferRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { guardStateRef, triggerFlashRef };
}
