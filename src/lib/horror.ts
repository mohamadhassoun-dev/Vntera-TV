import type { Title } from '../types'

/** The panel's Horror Movies line-up, in the order it was asked for. The
 *  reseller's movie categories are provider-based (Netflix, Prime, …), so this
 *  list is what tells the catalogue a title is horror in the first place. */
export const HORROR_IDS = [44336, 16390, 297823, 44537, 44527, 44478] as const

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

/** Whether a catalogue title belongs to the requested genre. */
export function matchesGenre(title: Title, genre: string): boolean {
  if (genre === 'all') return true
  if (/^horror$/i.test(genre)) return isHorrorTitle(title)
  const wanted = genre.toLowerCase()
  return title.genres.some((g) => g.toLowerCase() === wanted)
}
