import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PoseKeypoint } from '@shared/protocol';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UsePoseResult {
  keypoints: PoseKeypoint[] | null;
  imageKeypoints: PoseKeypoint[] | null;
  fps: number;
  modelStatus: ModelStatus;
  modelError: string | null;
}

// Full model: better accuracy on partial occlusion (punches that swing toward
// the camera), same GPU latency as Lite on modern phones.
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// `requestVideoFrameCallback` types aren't in the lib.dom defaults shipped
// with this version of TypeScript. Cast through this shape rather than
// pulling in a separate @types package.
type RvfcVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: DOMHighResTimeStamp) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

// FIX #4: feature-detect async frame-capture fallback at module level so the
// check doesn't run every frame.
const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
const supportsCreateImageBitmap = typeof createImageBitmap !== 'undefined';

export function usePose(
  videoRef: RefObject<HTMLVideoElement | null>,
  cameraReady: boolean,
): UsePoseResult {
  const [keypoints, setKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [imageKeypoints, setImageKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [fps, setFps] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelError, setModelError] = useState<string | null>(null);

  // Refs let the rAF loop read current values without stale closures
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);

  useEffect(() => {
    if (!cameraReady) return;

    let cancelled = false;
    let rafId = 0;
    let rvfcId = 0;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    let captureCanvas: OffscreenCanvas | null = null;
    let captureCtx: OffscreenCanvasRenderingContext2D | null = null;

    const useRvfc = typeof HTMLVideoElement !== 'undefined'
      && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

    function scheduleNext() {
      if (cancelled) return;
      const video = videoRef.current as RvfcVideoElement | null;
      if (useRvfc && video?.requestVideoFrameCallback) {
        rvfcId = video.requestVideoFrameCallback(loop);
      } else {
        rafId = requestAnimationFrame(loop);
      }
    }

    function loop(now: DOMHighResTimeStamp) {
      if (cancelled) return;
      const video = videoRef.current;
      const worker = workerRef.current;

      // Skip frame if the worker is still processing the previous one — prevents
      // a growing queue that adds latency during fast motion (punches/kicks).
      if (video && worker && video.readyState >= 2 && !workerBusyRef.current) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          if (supportsOffscreen) {
            // FIX #5: wrap OffscreenCanvas path in its own try/catch and surface
            // failures as a modelError rather than silently resetting busy.
            try {
              // Lazy-init / resize the capture canvas
              if (!captureCanvas || captureCanvas.width !== w || captureCanvas.height !== h) {
                captureCanvas = new OffscreenCanvas(w, h);
                captureCtx = captureCanvas.getContext('2d');
              }
              if (captureCtx) {
                captureCtx.drawImage(video, 0, 0, w, h);
                // Synchronous, zero-copy transfer — no pixel data is duplicated
                const bitmap = captureCanvas.transferToImageBitmap();
                workerBusyRef.current = true;
                worker.postMessage(
                  { type: 'detect', bitmap, timestampMs: Math.floor(now) },
                  [bitmap],
                );
              }
            } catch (err) {
              workerBusyRef.current = false;
              if (!cancelled) {
                setModelStatus('error');
                setModelError(err instanceof Error ? err.message : 'Frame capture failed');
              }
            }
          } else if (supportsCreateImageBitmap) {
            // FIX #4: async fallback with diagnostic error on failure
            workerBusyRef.current = true;
            const ts = Math.floor(now);
            createImageBitmap(video).then((bitmap) => {
              if (cancelled || !workerRef.current) {
                bitmap.close();
                workerBusyRef.current = false;
                return;
              }
              workerRef.current.postMessage(
                { type: 'detect', bitmap, timestampMs: ts },
                [bitmap],
              );
            }).catch((err: unknown) => {
              workerBusyRef.current = false;
              if (!cancelled) {
                setModelStatus('error');
                setModelError(
                  err instanceof Error
                    ? err.message
                    : 'createImageBitmap failed — frame capture not supported on this browser',
                );
              }
            });
          } else {
            // Neither capture API available — report once
            if (!cancelled) {
              setModelStatus('error');
              setModelError('Frame capture requires OffscreenCanvas or createImageBitmap (not available on this browser)');
            }
          }
        }
      }

      frameCount += 1;
      const elapsed = performance.now() - fpsWindowStart;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCount * 1000) / elapsed));
        frameCount = 0;
        fpsWindowStart = performance.now();
      }

      scheduleNext();
    }

    // Spawn the Worker — MediaPipe initialises inside it so the main thread
    // never blocks on WASM loading or GPU shader compilation.
    const worker = new Worker(
      new URL('../workers/pose.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    workerBusyRef.current = false;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        message?: string;
        worldLandmarks?: PoseKeypoint[] | null;
        landmarks?: PoseKeypoint[] | null;
      };

      if (msg.type === 'ready') {
        if (!cancelled) {
          setModelStatus('ready');
          scheduleNext();
        }
        return;
      }

      if (msg.type === 'error') {
        // FIX #2 (hook side): worker errors always unblock the busy flag so the
        // loop doesn't stall permanently after a failed detectForVideo call.
        workerBusyRef.current = false;
        if (!cancelled) {
          setModelStatus('error');
          setModelError(msg.message ?? 'Unknown worker error');
        }
        return;
      }

      if (msg.type === 'result') {
        workerBusyRef.current = false;
        if (!cancelled) {
          // FIX #1: use unconditional assignment so null (person left frame) clears
          // stale keypoints. Truthiness check would retain previous-frame poses
          // indefinitely when MediaPipe loses tracking.
          setKeypoints(msg.worldLandmarks ?? null);
          setImageKeypoints(msg.landmarks ?? null);
        }
      }
    };

    worker.onerror = (e) => {
      // FIX #6: reset busy on fatal worker error so the loop doesn't stall
      workerBusyRef.current = false;
      if (!cancelled) {
        setModelStatus('error');
        setModelError(e.message);
      }
    };

    setModelStatus('loading');
    setModelError(null);
    worker.postMessage({ type: 'init', wasmUrl: WASM_URL, modelUrl: MODEL_URL });

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (rvfcId) {
        const video = videoRef.current as RvfcVideoElement | null;
        video?.cancelVideoFrameCallback?.(rvfcId);
      }
      worker.terminate();
      workerRef.current = null;
      workerBusyRef.current = false;
    };
  }, [cameraReady, videoRef]);

  return { keypoints, imageKeypoints, fps, modelStatus, modelError };
}
