import { useEffect, useRef, useState } from 'react';

export type WarmupStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseWarmupResult {
  status: WarmupStatus;
  error: string | null;
  workerRef: React.MutableRefObject<Worker | null>;
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

export function useWarmup(): UseWarmupResult {
  const [status, setStatus] = useState<WarmupStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    setStatus('loading');
    // Classic worker (no { type: 'module' }). MediaPipe's WASM loader uses
    // importScripts to fetch a UMD glue script that sets self.ModuleFactory
    // as a global side effect; importScripts throws TypeError in module
    // workers and the fallback (await self.import(url)) is undefined natively.
    // See the parallel fix in mobile/src/hooks/usePose.ts (commit cdad3e2).
    const worker = new Worker(
      new URL('../workers/pose.worker.ts', import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        setStatus('ready');
      }
      if (e.data.type === 'error') {
        setStatus('error');
        setError(e.data.message as string);
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      setStatus('error');
      setError(e.message);
    };

    worker.postMessage({
      type: 'init',
      wasmUrl: WASM_URL,
      modelUrl: MODEL_URL,
    });

    // CRITICAL: Do NOT return a cleanup that terminates the worker.
    // The worker must stay alive across the warmup→waiting transition
    // so Phase 13 can reuse the initialized PoseLandmarker without
    // re-paying the WASM load cost (~1-2s).
    // Phase 13 will terminate the worker when the game ends.
  }, []);

  return { status, error, workerRef };
}
