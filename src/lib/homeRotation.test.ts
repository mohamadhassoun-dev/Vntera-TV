import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Title } from '../types'
import {
  createArtworkUsage,
  scheduleNextRotationUpdate,
  scheduleNextUtcWeekUpdate,
  selectUniqueNewTitles,
  selectUniqueRailTitles,
  selectWeeklyMovieTitles,
  selectWeeklyNewTitles,
  utcRotationIndex,
  utcWeekIndex,
} from './homeRotation'

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

describe('hero hourly rotation', () => {
  it('advances once per hour and is identical across time zones', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0)
    const withinWindow = Date.UTC(2026, 0, 1, 0, 59, 59)
    expect(utcRotationIndex(new Date(withinWindow))).toBe(utcRotationIndex(new Date(start)))
    expect(utcRotationIndex(new Date(start + 60 * 60 * 1000))).toBe(
      utcRotationIndex(new Date(start)) + 1,
    )
  })

  it('fires the rotation timer on the next hour boundary', () => {
    vi.useFakeTimers()
    const onBoundary = vi.fn()
    const now = Date.UTC(2026, 5, 10, 12, 0, 0)
    const stop = scheduleNextRotationUpdate(onBoundary, now)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(onBoundary).toHaveBeenCalledTimes(1)
    stop()
    vi.useRealTimers()
  })
})

