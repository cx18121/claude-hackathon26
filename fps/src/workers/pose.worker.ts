/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseKeypoint } from '@shared/protocol';

type InMessage =
  | { type: 'init'; wasmUrl: string; modelUrl: string }
  | { type: 'detect'; bitmap: ImageBitmap; timestampMs: number };

type OutMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; worldLandmarks: PoseKeypoint[] | null; landmarks: PoseKeypoint[] | null }
  | { type: 'latency_warning'; elapsedMs: number };

const post = (msg: OutMessage) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

let landmarker: PoseLandmarker | null = null;
let lastTimestampMs = 0;

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(msg.wasmUrl);
      // Try GPU (WebGL) first — available in Workers via OffscreenCanvas in modern browsers.
      // Fall back to CPU/WASM if the GL context can't be created in this Worker.
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: msg.modelUrl, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: msg.modelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === 'detect') {
    // FIX #3: guard against detect arriving before init completes — close the
    // transferred bitmap to prevent a memory leak and unblock the hook.
    if (!landmarker) {
      msg.bitmap.close();
      post({ type: 'error', message: 'detect received before landmarker initialized' });
      return;
    }

    // FIX #2: always close the bitmap in finally (prevents memory leaks on any
    // code path) and always post a result or error so the hook never stalls.
    try {
      // detectForVideo requires monotonically increasing timestamps
      let ts = msg.timestampMs;
      if (ts <= lastTimestampMs) ts = lastTimestampMs + 1;
      lastTimestampMs = ts;

      const detectStart = performance.now();
      const result = landmarker.detectForVideo(msg.bitmap, ts);
      const elapsedMs = performance.now() - detectStart;
      if (elapsedMs > 25) {
        post({ type: 'latency_warning', elapsedMs });
      }

      // FIX #1 (worker side): always include worldLandmarks/landmarks in the
      // result, even as null — the hook uses presence checks, not truthiness.
      const worldLandmarks: PoseKeypoint[] | null = result.worldLandmarks?.[0]
        ? result.worldLandmarks[0].map((lm) => ({
            x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0,
          }))
        : null;

      const landmarks: PoseKeypoint[] | null = result.landmarks?.[0]
        ? result.landmarks[0].map((lm) => ({
            x: lm.x, y: lm.y, z: lm.z ?? 0, visibility: lm.visibility ?? 0,
          }))
        : null;

      post({ type: 'result', worldLandmarks, landmarks });
    } catch (err) {
      // Post error so the hook can reset workerBusy and surface it
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      // Always release the transferred bitmap regardless of success or failure
      msg.bitmap.close();
    }
    return;
  }
};
