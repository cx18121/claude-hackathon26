import { describe, it, expect } from 'vitest';
import { normalizeWindow } from './normalizeWindow';
import type { PoseKeypoint } from '@shared/protocol';

// JOINT_INDICES order: [11, 12, 13, 14, 15, 16, 23, 24]
// Index 0 in extracted array = LEFT_SHOULDER (mp 11)
// Index 1 in extracted array = RIGHT_SHOULDER (mp 12)
const JOINT_INDICES = [11, 12, 13, 14, 15, 16, 23, 24];

function makeFrame(joints: Array<[number, number, number]>): PoseKeypoint[] {
  // Returns a 33-landmark PoseKeypoint array with only the specified 8 joints filled
  const frame: PoseKeypoint[] = Array.from({ length: 33 }, () => ({
    x: 0, y: 0, z: 0, visibility: 1,
  }));
  JOINT_INDICES.forEach((mpIdx, i) => {
    frame[mpIdx] = { x: joints[i][0], y: joints[i][1], z: joints[i][2], visibility: 1 };
  });
  return frame;
}

describe('normalizeWindow', () => {
  const T = 20;
  // LEFT_SHOULDER at x=0.2, RIGHT_SHOULDER at x=0.4, all others at 0
  const sampleJoints: Array<[number, number, number]> = [
    [0.2, 0.0, 0.0],  // LEFT_SHOULDER (idx 0)
    [0.4, 0.0, 0.0],  // RIGHT_SHOULDER (idx 1)
    [0.1, -0.3, 0.0], // LEFT_ELBOW
    [0.5, -0.3, 0.0], // RIGHT_ELBOW
    [0.0, -0.6, 0.0], // LEFT_WRIST
    [0.6, -0.6, 0.0], // RIGHT_WRIST
    [0.2, -0.8, 0.0], // LEFT_HIP
    [0.4, -0.8, 0.0], // RIGHT_HIP
  ];
  const buffer = Array.from({ length: T }, () => makeFrame(sampleJoints));

  it('shoulder midpoint is at origin after normalization', () => {
    const result = normalizeWindow(buffer, JOINT_INDICES);
    const T_out = 20, J = 8, C = 3;
    // LEFT_SHOULDER is j=0, RIGHT_SHOULDER is j=1
    for (let t = 0; t < T_out; t++) {
      const lShX = result[t * J * C + 0 * C + 0];
      const rShX = result[t * J * C + 1 * C + 0];
      expect((lShX + rShX) / 2).toBeCloseTo(0.0, 5);
      const lShY = result[t * J * C + 0 * C + 1];
      const rShY = result[t * J * C + 1 * C + 1];
      expect((lShY + rShY) / 2).toBeCloseTo(0.0, 5);
    }
  });

  it('shoulder width is 1.0 after normalization', () => {
    const result = normalizeWindow(buffer, JOINT_INDICES);
    const J = 8, C = 3;
    for (let t = 0; t < T; t++) {
      const lShX = result[t * J * C + 0 * C + 0];
      const lShY = result[t * J * C + 0 * C + 1];
      const lShZ = result[t * J * C + 0 * C + 2];
      const rShX = result[t * J * C + 1 * C + 0];
      const rShY = result[t * J * C + 1 * C + 1];
      const rShZ = result[t * J * C + 1 * C + 2];
      const width = Math.sqrt((rShX - lShX) ** 2 + (rShY - lShY) ** 2 + (rShZ - lShZ) ** 2);
      expect(width).toBeCloseTo(1.0, 5);
    }
  });
});
