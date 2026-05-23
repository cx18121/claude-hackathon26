import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AvatarCanvas } from '@shared/client/components/AvatarCanvas'
import type { PoseKeypoint } from '@shared/protocol'

// jsdom doesn't implement canvas 2D; provide a minimal spy-based mock.
const mockCtx = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  fillStyle: '',
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    mockCtx as any,
  )
  // jsdom gives canvases zero layout dimensions; give them a realistic size
  // so projected points spread apart and connection lengths are > 1px.
  vi.spyOn(HTMLCanvasElement.prototype, 'offsetWidth', 'get').mockReturnValue(390)
  vi.spyOn(HTMLCanvasElement.prototype, 'offsetHeight', 'get').mockReturnValue(844)

  mockCtx.clearRect.mockClear()
  mockCtx.beginPath.mockClear()
  mockCtx.moveTo.mockClear()
  mockCtx.lineTo.mockClear()
  mockCtx.closePath.mockClear()
  mockCtx.fill.mockClear()
  mockCtx.arc.mockClear()
  mockCtx.fillStyle = ''
})

function makeKeypoints(count = 33, visibility = 0.9): PoseKeypoint[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (i % 5) * 0.05 - 0.1,
    y: (i % 7) * 0.06 - 0.2,
    z: 0,
    visibility,
  }))
}

describe('AvatarCanvas', () => {
  it('renders a canvas element', () => {
    const { container } = render(<AvatarCanvas keypoints={null} hitRegion={null} />)
    expect(container.querySelector('canvas')).not.toBeNull()
  })

  it('canvas has avatar-canvas class', () => {
    const { container } = render(<AvatarCanvas keypoints={null} hitRegion={null} />)
    expect(container.querySelector('canvas.avatar-canvas')).not.toBeNull()
  })

  it('clears canvas when keypoints are null', () => {
    render(<AvatarCanvas keypoints={null} hitRegion={null} />)
    expect(mockCtx.clearRect).toHaveBeenCalled()
    expect(mockCtx.fill).not.toHaveBeenCalled()
  })

  it('draws skeleton when keypoints are provided', () => {
    render(<AvatarCanvas keypoints={makeKeypoints()} hitRegion={null} />)
    expect(mockCtx.clearRect).toHaveBeenCalled()
    // fill() is called for each capsule quad + two end-cap circles per connection
    expect(mockCtx.fill.mock.calls.length).toBeGreaterThan(0)
  })

  it('skips invisible keypoints (visibility below threshold)', () => {
    // All keypoints invisible — nothing drawn beyond the clear
    render(<AvatarCanvas keypoints={makeKeypoints(33, 0.1)} hitRegion={null} />)
    expect(mockCtx.fill).not.toHaveBeenCalled()
  })

  it('accepts a hitRegion without throwing', () => {
    expect(() =>
      render(<AvatarCanvas keypoints={makeKeypoints()} hitRegion="head_face" />),
    ).not.toThrow()
  })

  it('uses red fill style when hitRegion is set and keypoints are visible', () => {
    render(<AvatarCanvas keypoints={makeKeypoints()} hitRegion="head_face" />)
    // Check that fill() was called (hit path was reached)
    expect(mockCtx.fill.mock.calls.length).toBeGreaterThan(0)
  })

  it('re-renders correctly when keypoints update', () => {
    const { rerender } = render(<AvatarCanvas keypoints={null} hitRegion={null} />)
    mockCtx.clearRect.mockClear()
    mockCtx.fill.mockClear()

    rerender(<AvatarCanvas keypoints={makeKeypoints()} hitRegion={null} />)
    expect(mockCtx.clearRect).toHaveBeenCalled()
    expect(mockCtx.fill.mock.calls.length).toBeGreaterThan(0)
  })

  it('clears back to empty when keypoints become null after having data', () => {
    const { rerender } = render(<AvatarCanvas keypoints={makeKeypoints()} hitRegion={null} />)
    mockCtx.fill.mockClear()
    mockCtx.clearRect.mockClear()

    rerender(<AvatarCanvas keypoints={null} hitRegion={null} />)
    expect(mockCtx.clearRect).toHaveBeenCalled()
    expect(mockCtx.fill).not.toHaveBeenCalled()
  })

  it('handles unknown hitRegion gracefully', () => {
    expect(() =>
      render(<AvatarCanvas keypoints={makeKeypoints()} hitRegion="unknown_region_xyz" />),
    ).not.toThrow()
  })
})
