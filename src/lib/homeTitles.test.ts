import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { selectHomeMovieTitles } from './homeTitles'

function movie(id: number, overrides: Partial<Title> = {}): Title {
  return {
    key: `movie:${id}`,
    kind: 'movie',
    id,
    name: `Movie ${id}`,
    cleanName: `movie ${id}`,
    genres: [],
    cast: [],
    quality: 'HD',
    languages: ['en'],
    editions: [],
    categoryId: 'movies',
    categoryName: 'Movies',
    addedAt: id,
    provider: 'shahid',
    hasArtwork: true,
    ...overrides,
  }
}

describe('selectHomeMovieTitles', () => {
  it('keeps recent titles first, appends unique trending titles, and caps at five', () => {
    const result = selectHomeMovieTitles(
      [movie(1), movie(2)],
      [movie(2), movie(3), movie(4), movie(5), movie(6)],
    )

    expect(result.map((title) => title.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('filters out non-movies and titles without artwork', () => {
    const result = selectHomeMovieTitles(
      [
        movie(1),
        movie(2, { kind: 'series' }),
        movie(3, { kind: 'live' }),
        movie(4, { hasArtwork: false }),
      ],
      [movie(5)],
    )

    expect(result.map((title) => title.id)).toEqual([1, 5])
  })

  it('returns all eligible titles when fewer than five exist, and none when empty', () => {
    expect(selectHomeMovieTitles([movie(1)], [movie(2)]).map((title) => title.id)).toEqual([1, 2])
    expect(selectHomeMovieTitles([], [])).toEqual([])
  })
})
