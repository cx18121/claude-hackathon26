import type { PoseKeypoint } from '@shared/protocol';

/**
 * Normalize a sliding window buffer for ONNX inference.
 *
 * Applies shoulder-midpoint translation and shoulder-width scaling.
 * CRITICAL: This formula must be identical to normalize_window() in ml/scripts/train.py.
 *
 * @param buffer - Array of T PoseKeypoint[] frames (full 33-landmark arrays)
 * @param jointIndices - Ordered MediaPipe landmark indices to extract (length J)
 * @returns Float32Array of shape (T * J * 3), row-major: [t][j][c]
 */
export function normalizeWindow(
  buffer: PoseKeypoint[][],
  jointIndices: number[],
): Float32Array {
  const T = buffer.length;
  const J = jointIndices.length;
  const C = 3;
  const data = new Float32Array(T * J * C);

  for (let t = 0; t < T; t++) {
    const frame = buffer[t];
    // Joint indices 0 and 1 in extracted subset are LEFT_SHOULDER and RIGHT_SHOULDER
    const lSh = frame[jointIndices[0]];
    const rSh = frame[jointIndices[1]];

    const mx = (lSh.x + rSh.x) / 2;
    const my = (lSh.y + rSh.y) / 2;
    const mz = (lSh.z + rSh.z) / 2;
    const sw = Math.sqrt(
      (rSh.x - lSh.x) ** 2 + (rSh.y - lSh.y) ** 2 + (rSh.z - lSh.z) ** 2,
    );
    const scale = sw > 1e-6 ? sw : 1;

    for (let j = 0; j < J; j++) {
      const kp = frame[jointIndices[j]];
      const base = t * J * C + j * C;
      data[base + 0] = (kp.x - mx) / scale;
      data[base + 1] = (kp.y - my) / scale;
      data[base + 2] = (kp.z - mz) / scale;
    }
  }
  return data;
}
