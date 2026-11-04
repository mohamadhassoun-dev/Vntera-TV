import { describe, expect, it } from 'vitest'
import type { CatalogSnapshot, Title } from '../types'
import { featuredChannels } from './catalog'

function channel(id: number, name: string): Title {
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
    categoryId: 'lebanon',
    categoryName: 'Lebanon',
    addedAt: 0,
    provider: 'other',
    hasArtwork: true,
  }
}

function snapshot(channels: Title[]): CatalogSnapshot {
  return {
    account: 'test',
    builtAt: 0,
    demo: false,
    channels,
    movies: [],
    series: [],
    categories: { live: [], vod: [], series: [] },
    counts: { channels: channels.length, movies: 0, series: 0 },
  }
}

describe('featured Home channel shortcuts', () => {
  it('returns exact configured matches in requested order and excludes similar names', () => {
    const result = featuredChannels(
      snapshot([
        channel(5, 'MTV 90s'),
        channel(4, 'BEIN Sports Low 1'),
        channel(3, 'lbci'),
        channel(2, 'MTV'),
        channel(1, 'Jadeed'),
        channel(6, 'beIN SPORTS'),
      ]),
    )

    expect(result.map(({ label }) => label)).toEqual([
      'Al Jadeed',
      'MTV Lebanon',
      'LBC',
      'beIN SPORTS LOW 1',
    ])
    expect(result.map(({ channel: item }) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('omits unavailable shortcuts instead of inventing channels', () => {
    const result = featuredChannels(snapshot([channel(8, 'LBC')]))

    expect(result).toEqual([{ channel: expect.objectContaining({ id: 8 }), label: 'LBC' }])
  })
})
