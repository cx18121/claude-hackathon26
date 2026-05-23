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

const post = (msg: OutMessage) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

let landmarker: PoseLandmarker | null = null;
let lastTimestampMs = 0;

// Feature-detect a working WebGL2 in this worker. MediaPipe's GPU delegate
// initialises a WebGL2 context internally and on iOS Safari that init can
// fail asynchronously — the outer try/catch around createFromOptions doesn't
// always catch it because the error fires from a microtask after the
// constructor resolves. By probing WebGL2 ourselves and only attempting GPU
// when we know it works, we avoid the iOS failure path entirely.
function hasWorkerWebGL2(): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    const probe = new OffscreenCanvas(1, 1);
    const gl = probe.getContext('webgl2');
    return gl !== null;
  } catch {
    return false;
  }
}

// Serialize any thrown value into the most diagnostic string possible.
// Plain `err.message` drops the error name (e.g. "RuntimeError" vs
// "TypeError") and the stack, both of which we need to triage iOS-only
// failures without a remote debugger attached.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [`${err.name}: ${err.message}`];
    if (err.stack) parts.push(err.stack);
    return parts.join('\n');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(msg.wasmUrl);
      // Try GPU only when WebGL2 actually works in this worker context. On
      // browsers without working worker-WebGL2 (notably iOS Safari classic
      // workers), we go straight to CPU/WASM and skip the GPU attempt that
      // would otherwise error asynchronously and dead-lock init.
      const canTryGpu = hasWorkerWebGL2();
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: msg.modelUrl,
            delegate: canTryGpu ? 'GPU' : 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch {
        // If GPU was attempted and failed synchronously, retry on CPU.
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: msg.modelUrl, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: describeError(err) });
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

      const result = landmarker.detectForVideo(msg.bitmap, ts);

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
      post({ type: 'error', message: describeError(err) });
    } finally {
      // Always release the transferred bitmap regardless of success or failure
      msg.bitmap.close();
    }
    return;
  }
};
