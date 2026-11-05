import { describe, expect, it } from 'vitest'
import { arabicChannelFamilies, arabicChannelLabel, isArabicChannel } from './arabicChannels'
import type { Title } from '../types'

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
    languages: [],
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

describe('arabic channel wall', () => {
  it('recognises Arabic channels from the section, the language tag or the name', () => {
    expect(isArabicChannel(channel(1, 'AL ARABIYA'))).toBe(true) // AR - NEWS section
    expect(isArabicChannel(channel(2, 'MBC 1', { categoryName: 'Entertainment', languages: ['ar'] }))).toBe(true)
    expect(isArabicChannel(channel(3, 'قناة الشارقة', { categoryName: 'General' }))).toBe(true)
    expect(isArabicChannel(channel(4, 'CNN', { categoryName: 'US - NEWS', languages: ['en'] }))).toBe(false)
  })

  it('shows one card per brand and keeps the feed that has a logo', () => {
    const families = arabicChannelFamilies([
      channel(1, 'ALJAZEERA'),
      channel(2, 'ALJAZEERA 2'),
      channel(3, 'AL JAZEERA', { poster: 'https://cdn/jazeera.png', hasArtwork: true }),
      channel(4, 'MBC 1', { poster: 'https://cdn/mbc1.png', hasArtwork: true }),
    ])
    expect(families).toHaveLength(2)
    const jazeera = families.find((family) => family.key === 'aljazeera')
    expect(jazeera?.members).toHaveLength(3)
    expect(jazeera?.primary.poster).toBe('https://cdn/jazeera.png')
  })

  it('puts channels with real logos ahead of branded ones without artwork', () => {
    const families = arabicChannelFamilies([
      channel(1, 'LBC'), // known brand, no logo
      channel(2, 'SOMETHING LOCAL', { poster: 'https://cdn/local.png', hasArtwork: true }),
    ])
    expect(families[0].primary.poster).toBe('https://cdn/local.png')
  })

  it('cleans the caption of section tags, underscores and quality suffixes', () => {
    expect(arabicChannelLabel('AR: MBC_1 4K')).toBe('MBC 1')
    expect(arabicChannelLabel('|AR.MBC| MBC TOW')).toBe('MBC TOW')
    expect(arabicChannelLabel('ROTANA CINEMA HD')).toBe('ROTANA CINEMA')
  })
})
