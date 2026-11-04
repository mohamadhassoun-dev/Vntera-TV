import type { Title } from '../types'

export function selectHomeMovieTitles(
  recent: readonly Title[],
  trending: readonly Title[],
  limit = 5,
): Title[] {
  if (limit <= 0) return []

  const selected: Title[] = []
  const seen = new Set<number>()

  for (const title of [...recent, ...trending]) {
    if (title.kind !== 'movie' || !title.hasArtwork || seen.has(title.id)) continue
    selected.push(title)
    seen.add(title.id)
    if (selected.length === limit) break
  }

  return selected
}
