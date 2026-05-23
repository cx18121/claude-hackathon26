/**
 * guardDetection.ts — guard pose detection with hysteresis for FPS boxing.
 *
 * Guard pose: player raises both wrists above both shoulders.
 *
 * Y-axis sign note (from Plan 14-01b Task 2 spike A):
 *   MediaPipe worldLandmarks Y is positive-down (hip-midpoint origin).
 *   Shoulder is above hip → shoulder.y is negative (e.g. -0.3).
 *   Raised wrist (above shoulder) → wrist.y is even more negative (e.g. -0.5).
 *   Guard condition: shoulder.y - wrist.y > threshold
 *     e.g. (-0.3) - (-0.5) = 0.2 > 0.05 → guard active.
 *   Raw MediaPipe keypoints are used here (not world-space), so this comparison
 *   operates directly on PoseKeypoint.y without the negation from keypointToWorld.
 */

import type { PoseKeypoint } from '@shared/protocol';
import { LANDMARK } from '@shared/client/velocity';

export interface GuardState {
  active: boolean;
  consecutiveFrames: number;
}

/** Number of consecutive raw=true frames required to enter guard state. */
export const ENTER_FRAMES = 3;

/** Number of consecutive raw=false frames required to exit guard state. */
export const EXIT_FRAMES = 5;

/**
 * Returns true if both wrists are above both shoulders (guard pose).
 *
 * Uses raw MediaPipe keypoint Y values (positive-down convention).
 * A raised wrist has a more negative Y than the shoulder, so:
 *   shoulder.y - wrist.y > threshold → wrist is above shoulder.
 *
 * @param keypoints - MediaPipe worldLandmarks array (or null)
 * @param threshold - minimum Y distance (in meters) wrist must be above shoulder (default 0.05)
 */
export function isGuardPose(keypoints: PoseKeypoint[] | null, threshold = 0.05): boolean {
  if (keypoints === null || keypoints.length <= LANDMARK.RIGHT_WRIST) return false;

  const leftGuard =
    keypoints[LANDMARK.LEFT_SHOULDER].y - keypoints[LANDMARK.LEFT_WRIST].y > threshold;
  const rightGuard =
    keypoints[LANDMARK.RIGHT_SHOULDER].y - keypoints[LANDMARK.RIGHT_WRIST].y > threshold;

  return leftGuard && rightGuard;
}

/**
 * Update guard state with hysteresis to avoid flickering on noisy keypoints.
 *
 * Entry: guard activates after ENTER_FRAMES (3) consecutive raw=true frames.
 * Exit: guard deactivates after EXIT_FRAMES (5) consecutive raw=false frames.
 *
 * @param state - mutable GuardState (modified in place)
 * @param raw - raw per-frame guard pose result from isGuardPose()
 */
export function updateGuard(state: GuardState, raw: boolean): void {
  if (raw && !state.active) {
    state.consecutiveFrames += 1;
    if (state.consecutiveFrames >= ENTER_FRAMES) {
      state.active = true;
      state.consecutiveFrames = 0;
    }
  } else if (!raw && state.active) {
    state.consecutiveFrames += 1;
    if (state.consecutiveFrames >= EXIT_FRAMES) {
      state.active = false;
      state.consecutiveFrames = 0;
    }
  } else {
    state.consecutiveFrames = 0;
  }
}
