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
  it('picks every channel of the named feed and nothing else', () => {
    const channels = [
      channel(1, 'TOD beIN EVENTS 1'),
      channel(2, 'TOD beIN EVENTS 2'),
      channel(3, 'TOD SPORT 1'),
      channel(4, 'BEIN SPORT 1 4K'),
    ]
    expect(pickFeedChannels(channels, feed('tod-bein-events')).map((c) => c.id)).toEqual([1, 2])
    expect(pickFeedChannels(channels, feed('bein-hdr'))).toEqual([])
  })

  it('matches the HDR feed without swallowing the whole beIN pack', () => {
    const channels = [
      channel(1, 'BEIN HDR 4K'),
      channel(2, 'BEIN 2 HDR 4K'),
      channel(3, 'BEIN SPORT 1 4K'),
    ]
    expect(pickFeedChannels(channels, feed('bein-hdr')).map((c) => c.id)).toEqual([1, 2])
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
    const channels = [channel(1, 'MBC TOW 4k'), channel(2, 'MBC TOW HD')]
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
