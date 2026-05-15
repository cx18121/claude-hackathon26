import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import type { PoseKeypoint } from '@shared/protocol';
import { buildArmSegment, updateArmSegment } from '../lib/armGeometry';
import { keypointToWorld, WORLD_SCALE } from '../lib/coordinateMap';
import { LANDMARK } from '../lib/velocity';
import type { UseGameSocketResult } from './useGameSocket';

interface ArmMeshes {
  leftUpper: THREE.Mesh;
  leftFore: THREE.Mesh;
  rightUpper: THREE.Mesh;
  rightFore: THREE.Mesh;
}

/** Build a 2-band toon gradient DataTexture for MeshToonMaterial. */
function buildGradientMap(): THREE.DataTexture {
  const tones = new Uint8Array([80, 80, 80, 255, 255, 255]);
  const gradientMap = new THREE.DataTexture(tones, 2, 1, THREE.RGBFormat);
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
 *
 * @param containerRef - ref to the div that will contain the Three.js canvas
 * @param smoothedKeypoints - filtered keypoints from usePose + useOneEuroFilter
 * @param socket - game socket result (reads lastFpsState each frame via ref)
 * @param playerSlot - 1 or 2; determines player arm color
 */
export function useGameRenderer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  smoothedKeypoints: PoseKeypoint[] | null,
  socket: UseGameSocketResult,
  playerSlot: 1 | 2,
): void {
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

  // Init Three.js once on mount — empty deps
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    const playerMat = new THREE.MeshToonMaterial({ color: playerColor, gradientMap: playerGradient });

    const opponentGradient = buildGradientMap();
    const opponentMat = new THREE.MeshToonMaterial({ color: opponentColor, gradientMap: opponentGradient });

    // --- Player arm meshes (arms scene — depth separated) ---
    const playerArms: ArmMeshes = {
      leftUpper:  buildArmSegment(0.06, 0.05, playerMat),
      leftFore:   buildArmSegment(0.05, 0.04, playerMat),
      rightUpper: buildArmSegment(0.06, 0.05, playerMat),
      rightFore:  buildArmSegment(0.05, 0.04, playerMat),
    };
    armsScene.add(playerArms.leftUpper, playerArms.leftFore, playerArms.rightUpper, playerArms.rightFore);
    playerArmMeshesRef.current = playerArms;

    // --- Opponent arm meshes (world scene) ---
    const opponentArms: ArmMeshes = {
      leftUpper:  buildArmSegment(0.06, 0.05, opponentMat),
      leftFore:   buildArmSegment(0.05, 0.04, opponentMat),
      rightUpper: buildArmSegment(0.06, 0.05, opponentMat),
      rightFore:  buildArmSegment(0.05, 0.04, opponentMat),
    };
    worldScene.add(opponentArms.leftUpper, opponentArms.leftFore, opponentArms.rightUpper, opponentArms.rightFore);
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

      // Update player arms from smoothed keypoints
      if (keypoints && keypoints.length > LANDMARK.RIGHT_WRIST) {
        // Shoulder anchor offset: translate keypoints so arms sit naturally in first-person view
        // [ASSUMED A4] — tune against live webcam; shoulders ~(±0.22, -0.25, -0.4) in camera space
        const anchorOffset = new THREE.Vector3(0, -0.25 * WORLD_SCALE, -0.4 * WORLD_SCALE);

        const lShoulder = keypointToWorld(keypoints[LANDMARK.LEFT_SHOULDER], WORLD_SCALE).add(anchorOffset);
        const lElbow    = keypointToWorld(keypoints[LANDMARK.LEFT_ELBOW],    WORLD_SCALE).add(anchorOffset);
        const lWrist    = keypointToWorld(keypoints[LANDMARK.LEFT_WRIST],    WORLD_SCALE).add(anchorOffset);
        const rShoulder = keypointToWorld(keypoints[LANDMARK.RIGHT_SHOULDER], WORLD_SCALE).add(anchorOffset);
        const rElbow    = keypointToWorld(keypoints[LANDMARK.RIGHT_ELBOW],    WORLD_SCALE).add(anchorOffset);
        const rWrist    = keypointToWorld(keypoints[LANDMARK.RIGHT_WRIST],    WORLD_SCALE).add(anchorOffset);

        updateArmSegment(playerArms.leftUpper, lShoulder, lElbow);
        updateArmSegment(playerArms.leftFore,  lElbow,    lWrist);
        updateArmSegment(playerArms.rightUpper, rShoulder, rElbow);
        updateArmSegment(playerArms.rightFore,  rElbow,    rWrist);
      }

      // Update opponent arms from MsgFpsState (no lerp in Plan 14-01; lerp added in Plan 14-02)
      const fpsState = currentSocket.lastFpsState;
      if (fpsState) {
        const oLShoulder = keypointToWorld(fpsState.left_shoulder,  WORLD_SCALE);
        const oLElbow    = keypointToWorld(fpsState.left_elbow,     WORLD_SCALE);
        const oLWrist    = keypointToWorld(fpsState.left_wrist,     WORLD_SCALE);
        const oRShoulder = keypointToWorld(fpsState.right_shoulder, WORLD_SCALE);
        const oRElbow    = keypointToWorld(fpsState.right_elbow,    WORLD_SCALE);
        const oRWrist    = keypointToWorld(fpsState.right_wrist,    WORLD_SCALE);

        updateArmSegment(opponentArms.leftUpper,  oLShoulder, oLElbow);
        updateArmSegment(opponentArms.leftFore,   oLElbow,    oLWrist);
        updateArmSegment(opponentArms.rightUpper, oRShoulder, oRElbow);
        updateArmSegment(opponentArms.rightFore,  oRElbow,    oRWrist);
      }

      // Dual-scene render pass (FPR-04 depth separation)
      // OutlineEffect + autoClear=false verified: CONFIRMED — renderer.clearDepth() before
      // outlineEffect.render() prevents depth bleed; no autoClear override needed on OutlineEffect
      // (OutlineEffect does not clobber the world pass when clearDepth() precedes it — Plan 14-01b Task 2 spike B)
      renderer.clear(); // clear color + depth once per frame
      renderer.render(worldScene, worldCamera); // pass 1: world (environment + opponent)
      renderer.clearDepth(); // reset depth buffer — player arms always render on top
      outlineEffect.render(armsScene, armsCamera); // pass 2: player arms with toon outlines

      void dt; // dt available for future spring/shake use in Plan 14-02/14-03
    });

    // T-14-01-04: cleanup on unmount — prevents renderer leak in React strict mode
    return () => {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
