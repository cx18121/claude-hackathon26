/**
 * Task 8 — Phase 9: DanceHud component unit tests.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DanceHud } from './DanceHud'

describe('DanceHud — score formatting', () => {
  it('renders scores as one-decimal strings', () => {
    render(
      <DanceHud
        danceScores={[11.7, 8.0]}
        danceBeat={null}
        connected={true}
      />,
    )
    // toFixed(1) output
    expect(screen.getByText('11.7')).toBeInTheDocument()
    expect(screen.getByText('8.0')).toBeInTheDocument()
  })

  it('renders zero state as "0.0" for both players', () => {
    render(
      <DanceHud
        danceScores={[0, 0]}
        danceBeat={null}
        connected={true}
      />,
    )
    const zeros = screen.getAllByText('0.0')
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })
})

describe('DanceHud — beat label', () => {
  it('shows "— / —" when danceBeat is null', () => {
    render(
      <DanceHud
        danceScores={[0, 0]}
        danceBeat={null}
        connected={true}
      />,
    )
    expect(screen.getAllByText('— / —')[0]).toBeInTheDocument()
  })

  it('shows "beat / totalBeats" when danceBeat is provided', () => {
    render(
      <DanceHud
        danceScores={[0, 0]}
        danceBeat={{ beat: 3, totalBeats: 16, targetPose: [] }}
        connected={true}
      />,
    )
    expect(screen.getByText('3 / 16')).toBeInTheDocument()
  })

  it('shows "0 / 16" for beat=0 (round-start preview)', () => {
    render(
      <DanceHud
        danceScores={[0, 0]}
        danceBeat={{ beat: 0, totalBeats: 16, targetPose: [] }}
        connected={true}
      />,
    )
    expect(screen.getByText('0 / 16')).toBeInTheDocument()
  })

  it('shows "16 / 16" for the final beat', () => {
    render(
      <DanceHud
        danceScores={[5.3, 9.1]}
        danceBeat={{ beat: 16, totalBeats: 16, targetPose: [] }}
        connected={true}
      />,
    )
    expect(screen.getByText('16 / 16')).toBeInTheDocument()
  })
})
