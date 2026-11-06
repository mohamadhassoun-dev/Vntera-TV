import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { BANDS, BAND_COUNT, matchesBandGenre, matchesBandName, pickBandTitles } from './genreBands'

function movie(id: number, name: string, extra: Partial<Title> = {}): Title {
  return {
    key: 'movie',
    kind: 'movie',
    id,
    name,
    cleanName: name,
    genres: [],
    cast: [],
    quality: 'FHD',
    languages: ['en'],
    editions: [],
    categoryId: '1',
    categoryName: 'General',
    addedAt: id,
    provider: 'other',
    hasArtwork: false,
    ...extra,
  }
}

describe('genre bands', () => {
  it('recognises the curated titles the panel names itself', () => {
    expect(matchesBandName(movie(1, 'John Wick: Chapter 4'), BANDS.action)).toBe(true)
    expect(matchesBandName(movie(2, 'The Shawshank Redemption'), BANDS.drama)).toBe(true)
    expect(matchesBandName(movie(3, 'Horror Night'), BANDS.action)).toBe(false)
  })

  it('uses the panel genre text when the name is unknown', () => {
    const tagged = movie(4, 'Some Imported Feature', { genres: ['Action'] })
    expect(matchesBandGenre(tagged, 'Action')).toBe(true)
    expect(matchesBandGenre(movie(5, 'Some Imported Feature', { genres: ['Drama'] }), 'Action')).toBe(false)
  })

  it('fills a full band from names when nothing is tagged', () => {
    const library = Array.from({ length: 40 }, (_, index) =>
      movie(index + 1, `John Wick ${index + 1}`),
    )
    expect(pickBandTitles(library, BANDS.action)).toHaveLength(BAND_COUNT)
  })

  it('tops the band up instead of leaving it short', () => {
    const library = [
      movie(1, 'John Wick'),
      movie(2, 'Unrelated Title A'),
      movie(3, 'The Last Battle'),
      movie(4, 'War Machine'),
      movie(5, 'Untagged Import'),
    ]
    const picked = pickBandTitles(library, BANDS.action)
    expect(picked.map((title) => title.id)).toContain(3)
    expect(picked.every((title) => title.id !== 5)).toBe(true)
  })

  it('never repeats a poster and prefers the best rated', () => {
    const library = Array.from({ length: 30 }, (_, index) =>
      movie(index + 1, `Action Feature ${index + 1}`, { genres: ['Action'], rating: index }),
    )
    const picked = pickBandTitles(library, BANDS.action)
    expect(picked).toHaveLength(BAND_COUNT)
    expect(new Set(picked.map((title) => title.id)).size).toBe(BAND_COUNT)
    expect(picked[0].rating).toBe(29)
  })
})
