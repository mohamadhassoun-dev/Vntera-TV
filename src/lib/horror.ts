import type { Title } from '../types'

/** The panel's Horror Movies line-up, in the order it was asked for. The
 *  reseller's movie categories are provider-based (Netflix, Prime, …), so this
 *  list is what tells the catalogue a title is horror in the first place. */
export const HORROR_IDS = [44336, 16390, 297823, 44537, 44527, 44478] as const

/** How many posters the homepage Horror carousel carries, laid out two rows deep. */
export const HORROR_COUNT = 24

const HORROR_IDSET = new Set<number>(HORROR_IDS)

/** Category or genre text that means horror in the panel's own vocabulary. */
const HORROR_TEXT = /horror|horreur|رعب|terror/i

/**
 * True for every title the catalogue can label horror: the curated line-up,
 * plus anything the panel or its metadata already tags as horror. A horror
 * category added to the panel later is picked up without a code change.
 */
export function isHorrorTitle(title: Title): boolean {
  if (HORROR_IDSET.has(title.id)) return true
  if (title.genres.some((genre) => HORROR_TEXT.test(genre))) return true
  return HORROR_TEXT.test(title.categoryName ?? '')
}

/**
 * The homepage Horror carousel: the curated line-up first, in the order it was
 * asked for, then the best-rated of everything else the catalogue labels horror
 * until the section is full.
 */
export function pickHorrorTitles(movies: readonly Title[]): Title[] {
  const byId = new Map(movies.map((movie) => [movie.id, movie]))
  const out: Title[] = []
  const seen = new Set<number>()
  for (const id of HORROR_IDS) {
    const movie = byId.get(id)
    if (!movie || seen.has(id)) continue
    seen.add(id)
    out.push(movie)
  }
  if (out.length >= HORROR_COUNT) return out.slice(0, HORROR_COUNT)
  const rest = movies
    .filter((movie) => !seen.has(movie.id) && isHorrorTitle(movie))
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        b.addedAt - a.addedAt ||
        a.id - b.id,
    )
  for (const movie of rest) {
    if (out.length >= HORROR_COUNT) break
    out.push(movie)
  }
  return out
}

/** Whether a catalogue title belongs to the requested genre. */
export function matchesGenre(title: Title, genre: string): boolean {
  if (genre === 'all') return true
  if (/^horror$/i.test(genre)) return isHorrorTitle(title)
  const wanted = genre.toLowerCase()
  return title.genres.some((g) => g.toLowerCase() === wanted)
}
