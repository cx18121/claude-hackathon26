/**
 * Task 7 — Phase 9: Dance message handling tests for overlay.
 *
 * Tests the pure dance state reducer (useDanceState) which captures the same
 * logic used by useSpectatorSocket. The hook itself is too tightly coupled to
 * WebSocket to unit-test directly, so we test the extracted pure reducer.
 */
import { describe, it, expect } from 'vitest'
import { danceReducer, initialDanceState } from './useDanceState'

describe('danceReducer — joined message', () => {
  it('sets gameType to dance when joined with game_type dance', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'joined', game_type: 'dance' })
    expect(next.gameType).toBe('dance')
  })

  it('sets gameType to boxing when joined with game_type boxing', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'joined', game_type: 'boxing' })
    expect(next.gameType).toBe('boxing')
  })

  it('leaves gameType as null for unknown game_type', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'joined', game_type: 'unknown' })
    expect(next.gameType).toBeNull()
  })

  it('leaves gameType as null when game_type is absent', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'joined' })
    expect(next.gameType).toBeNull()
  })

  it('does not reset danceScores on joined', () => {
    const state = { ...initialDanceState(), danceScores: [5.5, 3.2] as [number, number] }
    const next = danceReducer(state, { type: 'joined', game_type: 'dance' })
    expect(next.danceScores).toEqual([5.5, 3.2])
  })
})

describe('danceReducer — dance_beat message', () => {
  it('stores beat, totalBeats, and targetPose correctly', () => {
    const state = initialDanceState()
    const pose: Array<[number, number, number, number]> = [
      [0.1, 0.2, 0.0, 0.9],
      [0.3, 0.4, 0.0, 1.0],
    ]
    const next = danceReducer(state, {
      type: 'dance_beat',
      beat: 3,
      total_beats: 16,
      target_pose: pose,
    })
    expect(next.danceBeat).not.toBeNull()
    expect(next.danceBeat!.beat).toBe(3)
    expect(next.danceBeat!.totalBeats).toBe(16)
    expect(next.danceBeat!.targetPose).toEqual(pose)
  })

  it('overwrites a previous danceBeat', () => {
    const state = initialDanceState()
    const s1 = danceReducer(state, { type: 'dance_beat', beat: 1, total_beats: 16, target_pose: [] })
    const s2 = danceReducer(s1, { type: 'dance_beat', beat: 2, total_beats: 16, target_pose: [] })
    expect(s2.danceBeat!.beat).toBe(2)
  })
})

describe('danceReducer — dance_score message', () => {
  it('updates danceScores with [p1, p2] values', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'dance_score', scores: [7.4, 12.1] })
    expect(next.danceScores[0]).toBeCloseTo(7.4)
    expect(next.danceScores[1]).toBeCloseTo(12.1)
  })

  it('updates danceScores from [0,0] to new values', () => {
    const state = initialDanceState()
    expect(state.danceScores).toEqual([0, 0])
    const next = danceReducer(state, { type: 'dance_score', scores: [0.9, 0.7] })
    expect(next.danceScores).toEqual([0.9, 0.7])
  })
})

describe('danceReducer — rematch_start message', () => {
  it('resets danceScores to [0,0]', () => {
    const state = { ...initialDanceState(), danceScores: [5.0, 8.0] as [number, number] }
    const next = danceReducer(state, { type: 'rematch_start' })
    expect(next.danceScores).toEqual([0, 0])
  })

  it('resets danceBeat to null', () => {
    const state = {
      ...initialDanceState(),
      danceBeat: { beat: 5, totalBeats: 16, targetPose: [] },
    }
    const next = danceReducer(state, { type: 'rematch_start' })
    expect(next.danceBeat).toBeNull()
  })

  it('preserves gameType on rematch_start', () => {
    const state = { ...initialDanceState(), gameType: 'dance' as const }
    const next = danceReducer(state, { type: 'rematch_start' })
    expect(next.gameType).toBe('dance')
  })
})

describe('danceReducer — unknown message types', () => {
  it('returns state unchanged for unknown type', () => {
    const state = initialDanceState()
    const next = danceReducer(state, { type: 'game_state' })
    expect(next).toBe(state)
  })
})
