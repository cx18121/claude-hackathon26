import { describe, it, expect } from 'vitest';
import {
  computeWristVelocity,
  smoothKeypoints,
  LANDMARK,
  type TimedFrame,
} from './velocity';
import type { PoseKeypoint } from '../protocol';

function makeKeypoints(overrides: Partial<Record<number, Partial<PoseKeypoint>>> = {}): PoseKeypoint[] {
  // 33 default keypoints, all at origin with full visibility.
  const out: PoseKeypoint[] = [];
  for (let i = 0; i < 33; i++) {
    out.push({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1.0,
      ...overrides[i],
    });
  }
  return out;
}

function makeFrame(t: number, kp: PoseKeypoint[]): TimedFrame {
  return { t, keypoints: kp };
}

describe('computeWristVelocity', () => {
  it('returns 0 when fewer than 3 frames are available', () => {
    expect(computeWristVelocity([], 'left')).toBe(0);
    expect(
      computeWristVelocity([makeFrame(0, makeKeypoints())], 'left'),
    ).toBe(0);
    expect(
      computeWristVelocity(
        [makeFrame(0, makeKeypoints()), makeFrame(33, makeKeypoints())],
        'left',
      ),
    ).toBe(0);
  });

  it('returns 0 when timestamps do not advance', () => {
    const kp = makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0 } });
    const kpMoved = makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 1 } });
    expect(
      computeWristVelocity(
        [makeFrame(50, kp), makeFrame(50, kp), makeFrame(50, kpMoved)],
        'left',
      ),
    ).toBe(0);
  });

  it('computes magnitude in m/s using real frame timestamps', () => {
    // Wrist moves 0.6 meters in x over 200ms -> 3.0 m/s
    const f0 = makeFrame(
      0,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0 } }),
    );
    const f1 = makeFrame(
      100,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.3 } }),
    );
    const f2 = makeFrame(
      200,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.6 } }),
    );
    const v = computeWristVelocity([f0, f1, f2], 'left');
    expect(v).toBeCloseTo(3.0, 5);
  });

  it('does not assume 30fps -- frame rate drop must NOT inflate velocity', () => {
    // Wrist moves 0.6m in 400ms (slow phone) -> 1.5 m/s
    // If the function (incorrectly) used a hardcoded 1/30s dt for 2 intervals,
    // it would compute 0.6 / (2/30) = 9.0 m/s.
    const f0 = makeFrame(
      0,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0 } }),
    );
    const f1 = makeFrame(
      200,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.3 } }),
    );
    const f2 = makeFrame(
      400,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0.6 } }),
    );
    const v = computeWristVelocity([f0, f1, f2], 'left');
    expect(v).toBeCloseTo(1.5, 5);
    expect(v).toBeLessThan(2.0);
  });

  it('selects the right wrist landmark when wrist=right', () => {
    const f0 = makeFrame(
      0,
      makeKeypoints({ [LANDMARK.RIGHT_WRIST]: { x: 0 } }),
    );
    const f1 = makeFrame(
      33,
      makeKeypoints({ [LANDMARK.RIGHT_WRIST]: { x: 0.05 } }),
    );
    const f2 = makeFrame(
      66,
      makeKeypoints({ [LANDMARK.RIGHT_WRIST]: { x: 0.10 } }),
    );
    const right = computeWristVelocity([f0, f1, f2], 'right');
    const left = computeWristVelocity([f0, f1, f2], 'left');
    expect(right).toBeGreaterThan(0);
    expect(left).toBe(0);
  });

  it('uses 3D Euclidean distance, not just one axis', () => {
    // Move 3-4-0 along x-y -> distance 5
    const f0 = makeFrame(
      0,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 0, y: 0, z: 0 } }),
    );
    const f1 = makeFrame(50, makeKeypoints());
    const f2 = makeFrame(
      100,
      makeKeypoints({ [LANDMARK.LEFT_WRIST]: { x: 3, y: 4, z: 0 } }),
    );
    const v = computeWristVelocity([f0, f1, f2], 'left');
    // 5m / 0.1s = 50 m/s
    expect(v).toBeCloseTo(50, 5);
  });
});

describe('smoothKeypoints', () => {
  it('returns curr unchanged when prev is null', () => {
    const curr = makeKeypoints({ 0: { x: 1 } });
    const out = smoothKeypoints(null, curr);
    expect(out).toBe(curr);
  });

  it('returns curr unchanged when array lengths differ', () => {
    const prev = makeKeypoints();
    const curr = prev.slice(0, 30);
    const out = smoothKeypoints(prev, curr);
    expect(out).toBe(curr);
  });

  it('blends prev and curr by alpha (0.5)', () => {
    const prev = makeKeypoints({ 0: { x: 0 } });
    const curr = makeKeypoints({ 0: { x: 1 } });
    const out = smoothKeypoints(prev, curr, 0.5);
    expect(out[0].x).toBeCloseTo(0.5, 6);
  });

  it('alpha=1 yields curr; alpha=0 yields prev coords with curr visibility', () => {
    const prev = makeKeypoints({
      0: { x: 0, y: 0, z: 0, visibility: 0.2 },
    });
    const curr = makeKeypoints({
      0: { x: 10, y: 20, z: 30, visibility: 0.95 },
    });
    const a1 = smoothKeypoints(prev, curr, 1);
    expect(a1[0].x).toBe(10);
    expect(a1[0].y).toBe(20);
    expect(a1[0].z).toBe(30);
    expect(a1[0].visibility).toBe(0.95);

    const a0 = smoothKeypoints(prev, curr, 0);
    expect(a0[0].x).toBe(0);
    expect(a0[0].y).toBe(0);
    expect(a0[0].z).toBe(0);
    // Visibility always passes through from curr (we don't smooth confidence).
    expect(a0[0].visibility).toBe(0.95);
  });
});
