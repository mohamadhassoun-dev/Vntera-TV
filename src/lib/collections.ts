import type { Title } from '../types'

export type CollectionSlug = 'kids' | 'anime'

export interface CollectionDefinition {
  slug: CollectionSlug
  label: string
  description: string
}

/** Panels label these sections in English and Arabic, so both are matched. */
const KIDS_PATTERN = /kid|kids|child|cartoon|كيدز|اطفال|أطفال|طفال|كارتون|كرتون|junior|baby|nick/i
const ANIME_PATTERN = /anime|انمي|أنمي|manga|مانجا/i

export const COLLECTIONS: Record<CollectionSlug, CollectionDefinition> = {
  kids: {
    slug: 'kids',
    label: 'Kids',
    description: 'Cartoon and kids-section titles only.',
  },
  anime: {
    slug: 'anime',
    label: 'Anime',
    description: 'Anime movies and series only.',
  },
}

export function isCollectionSlug(value: string | undefined): value is CollectionSlug {
  return value === 'kids' || value === 'anime'
}

const collectionCache = new WeakMap<Title, Partial<Record<CollectionSlug, boolean>>>()

export function matchesCollection(title: Title, slug: CollectionSlug): boolean {
  let answers = collectionCache.get(title)
  if (!answers) {
    answers = {}
    collectionCache.set(title, answers)
  }
  const known = answers[slug]
  if (known !== undefined) return known
  const haystack = `${title.categoryName} ${title.genres.join(' ')}`
  let value: boolean
  if (slug === 'anime') value = ANIME_PATTERN.test(haystack)
  // Anime has its own shortcut, so it is not repeated inside Kids.
  else value = KIDS_PATTERN.test(haystack) && !ANIME_PATTERN.test(haystack)
  answers[slug] = value
  return value
}

/** Answers both collection questions for a title, so a later home build is a
 *  cache read. Called in slices while the catalogue loads. */
export function warmCollectionTitle(title: Title): void {
  matchesCollection(title, 'kids')
  matchesCollection(title, 'anime')
}

export function collectionTitles(titles: readonly Title[], slug: CollectionSlug): Title[] {
  return titles.filter((title) => matchesCollection(title, slug))
}