describe('weekly Home movie selection', () => {
  it('filters non-movies, artwork-less movies, and duplicate IDs before applying the limit', () => {
    const result = selectWeeklyMovieTitles(
      [
        movie(1),
        movie(2, { kind: 'series' }),
        movie(3, { kind: 'live' }),
        movie(4, { hasArtwork: false }),
        movie(1, { name: 'Duplicate movie' }),
        movie(5),
        movie(6),
      ],
      'provider-netflix',
      0,
      3,
    )

    expect(result).toHaveLength(3)
    expect(result.every((title) => title.kind === 'movie' && title.hasArtwork)).toBe(true)
    expect(new Set(result.map((title) => title.id)).size).toBe(3)
  })

  it('uses the same order within one week and advances its window in a later week', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => movie(index + 1))
    const first = selectWeeklyMovieTitles(candidates, 'top-ten', 12, 10)

    expect(selectWeeklyMovieTitles(candidates, 'top-ten', 12, 10).map((title) => title.id)).toEqual(
      first.map((title) => title.id),
    )
    expect(selectWeeklyMovieTitles(candidates, 'top-ten', 13, 10).map((title) => title.id)).not.toEqual(
      first.map((title) => title.id),
    )
  })

  it('shows a completely fresh page of titles in the following week', () => {
    const candidates = Array.from({ length: 48 }, (_, index) => movie(index + 1))
    const first = selectWeeklyMovieTitles(candidates, 'provider-netflix', 20, 24).map((title) => title.id)
    const second = selectWeeklyMovieTitles(candidates, 'provider-netflix', 21, 24).map((title) => title.id)

    expect(first).toHaveLength(24)
    expect(second).toHaveLength(24)
    expect(first.filter((id) => second.includes(id))).toEqual([])
  })

  it('eventually includes every candidate when a pool is larger than its weekly window', () => {
    const candidates = Array.from({ length: 27 }, (_, index) => movie(index + 1))
    const seen = new Set<number>()

    for (let week = 0; week < candidates.length; week++) {
      for (const title of selectWeeklyMovieTitles(candidates, 'blockbusters', week, 8)) seen.add(title.id)
    }

    expect(seen).toEqual(new Set(candidates.map((title) => title.id)))
  })

  it('keeps recent movies first and fills remaining slots from unique trending movies', () => {
    const result = selectWeeklyNewTitles([movie(1), movie(2)], [movie(2), movie(3), movie(4), movie(5)], 0, 4)

    expect(result.slice(0, 2).map((title) => title.id)).toEqual([1, 2])
    expect(result).toHaveLength(4)
    expect(new Set(result.map((title) => title.id)).size).toBe(4)
  })

  it('returns all eligible titles for a sparse pool and none for an invalid limit', () => {
    expect(selectWeeklyMovieTitles([movie(1), movie(2)], 'popular', 1, 24)).toHaveLength(2)
    expect(selectWeeklyMovieTitles([movie(1)], 'popular', 1, 0)).toEqual([])
    expect(selectWeeklyMovieTitles([movie(1)], 'popular', 1, Number.POSITIVE_INFINITY)).toEqual([])
    expect(selectWeeklyMovieTitles([], 'provider-netflix', 1)).toEqual([])
  })

  it('skips titles whose poster URL is truncated or unusable', () => {
    const result = selectWeeklyMovieTitles(
      [
        movie(1, { poster: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2' }),
        movie(2, { poster: 'https://cdn.example.com/images/2.jpg' }),
        movie(3, { poster: 'https://cdn.example.com/images/3' }),
        movie(4, { poster: 'https://cdn.example.com/images/4.jpg?format=jpg' }),
      ],
      'provider-netflix',
      0,
      24,
    )

    expect(result.map((title) => title.id).sort()).toEqual([2, 4])
  })

  it('never shows the same poster image twice, even for different movies', () => {
    const shared = 'https://cdn.example.com/posters/shared.jpg'
    const result = selectWeeklyMovieTitles(
      [movie(1, { poster: shared }), movie(2, { poster: shared }), movie(3), movie(4)],
      'provider-shahid',
      3,
      24,
    )

    expect(result.filter((title) => title.poster === shared)).toHaveLength(1)
    expect(result.map((title) => title.id).sort()).toEqual([1, 3, 4])
  })

  it('does not repeat a title, an edition, or its artwork across rails sharing usage', () => {
    const usage = createArtworkUsage()
    const pool = Array.from({ length: 40 }, (_, index) => movie(index + 1))
    const duplicates = [movie(100, { name: 'Movie 1 (4K)', poster: 'https://cdn.example.com/posters/1-alt.jpg' })]

    const first = selectUniqueRailTitles([...pool, ...duplicates], 'provider-netflix', 4, 12, usage)
    const second = selectUniqueRailTitles([...pool, ...duplicates], 'blockbusters', 4, 12, usage)
    const shown = [...first, ...second]

    expect(first).toHaveLength(12)
    expect(second).toHaveLength(12)
    expect(shown.filter((title) => title.id === 100)).toHaveLength(0)
    expect(new Set(shown.map((title) => title.id)).size).toBe(24)
    expect(new Set(shown.map((title) => title.poster)).size).toBe(24)
    expect(shown.some((title) => title.name.startsWith('Movie 1'))).toBe(true)
  })

  it('records a rail\u2019s picks so the next rail starts on fresh artwork', () => {
    const usage = createArtworkUsage()
    const pool = Array.from({ length: 10 }, (_, index) => movie(index + 1))
    const first = selectUniqueRailTitles(pool, 'hero', 1, 5, usage)
    const second = selectUniqueRailTitles(pool, 'popular', 1, 24, usage)

    expect(first).toHaveLength(5)
    expect(second).toHaveLength(5)
    expect(second.some((title) => first.some((picked) => picked.id === title.id))).toBe(false)
  })

  it('keeps recent-first "New on Vntera" selections unique when usage is shared', () => {
    const usage = createArtworkUsage()
    selectUniqueRailTitles([movie(1), movie(2)], 'provider-netflix', 0, 2, usage)
    const result = selectUniqueNewTitles([movie(1), movie(2)], [movie(3), movie(4)], 0, 4, usage)

    expect(result.map((title) => title.id)).toEqual([3, 4])
  })

  it('uses Monday-based UTC weeks across a year boundary', () => {
    expect(utcWeekIndex(new Date('2026-12-31T23:59:59.999Z'))).not.toBe(
      utcWeekIndex(new Date('2027-01-04T00:00:00.000Z')),
    )
    expect(utcWeekIndex(new Date('2027-01-04T00:00:00.000Z'))).toBe(
      utcWeekIndex(new Date('2027-01-10T23:59:59.999Z')),
    )
  })
})

describe('scheduleNextUtcWeekUpdate', () => {
  afterEach(() => vi.useRealTimers())

  it('fires at the next Monday 00:00 UTC and can be cancelled', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-11-08T23:59:59.999Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    vi.advanceTimersByTime(0)
    expect(onBoundary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onBoundary).toHaveBeenCalledTimes(1)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending boundary update when cleaned up early', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-12-31T12:00:00.000Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    cleanup()
    vi.runOnlyPendingTimers()
    expect(onBoundary).not.toHaveBeenCalled()
  })

  it('schedules the first Monday of the new year when the current date is in December', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-12-31T23:59:59.999Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(onBoundary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onBoundary).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
