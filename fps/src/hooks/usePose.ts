import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PoseKeypoint } from '@shared/protocol';

export interface UsePoseResult {
  keypoints: PoseKeypoint[] | null;
  imageKeypoints: PoseKeypoint[] | null;
  fps: number;
}

// `requestVideoFrameCallback` types aren't in the lib.dom defaults.
type RvfcVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: DOMHighResTimeStamp) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

// Evaluated lazily inside the loop so test stubs applied after module load are picked up.
function supportsOffscreen() {
  return typeof OffscreenCanvas !== 'undefined';
}

// GPS timing: rolling window of last 10 detect→result latencies
const LATENCY_WINDOW = 10;
const LATENCY_THRESHOLD_MS = 25;

export function usePose(
  videoRef: RefObject<HTMLVideoElement | null>,
  cameraReady: boolean,
  workerRef: React.MutableRefObject<Worker | null>,
): UsePoseResult {
  const [keypoints, setKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [imageKeypoints, setImageKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [fps, setFps] = useState(0);

  // Refs let the rAF loop read current values without stale closures
  const workerBusyRef = useRef(false);
  const detectSentAtRef = useRef<number | null>(null);
  const latencyWindowRef = useRef<number[]>([]);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!cameraReady) return;
    const worker = workerRef.current;
    if (!worker) return;

    let cancelled = false;
    let rafId = 0;
    let rvfcId = 0;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    let captureCanvas: OffscreenCanvas | null = null;
    let captureCtx: OffscreenCanvasRenderingContext2D | null = null;

    const useRvfc =
      typeof HTMLVideoElement !== 'undefined' &&
      'requestVideoFrameCallback' in HTMLVideoElement.prototype;

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
      const w = workerRef.current;

      if (video && w && video.readyState >= 2 && !workerBusyRef.current) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width > 0 && height > 0) {
          if (supportsOffscreen()) {
            try {
              if (!captureCanvas || captureCanvas.width !== width || captureCanvas.height !== height) {
                captureCanvas = new OffscreenCanvas(width, height);
                captureCtx = captureCanvas.getContext('2d');
              }
              if (captureCtx) {
                captureCtx.drawImage(video, 0, 0, width, height);
                const bitmap = captureCanvas.transferToImageBitmap();
                workerBusyRef.current = true;
                detectSentAtRef.current = performance.now();
                w.postMessage(
                  { type: 'detect', bitmap, timestampMs: Math.floor(now) },
                  [bitmap],
                );
              }
            } catch {
              workerBusyRef.current = false;
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

    // Wire onmessage into the provided worker (not a new worker)
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        message?: string;
        worldLandmarks?: PoseKeypoint[] | null;
        landmarks?: PoseKeypoint[] | null;
      };

      if (msg.type === 'result') {
        // Record latency for GPU timing diagnostic
        if (detectSentAtRef.current !== null) {
          const latency = performance.now() - detectSentAtRef.current;
          detectSentAtRef.current = null;
          const window = latencyWindowRef.current;
          window.push(latency);
          if (window.length > LATENCY_WINDOW) {
            window.shift();
          }
          if (window.length >= LATENCY_WINDOW && !warnedRef.current) {
            const avg = window.reduce((a, b) => a + b, 0) / window.length;
            if (avg > LATENCY_THRESHOLD_MS) {
              warnedRef.current = true;
              console.warn(
                `[usePose] GPU fallback detected: average detect→result latency ${avg.toFixed(0)}ms exceeds 25ms threshold`,
              );
            }
          }
        }

        workerBusyRef.current = false;
        if (!cancelled) {
          setKeypoints(msg.worldLandmarks ?? null);
          setImageKeypoints(msg.landmarks ?? null);
        }
      }

      if (msg.type === 'error') {
        workerBusyRef.current = false;
        detectSentAtRef.current = null;
        // surface via console — no modelError state in fps/ usePose
        console.error('[usePose] worker error:', msg.message);
      }
    };

    worker.onerror = () => {
      workerBusyRef.current = false;
      detectSentAtRef.current = null;
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (rvfcId) {
        const video = videoRef.current as RvfcVideoElement | null;
        video?.cancelVideoFrameCallback?.(rvfcId);
      }
      // DO NOT terminate worker — it belongs to useWarmup
    };
  }, [cameraReady, workerRef, videoRef]);

  return { keypoints, imageKeypoints, fps };
}
