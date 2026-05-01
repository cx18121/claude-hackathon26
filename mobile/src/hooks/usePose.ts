import { useEffect, useState, type RefObject } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseKeypoint } from '@shared/protocol';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UsePoseResult {
  keypoints: PoseKeypoint[] | null;
  imageKeypoints: PoseKeypoint[] | null;
  fps: number;
  modelStatus: ModelStatus;
  modelError: string | null;
}

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

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

  useEffect(() => {
    if (!cameraReady) return;

    let landmarker: PoseLandmarker | null = null;
    let rafId = 0;
    let rvfcId = 0;
    let cancelled = false;
    let frameCount = 0;
    let fpsWindowStart = performance.now();
    let lastTimestampMs = 0;

    // Drive the loop from camera-frame commits (when supported) instead of
    // display refresh — fires the moment a fresh frame is available, not
    // up to 16ms later. Falls back to rAF on older browsers.
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
      if (video && landmarker && video.readyState >= 2) {
        // detectForVideo requires monotonically increasing timestamps.
        let timestampMs = Math.floor(now);
        if (timestampMs <= lastTimestampMs) timestampMs = lastTimestampMs + 1;
        lastTimestampMs = timestampMs;
        try {
          const result = landmarker.detectForVideo(video, timestampMs);
          if (result?.worldLandmarks?.[0]) {
            const raw: PoseKeypoint[] = result.worldLandmarks[0].map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 0,
            }));
            // No EMA smoothing on mobile — overlay extrapolation handles it
            // and the smoothing was just one extra frame of lag for fast
            // motion (punches).
            setKeypoints(raw);
          }
          if (result?.landmarks?.[0]) {
            const imgKps: PoseKeypoint[] = result.landmarks[0].map((lm) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z ?? 0,
              visibility: lm.visibility ?? 0,
            }));
            setImageKeypoints(imgKps);
          }

          frameCount += 1;
          const elapsed = performance.now() - fpsWindowStart;
          if (elapsed >= 1000) {
            setFps(Math.round((frameCount * 1000) / elapsed));
            frameCount = 0;
            fpsWindowStart = performance.now();
          }
        } catch {
          /* MediaPipe occasionally throws on video tear-down; ignore one frame */
        }
      }
      scheduleNext();
    }

    async function init() {
      setModelStatus('loading');
      setModelError(null);
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (cancelled) {
          lm.close();
          return;
        }
        landmarker = lm;
        setModelStatus('ready');
        scheduleNext();
      } catch (err) {
        if (cancelled) return;
        setModelStatus('error');
        setModelError(err instanceof Error ? err.message : String(err));
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (rvfcId) {
        const video = videoRef.current as RvfcVideoElement | null;
        if (video?.cancelVideoFrameCallback) {
          video.cancelVideoFrameCallback(rvfcId);
        }
      }
      if (landmarker) landmarker.close();
    };
  }, [cameraReady, videoRef]);

  return { keypoints, imageKeypoints, fps, modelStatus, modelError };
}
