import { describe, expect, it } from 'vitest'
import type { Quality } from '../types'
import { lowerEdition, pickEdition, slowNetworkCap } from './editions'

function edition(streamId: number, quality: Quality) {
  return { streamId, quality }
}

const editions = [edition(1, 'SD'), edition(2, 'HD'), edition(3, 'FHD'), edition(4, '4K')]

describe('slowNetworkCap', () => {
  it('reports no ceiling for a healthy link', () => {
    expect(slowNetworkCap({ effectiveType: '4g', downlink: 20 })).toBeNull()
    expect(slowNetworkCap({})).toBeNull()
  })

  it('caps 2g to SD and 3g to HD', () => {
    expect(slowNetworkCap({ effectiveType: '2g' })).toBe('SD')
    expect(slowNetworkCap({ effectiveType: 'slow-2g' })).toBe('SD')
    expect(slowNetworkCap({ effectiveType: '3g' })).toBe('HD')
  })

  it('falls back to downlink when the API bucket is missing', () => {
    expect(slowNetworkCap({ downlink: 0.4 })).toBe('SD')
    expect(slowNetworkCap({ downlink: 2 })).toBe('HD')
  })

  it('caps a nominally fast link that measures slow, so 4K is not attempted', () => {
    expect(slowNetworkCap({ effectiveType: '4g', downlink: 2.1 })).toBe('HD')
    expect(slowNetworkCap({ effectiveType: '4g', downlink: 5 })).toBe('FHD')
    expect(slowNetworkCap({ effectiveType: '4g', downlink: 40 })).toBeNull()
  })

  it('honours the data saver switch', () => {
    expect(slowNetworkCap({ saveData: true, effectiveType: '4g' })).toBe('SD')
  })
})

describe('pickEdition', () => {
  it('uses the best edition on a fast link', () => {
    expect(pickEdition(editions, 'auto', { effectiveType: '4g' })?.streamId).toBe(4)
  })

  it('steps down on a slow link instead of stalling', () => {
    expect(pickEdition(editions, 'auto', { effectiveType: '3g' })?.streamId).toBe(2)
    expect(pickEdition(editions, 'auto', { effectiveType: '2g' })?.streamId).toBe(1)
  })

  it('never exceeds a pinned quality', () => {
    expect(pickEdition(editions, 'FHD', { effectiveType: '4g' })?.streamId).toBe(3)
    expect(pickEdition(editions, 'HD', { effectiveType: '4g' })?.streamId).toBe(2)
  })

  it('falls back to the lowest edition when nothing meets the cap', () => {
    expect(pickEdition([edition(9, '4K')], 'HD', {})?.streamId).toBe(9)
  })

  it('returns undefined for an empty list', () => {
    expect(pickEdition([], 'auto', {})).toBeUndefined()
  })
})

describe('lowerEdition', () => {
  it('returns the next step down, skipping the current stream', () => {
    expect(lowerEdition(editions, edition(4, '4K'))?.streamId).toBe(3)
    expect(lowerEdition(editions, edition(2, 'HD'))?.streamId).toBe(1)
  })

  it('returns nothing when already at the floor', () => {
    expect(lowerEdition(editions, edition(1, 'SD'))).toBeUndefined()
    expect(lowerEdition(editions, undefined)).toBeUndefined()
  })
})
