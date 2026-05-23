import { useEffect, useRef, useState } from 'react';
import * as ort from 'onnxruntime-web';
import type { PoseKeypoint } from '@shared/protocol';
import { normalizeWindow } from '../lib/normalizeWindow';
import { computeWristPeakSpeed, LANDMARK } from '@shared/client/velocity';
import type { TimedFrame } from '@shared/client/velocity';

// Set WASM CDN path once at module init (per D5: CDN approach for Phase 13.1).
// This must happen before any InferenceSession.create call.
// Production: replace with self-hosted '/ort/' path if offline play is required.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';

// 5 punch classes in the order the model was trained on (MUST match CLASSES in train.py)
export type PunchType = 'jab' | 'cross' | 'hook_l' | 'hook_r' | 'guard';
const LABELS: PunchType[] = ['jab', 'cross', 'hook_l', 'hook_r', 'guard'];

// MediaPipe joint indices used for inference (MUST match JOINT_INDICES in train.py)
const JOINT_INDICES = [
  LANDMARK.LEFT_SHOULDER,  // 11
  LANDMARK.RIGHT_SHOULDER, // 12
  LANDMARK.LEFT_ELBOW,     // 13
  LANDMARK.RIGHT_ELBOW,    // 14
  LANDMARK.LEFT_WRIST,     // 15
  LANDMARK.RIGHT_WRIST,    // 16
  LANDMARK.LEFT_HIP,       // 23
  LANDMARK.RIGHT_HIP,      // 24
];

const WINDOW_SIZE = 20;             // T=20 frames (667ms at 30fps, per D3)
const CONFIDENCE_THRESHOLD = 0.7;  // per D9

export interface PunchClassifierResult {
  type: PunchType | null;
  confidence: number;
  speed: number; // wrist speed in m/s (from computeWristPeakSpeed, not model output — per D8)
}

// MsgPunchDetected is defined here (not in shared/protocol.ts) because
// shared/protocol.ts is auto-generated from Rust and would overwrite this. (per D7)
export interface MsgPunchDetected {
  type: 'punch_detected';
  punch_type: PunchType;
  confidence: number;
  speed: number;
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...Array.from(logits));
  const exps = Array.from(logits).map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

export function usePunchClassifier(
  keypoints: PoseKeypoint[] | null,
): PunchClassifierResult {
  const sessionRef = useRef<ort.InferenceSession | null>(null);
  const bufferRef = useRef<PoseKeypoint[][]>([]);
  const timedBufferRef = useRef<TimedFrame[]>([]);
  const [result, setResult] = useState<PunchClassifierResult>({
    type: null,
    confidence: 0,
    speed: 0,
  });

  // Load model once at mount (per C4: session creation is expensive, never recreate)
  useEffect(() => {
    let cancelled = false;
    async function loadModel() {
      try {
        const session = await ort.InferenceSession.create(
          '/models/punch_classifier_int8.onnx',
          { executionProviders: ['wasm'] },
        );
        if (!cancelled) {
          sessionRef.current = session;
        }
      } catch (err) {
        console.error('[usePunchClassifier] model load failed:', err);
      }
    }
    loadModel();
    return () => {
      cancelled = true;
    };
  }, []);

  // Run inference on each new frame
  useEffect(() => {
    if (!keypoints || !sessionRef.current) return;

    const now = performance.now();

    // Update ring buffer (per C4 pattern: shift() is O(n) but n=20, negligible)
    bufferRef.current.push(keypoints);
    if (bufferRef.current.length > WINDOW_SIZE) {
      bufferRef.current.shift();
    }
    timedBufferRef.current.push({ keypoints, t: now });
    if (timedBufferRef.current.length > WINDOW_SIZE) {
      timedBufferRef.current.shift();
    }

    // Wait for full window before running inference (buffer warm-up period)
    if (bufferRef.current.length < WINDOW_SIZE) return;

    const session = sessionRef.current;
    const windowSnapshot = [...bufferRef.current];
    const timedSnapshot = [...timedBufferRef.current];

    // Normalize window (shoulder-midpoint origin, shoulder-width scale — per D4)
    const normalizedData = normalizeWindow(windowSnapshot, JOINT_INDICES);
    const tensor = new ort.Tensor('float32', normalizedData, [1, WINDOW_SIZE, JOINT_INDICES.length, 3]);

    session.run({ input: tensor }).then((output) => {
      const logits = output.logits.data as Float32Array;
      const probs = softmax(logits);
      const maxIdx = probs.indexOf(Math.max(...probs));
      const confidence = probs[maxIdx];

      // Compute wrist speed from the timed ring buffer (per D8: not a model output)
      const speed = Math.max(
        computeWristPeakSpeed(timedSnapshot, 'left'),
        computeWristPeakSpeed(timedSnapshot, 'right'),
      );

      setResult({
        type: confidence >= CONFIDENCE_THRESHOLD ? LABELS[maxIdx] : null,
        confidence,
        speed,
      });
    }).catch(() => {
      // Silent fail: session may be mid-load or model is placeholder — do not update state
    });
  }, [keypoints]);

  return result;
}
