import type { Title } from '../types'
import { artworkKey, isRenderableArtwork, stableHash, titleIdentity } from './homeRotation'
import { isHiddenFromHome } from './hidden'

/** Movies the hero features per three-day rotation. */
export const HERO_ROTATION_SIZE = 10

/** How deep into the Popular ranking the hero reaches. The ranking holds every
 *  title in the library, and the hero should feature what viewers actually open. */
const POPULAR_DEPTH = 500

/** One movie already featured, and the rotation that showed it. */
export interface HeroRotationEntry {
  id: number
  rotation: number
}

/** The hero pool: the Popular on Vntera ranking plus the Blockbusters set, and
 *  nothing else. A poster that cannot render disqualifies a movie, because the
 *  hero has no room for generated artwork. */
export function heroCandidatePool(movies: readonly Title[]): Title[] {
  const eligible = movies.filter(
    (movie) =>
      movie.kind === 'movie' &&
      !isHiddenFromHome(movie) &&
      movie.hasArtwork &&
      isRenderableArtwork(movie.poster),
  )
  const popular = [...eligible]
    .sort(
      (a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
    )
    .slice(0, POPULAR_DEPTH)
  const blockbusters = eligible.filter((movie) => movie.blockbuster)

  // The two sections overlap, and the panel repeats the same film under several
  // stream ids, so one movie is one candidate.
  const seenIds = new Set<number>()
  const seenIdentities = new Set<string>()
  const seenArtwork = new Set<string>()
  const pool: Title[] = []
  for (const movie of [...blockbusters, ...popular]) {
    const artwork = artworkKey(movie)
    const identity = titleIdentity(movie)
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
 * excluded, so the same ten movies stay on screen for the whole three days.
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
