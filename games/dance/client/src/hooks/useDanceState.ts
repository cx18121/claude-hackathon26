/**
 * Pure dance-state reducer extracted from useSpectatorSocket for unit testing.
 *
 * All functions are pure (no React state, no WebSocket).
 * useSpectatorSocket imports and uses these same functions so the
 * production code path is identical to the tested path.
 */

export interface DanceBeat {
  beat: number
  totalBeats: number
  targetPose: Array<[number, number, number, number]>
}

export interface DanceState {
  gameType: 'boxing' | 'fps_boxing' | 'dance' | null
  danceScores: [number, number]
  danceBeat: DanceBeat | null
}

export function initialDanceState(): DanceState {
  return {
    gameType: null,
    danceScores: [0, 0],
    danceBeat: null,
  }
}

export function danceReducer(
  state: DanceState,
  msg: { type: string; [key: string]: unknown },
): DanceState {
  if (msg.type === 'joined') {
    const gt = msg.game_type as string | undefined
    if (gt === 'boxing' || gt === 'fps_boxing' || gt === 'dance') {
      return { ...state, gameType: gt }
    }
    return state
  }

  if (msg.type === 'dance_beat') {
    return {
      ...state,
      danceBeat: {
        beat: msg.beat as number,
        totalBeats: msg.total_beats as number,
        targetPose: msg.target_pose as Array<[number, number, number, number]>,
      },
    }
  }

  if (msg.type === 'dance_score') {
    const scores = msg.scores as [number, number]
    return { ...state, danceScores: [scores[0], scores[1]] }
  }

  if (msg.type === 'rematch_start') {
    return { ...state, danceScores: [0, 0], danceBeat: null }
  }

  return state
}
