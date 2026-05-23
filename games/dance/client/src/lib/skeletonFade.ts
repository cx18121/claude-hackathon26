import type { Graphics } from 'pixi.js'
import { drawTargetPoseSkeleton, SKELETON_ALPHA } from './boxerDraw'

// =====================================================================
// Dance-skeleton fade state machine. When a new beat arrives, fade the
// existing target-pose skeleton out, redraw with the new pose, and fade
// back in. Extracted from PixiCanvas.tsx so the ticker handler can read
// as straight-line orchestration.
// =====================================================================

export type SkeletonFadePhase = 'idle' | 'fade-out' | 'fade-in'

export interface SkeletonFadeState {
  phase: SkeletonFadePhase
  startMs: number
  pendingPose: Array<[number, number, number, number]> | null
  lastDrawnBeat: number
}

export interface DanceBeatInput {
  beat: number
  totalBeats: number
  targetPose: Array<[number, number, number, number]>
}

const FADE_DURATION_MS = 150

export function createSkeletonFadeState(): SkeletonFadeState {
  return { phase: 'idle', startMs: 0, pendingPose: null, lastDrawnBeat: -1 }
}

/**
 * Advance the skeleton fade by one frame. Call once per ticker iteration
 * with the current dance beat (or null), the skeleton Graphics object,
 * the current monotonic time, and the canvas dimensions.
 */
export function stepSkeletonFade(
  state: SkeletonFadeState,
  beatData: DanceBeatInput | null,
  skeletonGfx: Graphics,
  now: number,
  width: number,
  height: number,
): void {
  // Trigger fade-out when beat number changes
  if (
    beatData !== null &&
    beatData.beat !== state.lastDrawnBeat &&
    state.phase === 'idle'
  ) {
    state.phase = 'fade-out'
    state.startMs = now
    state.pendingPose = beatData.targetPose
    state.lastDrawnBeat = beatData.beat
  }

  if (state.phase === 'fade-out') {
    // alpha 0.4 → 0.0 over 150ms, ease-out-quart (f(t) = 1-(1-t)^4 ≈ 1-t^4)
    const t = Math.min(1, (now - state.startMs) / FADE_DURATION_MS)
    const eased = 1 - t * t * t * t
    skeletonGfx.alpha = SKELETON_ALPHA * eased
    if (t >= 1) {
      if (state.pendingPose) {
        drawTargetPoseSkeleton(skeletonGfx, state.pendingPose, width, height)
      }
      state.phase = 'fade-in'
      state.startMs = now
    }
  } else if (state.phase === 'fade-in') {
    // alpha 0.0 → 0.4 over 150ms, linear
    const t = Math.min(1, (now - state.startMs) / FADE_DURATION_MS)
    skeletonGfx.alpha = SKELETON_ALPHA * t
    if (t >= 1) {
      skeletonGfx.alpha = SKELETON_ALPHA
      state.phase = 'idle'
    }
  }
}
