import type { PoseKeypoint } from '@shared/protocol';
import * as THREE from 'three';

/**
 * Scale factor applied to all arm keypoints to fill the viewport.
 * Start at 2.5 per A3 (RESEARCH.md). Tune against live webcam if arms appear too small/large.
 */
export const WORLD_SCALE = 2.5;

/**
 * Convert a MediaPipe worldLandmark keypoint to a Three.js world-space Vector3.
 *
 * Coordinate mapping:
 *   threeX = -mediapipeX  (flip X: MediaPipe left = Three.js right for first-person laterality)
 *   threeY = -mediapipeY  (Y sign verified: MediaPipe worldLandmarks Y is positive-down per the
 *                          MediaPipe coordinate system; negation maps it to Three.js positive-up
 *                          convention so keypoints above the hip origin (head, shoulders) render
 *                          above the world origin as expected — Plan 14-01b Task 2 spike A)
 *   threeZ = -mediapipeZ  (MediaPipe +Z toward camera → Three.js -Z into scene)
 *
 * @param kp - MediaPipe worldLandmarks keypoint (metric, hip-midpoint origin)
 * @param scale - world scale multiplier (default: WORLD_SCALE)
 */
export function keypointToWorld(kp: PoseKeypoint, scale = 1.0): THREE.Vector3 {
  return new THREE.Vector3(
    -kp.x * scale,
    -kp.y * scale,
    -kp.z * scale,
  );
}
