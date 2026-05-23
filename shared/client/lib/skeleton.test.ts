import { describe, it, expect } from 'vitest'
import { CONNECTIONS, REGION_KEYPOINTS } from './skeleton'

const MEDIAPIPE_LANDMARK_COUNT = 33

describe('CONNECTIONS', () => {
  it('every index is within MediaPipe landmark range', () => {
    for (const [a, b] of CONNECTIONS) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(MEDIAPIPE_LANDMARK_COUNT)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(MEDIAPIPE_LANDMARK_COUNT)
    }
  })

  it('no self-loops', () => {
    for (const [a, b] of CONNECTIONS) {
      expect(a).not.toBe(b)
    }
  })

  it('has expected count of connections', () => {
    expect(CONNECTIONS.length).toBe(35)
  })
})

describe('REGION_KEYPOINTS', () => {
  it('covers all server region strings', () => {
    const expected = [
      'head_face', 'head_chin', 'head_throat',
      'torso_upper', 'torso_lower',
      'leg_thigh', 'leg_shin',
      'block_hand', 'block_forearm',
    ]
    for (const region of expected) {
      expect(REGION_KEYPOINTS).toHaveProperty(region)
    }
  })

  it('every keypoint index is within MediaPipe landmark range', () => {
    for (const [region, indices] of Object.entries(REGION_KEYPOINTS)) {
      for (const idx of indices) {
        expect(idx, `${region}[${idx}]`).toBeGreaterThanOrEqual(0)
        expect(idx, `${region}[${idx}]`).toBeLessThan(MEDIAPIPE_LANDMARK_COUNT)
      }
    }
  })

  it('each region has at least one keypoint', () => {
    for (const [region, indices] of Object.entries(REGION_KEYPOINTS)) {
      expect(indices.length, region).toBeGreaterThan(0)
    }
  })
})
