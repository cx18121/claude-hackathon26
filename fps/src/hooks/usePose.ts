import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PoseKeypoint } from '@shared/protocol';

export type ModelStatus = 'idle' | 'ready' | 'error';

export interface UsePoseResult {
  keypoints: PoseKeypoint[] | null;
  imageKeypoints: PoseKeypoint[] | null;
  fps: number;
  modelStatus: ModelStatus;
  modelError: string | null;
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

function supportsCreateImageBitmap() {
  return typeof createImageBitmap !== 'undefined';
}

// iOS Safari exposes OffscreenCanvas + transferToImageBitmap, but the
// resulting bitmaps are sometimes 0×0 / unusable depending on iOS version
// and concurrent WebGL state. createImageBitmap(video) is the supported
// iOS path, so prefer it there even when OffscreenCanvas is available.
// UA-sniff is gross but iOS Safari is the only platform with this misshape
// and there is no synchronous feature check that distinguishes a working
// bitmap from an empty one before handing it to MediaPipe.
//
// Ported from mobile/src/hooks/usePose.ts (commit 1fb9c39); without this
// the fps build hits the same iOS Safari frame-capture failure mode.
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as Mac; disambiguate via touch support.
  const maxTouchPoints =
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return navigator.platform === 'MacIntel' && maxTouchPoints > 1;
}

function preferCreateImageBitmap(): boolean {
  return isIOS() && supportsCreateImageBitmap();
}

// GPS timing: rolling window of last 10 detect→result latencies
const LATENCY_WINDOW = 10;

export function usePose(
  videoRef: RefObject<HTMLVideoElement | null>,
  cameraReady: boolean,
  workerRef: React.MutableRefObject<Worker | null>,
): UsePoseResult {
  const [keypoints, setKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [imageKeypoints, setImageKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [fps, setFps] = useState(0);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelError, setModelError] = useState<string | null>(null);

  // One-shot guard so we don't re-set the no-capture error every frame.
  const noCaptureReportedRef = useRef(false);

  // Refs let the rAF loop read current values without stale closures
  const workerBusyRef = useRef(false);
  const detectSentAtRef = useRef<number | null>(null);
  const latencyWindowRef = useRef<number[]>([]);

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
          const useIOSPath = preferCreateImageBitmap();
          if (supportsOffscreen() && !useIOSPath) {
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
          } else if (supportsCreateImageBitmap()) {
            // Async fallback used when OffscreenCanvas is unsupported OR when
            // we're on iOS Safari (which exposes OffscreenCanvas but ships a
            // misshaped transferToImageBitmap implementation under load).
            workerBusyRef.current = true;
            detectSentAtRef.current = performance.now();
            const ts = Math.floor(now);
            createImageBitmap(video).then((bitmap) => {
              const current = workerRef.current;
              if (cancelled || !current) {
                bitmap.close();
                workerBusyRef.current = false;
                detectSentAtRef.current = null;
                return;
              }
              current.postMessage(
                { type: 'detect', bitmap, timestampMs: ts },
                [bitmap],
              );
            }).catch((err: unknown) => {
              workerBusyRef.current = false;
              detectSentAtRef.current = null;
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
            // Neither capture API works — surface as a modelError so the UI
            // can show a real message instead of an indefinite "no pose"
            // loading state. Report once to avoid spamming setState.
            if (!noCaptureReportedRef.current && !cancelled) {
              noCaptureReportedRef.current = true;
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

    // Wire onmessage into the provided worker (not a new worker)
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        message?: string;
        worldLandmarks?: PoseKeypoint[] | null;
        landmarks?: PoseKeypoint[] | null;
      };

      if (msg.type === 'latency_warning') {
        console.warn(
          `[pose.worker] GPU fallback: detectForVideo took ${(msg as unknown as { elapsedMs: number }).elapsedMs.toFixed(0)}ms (threshold 25ms)`,
        );
      }

      if (msg.type === 'result') {
        // Record latency for round-trip diagnostic (retains window for future use)
        if (detectSentAtRef.current !== null) {
          const latency = performance.now() - detectSentAtRef.current;
          detectSentAtRef.current = null;
          const window = latencyWindowRef.current;
          window.push(latency);
          if (window.length > LATENCY_WINDOW) {
            window.shift();
          }
        }

        workerBusyRef.current = false;
        if (!cancelled) {
          setKeypoints(msg.worldLandmarks ?? null);
          setImageKeypoints(msg.landmarks ?? null);
          setModelStatus((prev) => (prev === 'error' ? prev : 'ready'));
        }
      }

      if (msg.type === 'error') {
        workerBusyRef.current = false;
        detectSentAtRef.current = null;
        // surface to UI as modelError and log
        console.error('[usePose] worker error:', msg.message);
        if (!cancelled) {
          setModelStatus('error');
          setModelError(msg.message ?? 'Pose worker error');
        }
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

  return { keypoints, imageKeypoints, fps, modelStatus, modelError };
}
