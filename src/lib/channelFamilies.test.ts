import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { channelFamilyKey, groupChannelFamilies } from './channelFamilies'
import { matchesCollection } from './collections'

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
    categoryName: 'AR - NEWS',
    addedAt: 0,
    provider: 'other',
    hasArtwork: false,
    num: id,
    ...overrides,
  }
}

describe('channel families', () => {
  it('maps every Al Jazeera feed to one brand key', () => {
    const names = [
      'ALJAZEERA',
      'AL JAZEERA',
      'Aljazeera 2',
      'ALJAZEERA WORLD',
      'AL JAZEERA MUBASHER 1 UHD ++',
      'ALJAZEERA 360',
    ]
    expect(new Set(names.map(channelFamilyKey))).toEqual(new Set(['aljazeera']))
  })

  it('groups feeds into one family led by the feed that has artwork', () => {
    const families = groupChannelFamilies([
      channel(1, 'ALJAZEERA', { hasArtwork: false }),
      channel(2, 'ALJAZEERA 2', { hasArtwork: true, poster: 'https://cdn.example.com/aj2.png', quality: 'FHD' }),
      channel(3, 'ALJAZEERA WORLD', { hasArtwork: false }),
      channel(4, 'MTV'),
    ])

    expect(families).toHaveLength(2)
    const jazeera = families.find((family) => family.key === 'aljazeera')
    expect(jazeera?.members).toHaveLength(3)
    expect(jazeera?.primary.id).toBe(2)
  })

  it('keeps single-feed channels as their own family', () => {
    const families = groupChannelFamilies([channel(7, 'CNN')])
    expect(families).toEqual([expect.objectContaining({ key: 'cnn', members: [expect.objectContaining({ id: 7 })] })])
  })
})

describe('kids and anime collections', () => {
  it('matches only kids categories for Kids and only anime for Anime', () => {
    const cartoon = channel(1, 'Cartoon', { categoryName: 'CARTOON - كارتون مدبلج' })
    const anime = channel(2, 'Naruto', { categoryName: 'ANIME افلام انمي' })
    const drama = channel(3, 'Drama', { categoryName: 'EN l DRAMA دراما رومنسي' })

    expect(matchesCollection(cartoon, 'kids')).toBe(true)
    expect(matchesCollection(anime, 'kids')).toBe(false)
    expect(matchesCollection(anime, 'anime')).toBe(true)
    expect(matchesCollection(cartoon, 'anime')).toBe(false)
    expect(matchesCollection(drama, 'kids')).toBe(false)
    expect(matchesCollection(drama, 'anime')).toBe(false)
  })
})
