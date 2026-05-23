export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15],
  [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16],
  [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
] as const satisfies readonly (readonly [number, number])[]

// Map server region strings -> keypoint indices that should flash on hit
export const REGION_KEYPOINTS: Record<string, readonly number[]> = {
  head_face:    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  head_chin:    [0, 9, 10],
  head_throat:  [0, 9, 10, 11, 12],
  torso_upper:  [11, 12, 13, 14],
  torso_lower:  [23, 24, 25, 26],
  leg_thigh:    [23, 24, 25, 26],
  leg_shin:     [25, 26, 27, 28],
  block_hand:   [15, 16, 17, 18, 19, 20, 21, 22],
  block_forearm:[13, 14, 15, 16],
}
