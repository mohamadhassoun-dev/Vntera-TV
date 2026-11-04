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

export function matchesCollection(title: Title, slug: CollectionSlug): boolean {
  const haystack = `${title.categoryName} ${title.genres.join(' ')}`
  if (slug === 'anime') return ANIME_PATTERN.test(haystack)
  // Anime has its own shortcut, so it is not repeated inside Kids.
  return KIDS_PATTERN.test(haystack) && !ANIME_PATTERN.test(haystack)
}

export function collectionTitles(titles: readonly Title[], slug: CollectionSlug): Title[] {
  return titles.filter((title) => matchesCollection(title, slug))
}
