import { describe, expect, it } from 'vitest'
import {
  BUFFER_CAP_S,
  BUFFER_FLOOR_S,
  BUFFER_TARGET_S,
  bufferTargetFor,
  bufferedAhead,
  hlsBufferProfile,
} from './playbackBuffer'

/** A stand-in for the element's TimeRanges, in the same shape. */
function ranges(list: Array<[number, number]>) {
  return {
    length: list.length,
    start: (i: number) => list[i][0],
    end: (i: number) => list[i][1],
  }
}

describe('bufferedAhead', () => {
  it('reads the range the playhead is inside', () => {
    expect(bufferedAhead({ buffered: ranges([[0, 40]]), currentTime: 10 })).toBe(30)
  })

  it('joins a range a hair before the playhead after a seek', () => {
    expect(bufferedAhead({ buffered: ranges([[100, 140]]), currentTime: 99.9 })).toBeCloseTo(40.1, 1)
  })

  it('picks the range ahead when the playhead sits in a gap', () => {
    expect(bufferedAhead({ buffered: ranges([[0, 5], [30, 60]]), currentTime: 12 })).toBe(0)
  })

  it('reports nothing before any data arrives', () => {
    expect(bufferedAhead({ buffered: ranges([]), currentTime: 0 })).toBe(0)
    expect(bufferedAhead({ buffered: ranges([[0, 0]]), currentTime: 0 })).toBe(0)
  })
})

describe('bufferTargetFor', () => {
  it('asks for the 15–20 s window on a normal timeline', () => {
    const target = bufferTargetFor({ buffered: ranges([[0, 60]]), currentTime: 5, duration: 600 })
    expect(target).toBe(BUFFER_TARGET_S)
    expect(target).toBeGreaterThanOrEqual(15)
    expect(target).toBeLessThanOrEqual(20)
  })

  it('never waits for more than the file has left', () => {
    expect(bufferTargetFor({ buffered: ranges([[0, 60]]), currentTime: 598, duration: 600 })).toBe(2)
  })

  it('stays inside the cap when the duration is unknown', () => {
    expect(bufferTargetFor({ buffered: ranges([[0, 60]]), currentTime: 5 })).toBe(BUFFER_TARGET_S)
  })
})

describe('hlsBufferProfile', () => {
  it('targets 15–20 s ahead with a bounded ceiling on a healthy link', () => {
    const profile = hlsBufferProfile({ slowLink: false, isLive: false })
    expect(profile.maxBufferLength).toBeGreaterThanOrEqual(15)
    expect(profile.maxBufferLength).toBeLessThanOrEqual(20)
    expect(profile.maxMaxBufferLength).toBe(BUFFER_CAP_S)
    expect(profile.maxMaxBufferLength).toBeGreaterThan(profile.maxBufferLength)
    expect(profile.backBufferLength).toBe(30)
    expect(profile.startLevel).toBe(-1)
  })

  it('starts low and estimates low on a thin link', () => {
    const profile = hlsBufferProfile({ slowLink: true, isLive: false })
    expect(profile.startLevel).toBe(0)
    expect(profile.abrEwmaDefaultEstimate).toBeLessThan(1_000_000)
    expect(profile.abrBandWidthUpFactor).toBeLessThan(0.7)
    expect(profile.maxMaxBufferLength).toBeLessThanOrEqual(BUFFER_CAP_S)
  })

  it('bounds the live back-buffer and forward cap', () => {
    const live = hlsBufferProfile({ slowLink: false, isLive: true })
    expect(live.backBufferLength).toBe(90)
    expect(live.maxBufferLength).toBe(BUFFER_TARGET_S)
    expect(BUFFER_FLOOR_S).toBeLessThan(live.maxBufferLength)
  })
})
