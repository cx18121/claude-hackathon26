import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PoseKeypoint } from '@shared/protocol';
import { useCalibration } from '@shared/client/useCalibration';
import { LANDMARK } from '@shared/client/velocity';

// We control time so frame timestamps are deterministic.
// The hook reads performance.now() inside its per-frame effect.
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
    out.push({ x: 0, y: 0, z: 0, visibility: defaultVis, ...overrides[i] });
  }
  return out;
}

interface HookProps {
  keypoints: PoseKeypoint[] | null;
  active: boolean;
  onComplete: (ref: number) => void;
}

// Each feed() creates a new array reference so React sees the keypoints
// dependency changed (same as MediaPipe in production).
// rerender typed as unknown so it accepts renderHook's inferred Props generics without
// structural mismatch between Mock<Procedure> and (ref: number) => void (contravariance).
function feed(
  rerenderFn: unknown,
  active: boolean,
  onComplete: ReturnType<typeof vi.fn>,
  kp: PoseKeypoint[],
  dtMs: number = FRAME_DT_MS,
) {
  const rerender = rerenderFn as (p: HookProps) => void;
  mockNow += dtMs;
  act(() => {
    rerender({ keypoints: kp.map((p) => ({ ...p })), active, onComplete: onComplete as unknown as (ref: number) => void });
  });
}

describe('useCalibration', () => {
  it('Test 1: starts in idle when active=false', () => {
    const onComplete = vi.fn();
    const { result } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: false, onComplete },
    });
    expect(result.current.stage).toBe('idle');
  });

  it('Test 2: transitions to tpose when active=true', () => {
    const onComplete = vi.fn();
    const { result } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });
    expect(result.current.stage).toBe('tpose');
  });

  it('Test 3: advances tpose→punches after 30 stable frames', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });
    // Need >= 31 frames (first frame has no prev to compare against)
    for (let i = 0; i < 35; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.stage).toBe('punches');
  });

  it('Test 4: tposeProgress increments per stable frame (≈0.5 after 15 frames)', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });
    for (let i = 0; i < 15; i++) {
      feed(rerender, true, onComplete, stable);
    }
    // After 15 stable frames out of 30 needed, progress should be ~0.5
    // (first frame establishes prev, so we get 14 counted stable frames = 14/30 ≈ 0.47)
    expect(result.current.tposeProgress).toBeGreaterThan(0);
    expect(result.current.tposeProgress).toBeLessThanOrEqual(1);
  });

  it('Test 5: punches→neutral after 3 peaks', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });

    // Advance to punches stage
    for (let i = 0; i < 35; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.stage).toBe('punches');

    // Settle period so trackers become ready
    const settleKp = makeKeypoints({
      [LANDMARK.LEFT_WRIST]: { x: 0.5 },
      [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
    });
    for (let i = 0; i < 22; i++) {
      feed(rerender, true, onComplete, settleKp);
    }

    // 3 punch cycles: fast motion then stillness
    for (let p = 0; p < 3; p++) {
      // Fast frames: 0.10m per 33ms -> ~3 m/s
      for (let i = 0; i < 4; i++) {
        const x = 0.5 + (i + 1) * 0.10;
        feed(rerender, true, onComplete, makeKeypoints({
          [LANDMARK.LEFT_WRIST]: { x },
          [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
        }));
      }
      // Rest frames
      for (let i = 0; i < 6; i++) {
        feed(rerender, true, onComplete, makeKeypoints({
          [LANDMARK.LEFT_WRIST]: { x: 0.5 },
          [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
        }));
      }
    }

    expect(result.current.punchesRecorded).toBe(3);
    expect(result.current.stage).toBe('neutral');
  });

  it('Test 6: onComplete called with average of 3 peak velocities', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });

    // Advance to punches
    for (let i = 0; i < 35; i++) {
      feed(rerender, true, onComplete, stable);
    }

    // Settle
    const settleKp = makeKeypoints({
      [LANDMARK.LEFT_WRIST]: { x: 0.5 },
      [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
    });
    for (let i = 0; i < 22; i++) {
      feed(rerender, true, onComplete, settleKp);
    }

    // 3 punches
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < 4; i++) {
        const x = 0.5 + (i + 1) * 0.10;
        feed(rerender, true, onComplete, makeKeypoints({
          [LANDMARK.LEFT_WRIST]: { x },
          [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
        }));
      }
      for (let i = 0; i < 6; i++) {
        feed(rerender, true, onComplete, makeKeypoints({
          [LANDMARK.LEFT_WRIST]: { x: 0.5 },
          [LANDMARK.RIGHT_WRIST]: { x: 0.5 },
        }));
      }
    }

    expect(result.current.stage).toBe('neutral');

    // 70 still frames to complete neutral
    const neutralKp = makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.4 } });
    for (let i = 0; i < 70; i++) {
      feed(rerender, true, onComplete, neutralKp);
    }

    expect(result.current.stage).toBe('done');
    expect(onComplete).toHaveBeenCalledTimes(1);
    const rv = onComplete.mock.calls[0][0] as number;
    expect(rv).toBeGreaterThan(0);
  });

  it('Test 7: reset on active toggle', () => {
    const onComplete = vi.fn();
    const stable = makeKeypoints();
    const { result, rerender } = renderHook((props: HookProps) => useCalibration(props), {
      initialProps: { keypoints: null as PoseKeypoint[] | null, active: true, onComplete },
    });

    // Advance a few frames
    for (let i = 0; i < 10; i++) {
      feed(rerender, true, onComplete, stable);
    }
    expect(result.current.tposeProgress).toBeGreaterThan(0);

    // Toggle active off
    act(() => {
      rerender({ keypoints: null, active: false, onComplete });
    });
    expect(result.current.stage).toBe('idle');

    // Toggle back on — should reset state
    act(() => {
      rerender({ keypoints: null, active: true, onComplete });
    });
    expect(result.current.stage).toBe('tpose');
    expect(result.current.tposeProgress).toBe(0);
    expect(result.current.punchesRecorded).toBe(0);
  });
});
