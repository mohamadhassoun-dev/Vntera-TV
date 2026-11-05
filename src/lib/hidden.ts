import type { Title } from '../types'

/**
 * Panel entries that must never surface on the home page.
 *
 * Keyed by the panel's stream id, which is what the app routes on. The title stays
 * reachable by direct link and through search; only the landing page drops it.
 * Add ids here when a provider entry does not belong on the home page.
 */
const HIDDEN_FROM_HOME = new Set<number>([
  52966, // WWE feature the panel lists among the English movies
])

export function isHiddenFromHome(title: Pick<Title, 'id'>): boolean {
  return HIDDEN_FROM_HOME.has(title.id)
}
