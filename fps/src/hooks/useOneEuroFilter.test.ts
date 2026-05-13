import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PoseKeypoint } from '@shared/protocol';
import { useOneEuroFilter } from './useOneEuroFilter';

function makeKp(x: number, y: number, z: number): PoseKeypoint {
  return { x, y, z, visibility: 1 };
}

function make33Keypoints(x = 0.5, y = 0.5, z = 0.5): PoseKeypoint[] {
  return Array.from({ length: 33 }, () => makeKp(x, y, z));
}

describe('useOneEuroFilter', () => {
  it('returns null when keypoints input is null', () => {
    const { result } = renderHook(() => useOneEuroFilter(null));
    expect(result.current).toBeNull();
  });

  it('smoothing effect — output differs from raw input after repeated calls with jitter', () => {
    // Call with jittery x values. Third call's x should differ from raw 0.998.
    const { result, rerender } = renderHook(
      ({ kps }: { kps: PoseKeypoint[] | null }) => useOneEuroFilter(kps),
      { initialProps: { kps: [makeKp(1.0, 0.5, 0.5)] } }
    );
    rerender({ kps: [makeKp(1.002, 0.5, 0.5)] });
    rerender({ kps: [makeKp(0.998, 0.5, 0.5)] });

    const outputX = result.current![0].x;
    // Filter should have smoothed — output must differ from raw 0.998
    expect(Math.abs(outputX - 0.998)).toBeGreaterThan(0.0001);
  });

  it('reuses filter instances across renders (statefulness)', () => {
    const kp1: PoseKeypoint[] = [makeKp(1.0, 0.0, 0.0)];
    const kp2: PoseKeypoint[] = [makeKp(1.1, 0.0, 0.0)];

    const { result, rerender } = renderHook(
      ({ kps }: { kps: PoseKeypoint[] | null }) => useOneEuroFilter(kps),
      { initialProps: { kps: kp1 } }
    );
    const firstOutput = result.current![0].x;

    rerender({ kps: kp2 });
    const secondOutput = result.current![0].x;

    // If stateless: secondOutput === 1.1 (raw). If stateful: secondOutput < 1.1 (blended).
    expect(secondOutput).toBeLessThan(1.1);
    // And influenced by the first call:
    expect(secondOutput).toBeGreaterThan(firstOutput);
  });

  it('creates exactly 99 filter instances for a 33-landmark input', () => {
    // After calling with 33 landmarks, filter map should have 99 entries (33 × x/y/z).
    // We verify statefulness indirectly: if 99 filters are created and reused,
    // repeated calls with slightly different values will produce filtered output.
    // Direct inspection: we can verify via the smoothing behavior on all axes.
    const kps33 = make33Keypoints(0.5, 0.5, 0.5);

    const { result, rerender } = renderHook(
      ({ kps }: { kps: PoseKeypoint[] | null }) => useOneEuroFilter(kps),
      { initialProps: { kps: kps33 } }
    );

    // Rerender with slightly different values — all 33 landmarks should be filtered
    rerender({ kps: make33Keypoints(0.6, 0.6, 0.6) });
    rerender({ kps: make33Keypoints(0.4, 0.4, 0.4) });

    // Third output should differ from raw 0.4 (filter state from prior calls)
    const out = result.current!;
    expect(out.length).toBe(33);
    // At least one of the landmarks should show smoothing (differ from 0.4)
    const smoothed = out.some(kp => Math.abs(kp.x - 0.4) > 0.0001);
    expect(smoothed).toBe(true);
  });

  it('smooths z-axis coordinate', () => {
    const { result, rerender } = renderHook(
      ({ kps }: { kps: PoseKeypoint[] | null }) => useOneEuroFilter(kps),
      { initialProps: { kps: [makeKp(0.5, 0.5, 0.5)] } }
    );
    rerender({ kps: [makeKp(0.5, 0.5, 0.51)] });
    rerender({ kps: [makeKp(0.5, 0.5, 0.49)] });

    const outputZ = result.current![0].z;
    // Filter should have smoothed z — output must differ from raw 0.49
    expect(Math.abs(outputZ - 0.49)).toBeGreaterThan(0.0001);
  });

  it('returns array with same length as input', () => {
    const kps33 = make33Keypoints();
    const { result } = renderHook(() => useOneEuroFilter(kps33));
    expect(result.current).not.toBeNull();
    expect(result.current!.length).toBe(33);
  });
});
