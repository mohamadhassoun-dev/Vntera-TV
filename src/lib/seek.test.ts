import { describe, expect, it } from 'vitest'
import { trackAxis, trackRatio } from './seek'

const rect = { left: 100, top: 200, width: 400, height: 300 }

describe('trackRatio', () => {
  it('maps left-to-right when the surface is upright', () => {
    expect(trackRatio({ x: 100, y: 999 }, rect, 'x')).toBe(0)
    expect(trackRatio({ x: 300, y: 0 }, rect, 'x')).toBe(0.5)
    expect(trackRatio({ x: 500, y: 0 }, rect, 'x')).toBe(1)
  })

  it('maps top-to-bottom when the surface is rotated', () => {
    // Cinema mode turns the player 90°, so the track runs down the screen.
    expect(trackRatio({ x: 0, y: 200 }, rect, 'y')).toBe(0)
    expect(trackRatio({ x: 500, y: 350 }, rect, 'y')).toBe(0.5)
    expect(trackRatio({ x: 0, y: 500 }, rect, 'y')).toBe(1)
  })

  it('clamps past the ends instead of seeking off the track', () => {
    expect(trackRatio({ x: -400, y: 0 }, rect, 'x')).toBe(0)
    expect(trackRatio({ x: 9999, y: 0 }, rect, 'x')).toBe(1)
    expect(trackRatio({ x: 0, y: -50 }, rect, 'y')).toBe(0)
    expect(trackRatio({ x: 0, y: 4000 }, rect, 'y')).toBe(1)
  })

  it('ignores the other axis entirely', () => {
    // Same horizontal point, different heights: a rotated track must not care.
    const low = trackRatio({ x: 300, y: 210 }, rect, 'y')
    const high = trackRatio({ x: 300, y: 490 }, rect, 'y')
    expect(low).toBeCloseTo(0.033, 3)
    expect(high).toBeCloseTo(0.967, 3)
  })

  it('does not divide by a collapsed track', () => {
    expect(trackRatio({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, 'x')).toBe(0)
    expect(trackRatio({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 }, 'y')).toBe(0)
  })
})

describe('trackAxis', () => {
  it('follows the rotation', () => {
    expect(trackAxis(false)).toBe('x')
    expect(trackAxis(true)).toBe('y')
  })
})
