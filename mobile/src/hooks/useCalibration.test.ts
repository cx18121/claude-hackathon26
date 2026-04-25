import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCalibration } from './useCalibration';
import type { PoseKeypoint } from '../protocol';
import { LANDMARK } from '../lib/velocity';

// We control time so frame timestamps are deterministic. The hook reads
// performance.now() inside its per-frame effect.
let mockNow = 0;
const FRAME_DT_MS = 33; // ~30fps

beforeEach(() => {
  mockNow = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeKeypoints(
  overrides: Partial<Record<number, Partial<PoseKeypoint>>> = {},
  defaultVis = 1.0,
): PoseKeypoint[] {
  const out: PoseKeypoint[] = [];
  for (let i = 0; i < 33; i++) {
    out.push({
      x: 0,
      y: 0,
      z: 0,
      visibility: defaultVis,
      ...overrides[i],
    });
  }
  return out;
}

interface HookProps {
  keypoints: PoseKeypoint[] | null;
  active: boolean;
  onComplete: (ref: number) => void;
}

function renderCalibration(initial: HookProps) {
  return renderHook((props: HookProps) => useCalibration(props), {
    initialProps: initial,
  });
}

// Each feed() must produce a NEW array reference so React sees the keypoints
// dependency changed (same as MediaPipe in production -- it allocates a new
// array per frame). Reusing a single object across rerenders short-circuits
// the per-frame effect via Object.is.
function feed(
  rerender: (p: HookProps) => void,
  active: boolean,
  onComplete: (ref: number) => void,
  kp: PoseKeypoint[],
  dtMs: number = FRAME_DT_MS,
) {
  mockNow += dtMs;
  act(() => {
    rerender({ keypoints: kp.map((p) => ({ ...p })), active, onComplete });
  });
}

describe('useCalibration -- lifecycle', () => {
  it('starts in idle when active is false', () => {
    const onComplete = vi.fn();
    const { result } = renderCalibration({
      keypoints: null,
      active: false,
      onComplete,
    });
    expect(result.current.stage).toBe('idle');
    expect(result.current.punchesRecorded).toBe(0);
    expect(result.current.referenceVelocity).toBeNull();
  });

  it('transitions to tpose when active flips to true', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: false,
      onComplete,
    });
    act(() => {
      rerender({ keypoints: null, active: true, onComplete });
    });
    expect(result.current.stage).toBe('tpose');
  });

  it('returns to idle when active flips back to false', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });
    expect(result.current.stage).toBe('tpose');
    act(() => {
      rerender({ keypoints: null, active: false, onComplete });
    });
    expect(result.current.stage).toBe('idle');
  });
});

describe('useCalibration -- T-pose progression', () => {
  it('increments tposeProgress with stable visible frames', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });
    // Feed identical stable frames; need at least 2 frames to compute
    // stillness (uses prev frame).
    for (let i = 0; i < 10; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.stage).toBe('tpose');
    expect(result.current.tposeProgress).toBeGreaterThan(0);
    expect(result.current.tposeProgress).toBeLessThanOrEqual(1);
  });

  it('does not advance T-pose progress when key landmarks are occluded', () => {
    const onComplete = vi.fn();
    const occluded = makeKeypoints({}, 0.1); // visibility below 0.5 everywhere
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });
    for (let i = 0; i < 10; i++) {
      feed(rerender, true, onComplete, occluded);
    }
    expect(result.current.tposeProgress).toBe(0);
  });

  it('completes T-pose after 30 stable frames and advances to punches', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });
    // Need >= 31 frames (first frame has no prev to compare against).
    for (let i = 0; i < 35; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.stage).toBe('punches');
  });
});

describe('useCalibration -- full happy path', () => {
  it('progresses tpose -> punches -> neutral -> done and reports a reference velocity', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });

    // ---- T-pose stage: 35 stable frames
    for (let i = 0; i < 35; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.stage).toBe('punches');

    // ---- Punches: 3 peaks
    // Each peak: 4 frames of fast wrist motion, then 4 frames of stillness
    // Wrist motion: 0.10m per 33ms -> ~3 m/s velocity (well above 1.5 threshold)
    for (let p = 0; p < 3; p++) {
      // Motion frames
      for (let i = 0; i < 4; i++) {
        const x = (i + 1) * 0.10;
        const kp = makeKeypoints({
          [LANDMARK.LEFT_WRIST]: { x },
          [LANDMARK.RIGHT_WRIST]: { x: 0 },
        });
        feed(rerender, true, onComplete, kp);
      }
      // Stillness frames so velocity drops below 0.8 and the peak completes
      const restKp = makeKeypoints({
        [LANDMARK.LEFT_WRIST]: { x: 0.4 },
      });
      for (let i = 0; i < 6; i++) {
        feed(rerender, true, onComplete, restKp);
      }
    }
    expect(result.current.stage).toBe('neutral');
    expect(result.current.punchesRecorded).toBe(3);

    // ---- Neutral: 60+ still frames
    const neutralKp = makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.4 } });
    for (let i = 0; i < 70; i++) {
      feed(rerender, true, onComplete, neutralKp);
    }

    expect(result.current.stage).toBe('done');
    expect(result.current.referenceVelocity).toBeGreaterThan(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(result.current.referenceVelocity);
  });

  it('clears state when active flips back off mid-calibration', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderCalibration({
      keypoints: null,
      active: true,
      onComplete,
    });
    for (let i = 0; i < 10; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.tposeProgress).toBeGreaterThan(0);

    act(() => {
      rerender({ keypoints: null, active: false, onComplete });
    });
    expect(result.current.stage).toBe('idle');

    // Re-entering should restart from a clean tpose stage at progress 0
    act(() => {
      rerender({ keypoints: null, active: true, onComplete });
    });
    expect(result.current.stage).toBe('tpose');
    expect(result.current.tposeProgress).toBe(0);
    expect(result.current.punchesRecorded).toBe(0);
  });
});
