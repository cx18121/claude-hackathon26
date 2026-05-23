import { useRef } from 'react';
import { OneEuroFilter } from '1eurofilter';
import type { PoseKeypoint } from '@shared/protocol';

export function useOneEuroFilter(
  keypoints: PoseKeypoint[] | null,
  freq = 60,
  mincutoff = 1.0,
  beta = 0.007,
  dcutoff = 1.0,
): PoseKeypoint[] | null {
  const filtersRef = useRef<Map<string, OneEuroFilter>>(new Map());
  const lastTsRef = useRef<number>(0);

  if (!keypoints) return null;

  const now = performance.now() / 1000; // seconds
  // Guard: OneEuroFilter requires strictly increasing timestamps
  const ts = now > lastTsRef.current ? now : lastTsRef.current + 1 / freq;
  lastTsRef.current = ts;

  const filters = filtersRef.current;
  return keypoints.map((kp, i) => {
    const result = { ...kp };
    for (const axis of ['x', 'y', 'z'] as const) {
      const key = `${i}_${axis}`;
      if (!filters.has(key)) {
        filters.set(key, new OneEuroFilter(freq, mincutoff, beta, dcutoff));
      }
      (result as Record<string, number>)[axis] =
        filters.get(key)!.filter(kp[axis] as number, ts);
    }
    return result;
  });
}
