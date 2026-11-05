/**
 * Turning a pointer position into a position along a seek track.
 *
 * The player rotates the whole surface 90° in cinema mode, so the track that runs
 * left-to-right in normal playback runs top-to-bottom on screen. Reading the wrong
 * axis there lands the film at a wildly different time, which is what made
 * scrubbing feel like it "takes me somewhere wrong".
 */

export interface TrackRect {
  left: number
  top: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export type TrackAxis = 'x' | 'y'

/** Fraction along the track, clamped to the ends. */
export function trackRatio(point: Point, rect: TrackRect, axis: TrackAxis): number {
  if (axis === 'y') {
    if (rect.height <= 0) return 0
    return Math.min(1, Math.max(0, (point.y - rect.top) / rect.height))
  }
  if (rect.width <= 0) return 0
  return Math.min(1, Math.max(0, (point.x - rect.left) / rect.width))
}

/** The axis a track is laid out along, given whether the surface is turned. */
export function trackAxis(rotated: boolean): TrackAxis {
  return rotated ? 'y' : 'x'
}
