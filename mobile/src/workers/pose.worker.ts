/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseKeypoint } from '@shared/protocol';

type InMessage =
  | { type: 'init'; wasmUrl: string; modelUrl: string }
  | { type: 'detect'; bitmap: ImageBitmap; timestampMs: number };

type OutMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; worldLandmarks: PoseKeypoint[] | null; landmarks: PoseKeypoint[] | null };

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
      (self as DedicatedWorkerGlobalScope).postMessage({ type: 'ready' } satisfies OutMessage);
    } catch (err) {
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies OutMessage);
    }
    return;
  }

  if (msg.type === 'detect' && landmarker) {
    try {
      // detectForVideo requires monotonically increasing timestamps
      let ts = msg.timestampMs;
      if (ts <= lastTimestampMs) ts = lastTimestampMs + 1;
      lastTimestampMs = ts;

      const result = landmarker.detectForVideo(msg.bitmap, ts);
      msg.bitmap.close();

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

      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'result', worldLandmarks, landmarks,
      } satisfies OutMessage);
    } catch {
      msg.bitmap.close();
    }
    return;
  }
};
