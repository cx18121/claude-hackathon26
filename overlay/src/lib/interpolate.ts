import type { PoseKeypoint } from '@shared/protocol'

function hermite(a: number, b: number, t: number) {
  const clamped = Math.max(0, Math.min(1, t))
  const smooth = clamped * clamped * (3 - 2 * clamped)
  return a + (b - a) * smooth
}

export function interpolatePoses(
  prev: PoseKeypoint[],
  next: PoseKeypoint[],
  t: number,
): PoseKeypoint[] {
  const count = Math.min(prev.length, next.length)
  return interpolatePosesInto(prev, next, t, Array.from({ length: count }, emptyPoint))
}

function emptyPoint(): PoseKeypoint {
  return { x: 0, y: 0, z: 0, visibility: 0 }
}

export function extrapolatePosesInto(
  prev: PoseKeypoint[],
  next: PoseKeypoint[],
  t: number,
  output: PoseKeypoint[],
): PoseKeypoint[] {
  const count = Math.min(prev.length, next.length)
  if (output.length > count) {
    output.length = count
  }

  const overshoot = t - 1

  for (let index = 0; index < count; index += 1) {
    const target = output[index] ?? emptyPoint()
    // Linear extrapolation: next + velocity * overshoot, where velocity = (next - prev)
    target.x = next[index].x + (next[index].x - prev[index].x) * overshoot
    target.y = next[index].y + (next[index].y - prev[index].y) * overshoot
    target.z = next[index].z + (next[index].z - prev[index].z) * overshoot
    target.visibility = next[index].visibility
    output[index] = target
  }

  return output
}

export function interpolatePosesInto(
  prev: PoseKeypoint[],
  next: PoseKeypoint[],
  t: number,
  output: PoseKeypoint[],
): PoseKeypoint[] {
  const count = Math.min(prev.length, next.length)

  if (output.length > count) {
    output.length = count
  }

  for (let index = 0; index < count; index += 1) {
    const target = output[index] ?? emptyPoint()
    target.x = hermite(prev[index].x, next[index].x, t)
    target.y = hermite(prev[index].y, next[index].y, t)
    target.z = hermite(prev[index].z, next[index].z, t)
    target.visibility = hermite(prev[index].visibility, next[index].visibility, t)
    output[index] = target
  }

  return output
}
