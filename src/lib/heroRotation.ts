import type { Title } from '../types'
import { artworkToken, identityToken, stableHash } from './homeRotation'
import { isHiddenFromHome } from './hidden'

/** Movies the hero features per hourly rotation. */
export const HERO_ROTATION_SIZE = 10

/** One movie already featured, and the rotation that showed it. */
export interface HeroRotationEntry {
  id: number
  rotation: number
}

/** The hero pool: the Blockbusters set and nothing else. A poster that cannot
 *  render disqualifies a movie, because the hero has no room for generated
 *  artwork. */
export function heroCandidatePool(movies: readonly Title[]): Title[] {
  // `artworkToken` is the cached form of "does this poster render", so the
  // filter costs a WeakMap lookup instead of re-running the URL regexes over the
  // whole library every time the home page is built.
  const eligible = movies.filter(
    (movie) => movie.kind === 'movie' && !isHiddenFromHome(movie) && artworkToken(movie) !== 0,
  )
  const blockbusters = eligible
    .filter((movie) => movie.blockbuster)
    .sort(
      (a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
    )
  // A first screen arrives a category at a time, and the Blockbusters flag can
  // be twenty seconds behind the first poster. Holding the whole page on a
  // skeleton until then left Home blank while thousands of titles were already
  // in hand, so the best-rated artwork-bearing movies stand in until the set
  // itself lands — the same rule the hero already uses when a rotation runs dry.
  const candidates = blockbusters.length
    ? blockbusters
    : [...eligible].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.watchCount ?? 0) - (a.watchCount ?? 0))

  // The panel repeats the same film under several stream ids, so one movie is
  // one candidate.
  const seenIds = new Set<number>()
  const seenIdentities = new Set<number>()
  const seenArtwork = new Set<number>()
  const pool: Title[] = []
  for (const movie of candidates) {
    const artwork = artworkToken(movie)
    const identity = identityToken(movie)
    if (seenIds.has(movie.id) || seenIdentities.has(identity) || seenArtwork.has(artwork)) continue
    seenIds.add(movie.id)
    seenIdentities.add(identity)
    seenArtwork.add(artwork)
    pool.push(movie)
  }

  // A stable shuffle spreads both sections through the queue and keeps
  // consecutive rotations from walking the ranking in order, so every set of ten
  // reads as a curated line-up rather than "the next ten rows".
  return pool
    .map((movie) => ({ movie, key: stableHash(`hero:${movie.id}`) }))
    .sort((a, b) => a.key - b.key || a.movie.id - b.movie.id)
    .map((entry) => entry.movie)
}

/**
 * The hero line-up for one rotation: the next `limit` candidates that no earlier
 * rotation has featured. Picks already recorded for the current rotation are not
 * excluded, so the same movies stay on screen for the whole hour.
 */
export function selectHeroRotation(
  pool: readonly Title[],
  history: readonly HeroRotationEntry[],
  rotationIndex: number,
  limit = HERO_ROTATION_SIZE,
): Title[] {
  if (limit <= 0 || !pool.length) return []
  const shownEarlier = new Set<number>()
  for (const entry of history) {
    // A pick stamped with a later rotation means the clock moved backwards; it is
    // not something this rotation has shown.
    if (entry.rotation < rotationIndex) shownEarlier.add(entry.id)
  }
  const picks: Title[] = []
  for (const movie of pool) {
    if (picks.length >= limit) break
    if (shownEarlier.has(movie.id)) continue
    picks.push(movie)
  }
  return picks
}
