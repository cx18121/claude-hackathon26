import { describe, it, expect } from 'vitest';
import type { PoseKeypoint } from '@shared/protocol';
import {
  computeWristVelocity,
  computeWristPeakSpeed,
  LANDMARK,
  type TimedFrame,
} from './velocity';

function makeFrame(leftWristX: number, rightWristX: number, t: number): TimedFrame {
  const kps = new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  kps[LANDMARK.LEFT_WRIST] = { x: leftWristX, y: 0, z: 0, visibility: 1 };
  kps[LANDMARK.RIGHT_WRIST] = { x: rightWristX, y: 0, z: 0, visibility: 1 };
  return { keypoints: kps as PoseKeypoint[], t };
}

describe('velocity', () => {
  describe('computeWristVelocity', () => {
    it('Test 1: returns 0 with fewer than 3 frames', () => {
      const frames: TimedFrame[] = [
        makeFrame(0.0, 0.0, 0),
        makeFrame(0.1, 0.0, 50),
      ];
      expect(computeWristVelocity(frames, 'left')).toBe(0);
    });

    it('Test 2: computes wrist velocity correctly', () => {
      // Wrist moves 0.3m in 100ms → 3.0 m/s
      const frames: TimedFrame[] = [
        makeFrame(0.0, 0.0, 0),
        makeFrame(0.15, 0.0, 50),
        makeFrame(0.3, 0.0, 100),
      ];
      expect(computeWristVelocity(frames, 'left')).toBeCloseTo(3.0, 1);
    });
  });

  describe('computeWristPeakSpeed', () => {
    it('Test 3: returns 0 with fewer than 2 frames', () => {
      const frames: TimedFrame[] = [
        makeFrame(0.0, 0.0, 0),
      ];
      expect(computeWristPeakSpeed(frames, 'left')).toBe(0);
    });

    it('Test 4: finds max speed over consecutive pairs', () => {
      // Pair 1-2: wrist moves 0.1m in 50ms → 2.0 m/s
      // Pair 2-3: wrist moves 0.2m in 50ms → 4.0 m/s
      const frames: TimedFrame[] = [
        makeFrame(0.0, 0.0, 0),
        makeFrame(0.1, 0.0, 50),
        makeFrame(0.3, 0.0, 100),
      ];
      expect(computeWristPeakSpeed(frames, 'left')).toBeCloseTo(4.0, 1);
    });
  });

  describe('LANDMARK constants', () => {
    it('Test 5: LANDMARK constants exist with correct values', () => {
      expect(LANDMARK.LEFT_WRIST).toBe(15);
      expect(LANDMARK.RIGHT_WRIST).toBe(16);
      expect(LANDMARK.LEFT_SHOULDER).toBe(11);
    });
  });

  describe('TimedFrame type', () => {
    it('Test 6: TimedFrame type can be constructed with keypoints and t fields', () => {
      const kps: PoseKeypoint[] = [{ x: 0, y: 0, z: 0, visibility: 1 }];
      const frame: TimedFrame = { keypoints: kps, t: performance.now() };
      expect(frame.keypoints).toBe(kps);
      expect(typeof frame.t).toBe('number');
    });
  });
});
