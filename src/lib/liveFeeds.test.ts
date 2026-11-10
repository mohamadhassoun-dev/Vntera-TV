import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { LIVE_FEEDS, pickFeedChannels } from './liveFeeds'

function channel(id: number, name: string, overrides: Partial<Title> = {}): Title {
  return {
    key: `live:${id}`,
    kind: 'live',
    id,
    name,
    cleanName: name.toLowerCase(),
    genres: [],
    cast: [],
    quality: 'HD',
    languages: ['ar'],
    editions: [],
    categoryId: 'news',
    categoryName: 'TOD SPORT',
    addedAt: 0,
    provider: 'other',
    hasArtwork: false,
    num: id,
    ...overrides,
  }
}

const feed = (key: string) => {
  const found = LIVE_FEEDS.find((entry) => entry.key === key)
  if (!found) throw new Error(`no feed ${key}`)
  return found
}

describe('live feeds', () => {
  it('carries every feed of the brand, not just the one named in the heading', () => {
    const channels = [
      channel(1, 'NetFlix Kids'),
      channel(2, 'NETFLIX WWE'),
      channel(3, 'NetFlix Crime'),
      channel(4, 'NetFlix HollywooD'),
      channel(5, 'SHAHID SPORT 1'),
    ]
    expect(pickFeedChannels(channels, feed('netflix-kids')).map((c) => c.id)).toEqual([1, 2, 3, 4])
  })

  it('keeps brands apart: the beIN row does not swallow TOD or MBC', () => {
    const channels = [
      channel(1, 'TOD beIN EVENTS 1'),
      channel(2, 'BEIN SPORT 1 4K'),
      channel(3, 'BEIN SPORTS NEWS'),
      channel(4, '|AR.MBC| MBC TOW'),
      channel(5, 'SHAHID TASH'),
    ]
    expect(pickFeedChannels(channels, feed('tod-bein-events')).map((c) => c.id)).toEqual([1])
    expect(pickFeedChannels(channels, feed('bein-hdr')).map((c) => c.id)).toEqual([2, 3])
    expect(pickFeedChannels(channels, feed('mbc-tow')).map((c) => c.id)).toEqual([4])
    expect(pickFeedChannels(channels, feed('shahid-tash')).map((c) => c.id)).toEqual([5])
  })

  it('lends a feed logo to channels that have none of their own', () => {
    const channels = [
      channel(1, 'SHahid Tash'),
      channel(2, 'SHAHID TASH 4K'),
      channel(3, 'SHAHID TASH HD'),
    ]
    channels[0].poster = 'https://cdn.example.com/tash.png'
    channels[0].hasArtwork = true
    const picked = pickFeedChannels(channels, feed('shahid-tash'))
    expect(picked).toHaveLength(3)
    expect(picked.every((c) => Boolean(c.poster))).toBe(true)
    expect(picked.map((c) => c.poster)).toEqual([
      'https://cdn.example.com/tash.png',
      'https://cdn.example.com/tash.png',
      'https://cdn.example.com/tash.png',
    ])
  })

  it('borrows from the closest-named channel, not the first one with a logo', () => {
    const channels = [
      channel(1, 'ZEE PUNJABI', { poster: 'https://cdn.example.com/zee-punjabi.png' }),
      channel(2, 'ZEE TELUGU', { poster: 'https://cdn.example.com/zee-telugu.png' }),
      channel(3, 'ZEE ALWAN', { poster: 'https://cdn.example.com/zee-alwan.png' }),
      channel(4, 'ZEE ALWAN Egypt'),
    ]
    const picked = pickFeedChannels(channels, feed('zee-tv'))
    expect(picked.find((c) => c.id === 4)?.poster).toBe('https://cdn.example.com/zee-alwan.png')
  })

  it('ships a local brand logo for every feed', () => {
    for (const entry of LIVE_FEEDS) expect(entry.fallbackLogo).toMatch(/^\/logos\/feeds\//)
  })

  it('uses the published brand logo when no channel in the feed has artwork', () => {
    const channels = [channel(1, 'MBC TOW 4k'), channel(2, 'MBC ZOOM HD')]
    const picked = pickFeedChannels(channels, feed('mbc-tow'))
    expect(picked).toHaveLength(2)
    expect(picked[0].poster).toBe(feed('mbc-tow').fallbackLogo)
    expect(picked[1].poster).toBe(feed('mbc-tow').fallbackLogo)
  })

  it('keeps numbered events in numeric order', () => {
    const channels = [channel(3, 'TOD beIN EVENTS 10', { num: 10 }), channel(1, 'TOD beIN EVENTS 2', { num: 2 })]
    expect(pickFeedChannels(channels, feed('tod-bein-events')).map((c) => c.name)).toEqual([
      'TOD beIN EVENTS 2',
      'TOD beIN EVENTS 10',
    ])
  })
})
