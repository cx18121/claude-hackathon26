import type { PoseKeypoint } from '@shared/protocol';

export interface TimedFrame {
  keypoints: PoseKeypoint[];
  t: number; // capture timestamp in ms (performance.now())
}

export const LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function distance(a: PoseKeypoint, b: PoseKeypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Wrist velocity in m/s, computed from the oldest and newest of the last 3 frames.
// Uses real elapsed time between captures so a phone running below 30fps does
// not over-report velocity.
export function computeWristVelocity(
  frames: TimedFrame[],
  wrist: 'left' | 'right',
): number {
  if (frames.length < 3) return 0;
  const idx = wrist === 'left' ? LANDMARK.LEFT_WRIST : LANDMARK.RIGHT_WRIST;
  const dtMs = frames[2].t - frames[0].t;
  if (dtMs <= 0) return 0;
  const dtSec = dtMs / 1000;
  const dist = distance(frames[2].keypoints[idx], frames[0].keypoints[idx]);
  return dist / dtSec;
}

// Max speed across consecutive frame pairs in the window.
// computeWristVelocity uses oldest→newest and underreports when the wrist
// peaks mid-window and has already started retracting by the last frame.
// This function checks every pair so the true peak is captured.
export function computeWristPeakSpeed(
  frames: TimedFrame[],
  wrist: 'left' | 'right',
): number {
  if (frames.length < 2) return 0;
  const idx = wrist === 'left' ? LANDMARK.LEFT_WRIST : LANDMARK.RIGHT_WRIST;
  let best = 0;
  for (let i = 0; i < frames.length - 1; i++) {
    const dtMs = frames[i + 1].t - frames[i].t;
    if (dtMs <= 0) continue;
    const d = distance(frames[i].keypoints[idx], frames[i + 1].keypoints[idx]);
    const v = d / (dtMs / 1000);
    if (v > best) best = v;
  }
  return best;
}

// EMA smoothing per landmark. Used on the mobile sender to reduce MediaPipe
// jitter (especially on z) before frames hit the wire.
export function smoothKeypoints(
  prev: PoseKeypoint[] | null,
  curr: PoseKeypoint[],
  alpha = 0.5,
): PoseKeypoint[] {
  if (!prev || prev.length !== curr.length) return curr;
  const out: PoseKeypoint[] = new Array(curr.length);
  const k = 1 - alpha;
  for (let i = 0; i < curr.length; i++) {
    const p = prev[i];
    const c = curr[i];
    out[i] = {
      x: p.x * k + c.x * alpha,
      y: p.y * k + c.y * alpha,
      z: p.z * k + c.z * alpha,
      visibility: c.visibility,
    };
  }
  return out;
}
