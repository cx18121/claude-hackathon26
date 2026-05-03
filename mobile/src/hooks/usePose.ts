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

    // OffscreenCanvas on the main thread: synchronous zero-copy frame capture.
    // Falls back to async createImageBitmap on browsers without OffscreenCanvas.
    const supportsOffscreen = typeof OffscreenCanvas !== 'undefined';
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
          try {
            if (supportsOffscreen) {
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
            } else {
              // Fallback: async capture (adds ~1ms but works everywhere)
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
              }).catch(() => { workerBusyRef.current = false; });
            }
          } catch {
            workerBusyRef.current = false;
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
      const msg = e.data as { type: string; message?: string; worldLandmarks?: PoseKeypoint[]; landmarks?: PoseKeypoint[] };

      if (msg.type === 'ready') {
        if (!cancelled) {
          setModelStatus('ready');
          scheduleNext();
        }
        return;
      }

      if (msg.type === 'error') {
        if (!cancelled) {
          setModelStatus('error');
          setModelError(msg.message ?? 'Unknown error');
        }
        return;
      }

      if (msg.type === 'result') {
        workerBusyRef.current = false;
        if (!cancelled) {
          if (msg.worldLandmarks) setKeypoints(msg.worldLandmarks);
          if (msg.landmarks) setImageKeypoints(msg.landmarks);
        }
      }
    };

    worker.onerror = (e) => {
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
