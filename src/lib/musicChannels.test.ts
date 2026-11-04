import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { isArabicMusicChannel, musicChannelLabel, musicChannelTitles } from './musicChannels'

function channel(id: number, name: string, categoryName: string, overrides: Partial<Title> = {}): Title {
  return {
    key: `live:${id}`,
    kind: 'live',
    id,
    name,
    cleanName: name,
    genres: [],
    cast: [],
    quality: 'HD',
    languages: [],
    editions: [],
    categoryId: 'cat',
    categoryName,
    addedAt: id,
    provider: 'other',
    hasArtwork: false,
    poster: '',
    ...overrides,
  } as Title
}

describe('isArabicMusicChannel', () => {
  it('keeps the panel’s Arabic music rails', () => {
    expect(isArabicMusicChannel(channel(1, 'AR 1 جورج وسوف', 'AR - ANGHAMI ♬ انغامي'))).toBe(true)
    expect(isArabicMusicChannel(channel(2, 'AR: SPOTIFY Top1', 'TARAB 4K ➤ اغــاني'))).toBe(true)
    expect(isArabicMusicChannel(channel(3, 'AR: ROTANA TARAB FM', 'AR - SLING سلينغ'))).toBe(true)
  })

  it('drops the Latin, Turkish and Ukrainian music packs', () => {
    expect(isArabicMusicChannel(channel(4, 'TRACE Urban', 'TR- MUSIC 4K ♬'))).toBe(false)
    expect(isArabicMusicChannel(channel(5, 'SPOTIFY Hakan Altun', 'TR- MUSIC 4K ♬'))).toBe(false)
    expect(isArabicMusicChannel(channel(6, 'Музыка Первого', 'RU - музыка 4K'))).toBe(false)
  })

  it('never pulls in news, films, sport or religious feeds', () => {
    expect(isArabicMusicChannel(channel(7, 'MTV Lebanon', 'AR- NEWS ® اخبار'))).toBe(false)
    expect(isArabicMusicChannel(channel(8, 'روتانا سينما', 'AR- ROTANA روتـانـا'))).toBe(false)
    expect(isArabicMusicChannel(channel(9, 'beIN SPORTS 1', 'AR - SPORTS CHANNEL 4K'))).toBe(false)
    expect(isArabicMusicChannel(channel(10, 'Quran TV', 'AR - QURAN القرآن الكريم'))).toBe(false)
  })
})

describe('musicChannelLabel', () => {
  it('strips the Arabic pack prefix, station numbers and quality tags', () => {
    expect(musicChannelLabel('AR 1 جورج وسوف')).toBe('جورج وسوف')
    expect(musicChannelLabel('AR_ وديع الصافي')).toBe('وديع الصافي')
    expect(musicChannelLabel('AR: ANGHAMI FAIROUZ')).toBe('ANGHAMI FAIROUZ')
    expect(musicChannelLabel('AR FAIROUZ 4K فيروز')).toBe('FAIROUZ فيروز')
  })
})

describe('musicChannelTitles', () => {
  const channels = [
    channel(1, 'AR 1 جورج وسوف', 'AR - ANGHAMI ♬ انغامي'),
    channel(2, 'AR 2 جورج وسوف', 'AR - ANGHAMI ♬ انغامي', { quality: '4K' }),
    channel(3, 'AR: ANGHAMI GeorgeWassof', 'TARAB 4K ➤ اغــاني', { poster: 'https://cdn/w.jpg', hasArtwork: true }),
    channel(4, 'AR صباح فخري', 'AR - ANGHAMI ♬ انغامي', { poster: 'https://cdn/s.jpg', hasArtwork: true }),
    channel(5, 'SPOTIFY Adnan Senses', 'TR- MUSIC 4K ♬'),
  ]

  it('keeps one station per artist, preferring real artwork', () => {
    const result = musicChannelTitles(channels)
    expect(result.map((t) => t.id).sort()).toEqual([3, 4])
  })

  it('caches per channel array so Home remounts stay cheap', () => {
    expect(musicChannelTitles(channels)).toBe(musicChannelTitles(channels))
  })
})
