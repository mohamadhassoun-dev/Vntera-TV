import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { HERO_ROTATION_SIZE, heroCandidatePool, selectHeroRotation } from './heroRotation'

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
    provider: 'other',
    poster: `https://cdn.example.com/posters/${id}.jpg`,
    hasArtwork: true,
    ...overrides,
  }
}

const pool = (count: number) => Array.from({ length: count }, (_, index) => movie(index + 1))

describe('hero rotation', () => {
  it('draws only from the popular ranking and the blockbuster set', () => {
    const movies = [
      ...Array.from({ length: 600 }, (_, index) => movie(index + 1, { watchCount: 10_000 - index })),
      movie(900, { blockbuster: true, watchCount: 0 }),
      movie(901, { blockbuster: true, watchCount: 0 }),
      movie(902, { watchCount: 0 }),
    ]
    const candidates = heroCandidatePool(movies)
    const ids = new Set(candidates.map((title) => title.id))
    expect(ids.has(900)).toBe(true)
    // Ranked below the depth the hero reads, and not a blockbuster.
    expect(ids.has(902)).toBe(false)
    expect(candidates.length).toBeGreaterThan(HERO_ROTATION_SIZE)
  })

  it('keeps movies without a usable poster out of the hero', () => {
    const candidates = heroCandidatePool([
      movie(1, { poster: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2' }),
      movie(2, { poster: undefined, hasArtwork: false }),
      movie(3, { poster: 'https://cdn.example.com/no-image.jpg' }),
      movie(4),
    ])
    expect(candidates.map((title) => title.id)).toEqual([4])
  })

  it('serves ten movies, then ten different ones on the next rotation', () => {
    const candidates = pool(40)
    const first = selectHeroRotation(candidates, [], 100)
    expect(first).toHaveLength(10)

    const history = first.map((title) => ({ id: title.id, rotation: 100 }))
    const second = selectHeroRotation(candidates, history, 101)
    expect(second).toHaveLength(10)
    expect(second.some((title) => first.some((seen) => seen.id === title.id))).toBe(false)
  })

  it('keeps the same line-up for the whole three days', () => {
    const candidates = pool(40)
    const picks = selectHeroRotation(candidates, [], 100)
    // Recording the picks happens after the first paint and must not shuffle them.
    const recorded = picks.map((title) => ({ id: title.id, rotation: 100 }))
    expect(selectHeroRotation(candidates, recorded, 100).map((title) => title.id)).toEqual(
      picks.map((title) => title.id),
    )
  })

  it('never repeats a movie shown in any earlier rotation', () => {
    const candidates = pool(30)
    const history: Array<{ id: number; rotation: number }> = []
    const seen = new Set<number>()
    for (let rotation = 0; rotation < 3; rotation++) {
      const picks = selectHeroRotation(candidates, history, rotation)
      for (const title of picks) {
        expect(seen.has(title.id)).toBe(false)
        seen.add(title.id)
      }
      history.push(...picks.map((title) => ({ id: title.id, rotation })))
    }
    expect(seen.size).toBe(30)
  })

  it('returns what is left when the pool runs dry', () => {
    const candidates = pool(3)
    const picks = selectHeroRotation(candidates, [], 1)
    expect(picks).toHaveLength(3)
    const history = picks.map((title) => ({ id: title.id, rotation: 1 }))
    expect(selectHeroRotation(candidates, history, 2)).toEqual([])
  })
})
