import type { Title } from '../types'
import { groupChannelFamilies, type ChannelFamily } from './channelFamilies'

const ARABIC_SCRIPT = /[\u0600-\u06FF]/
/** The panel names its Arabic rails up front: "AR - NEWS", "AR | Movies", "AR: Kids". */
const ARABIC_CATEGORY = /^\s*AR\b/i

/** A channel is Arabic when the panel files it under an AR section, tags it `ar`,
 *  or writes its name in Arabic script — panels do all three, inconsistently. */
export function isArabicChannel(channel: Title): boolean {
  if (channel.languages.includes('ar')) return true
  if (ARABIC_CATEGORY.test(channel.categoryName)) return true
  return ARABIC_SCRIPT.test(channel.name)
}

const cache = new WeakMap<readonly Title[], readonly ChannelFamily[]>()

/**
 * One card per Arabic broadcaster, best feed of each, so the grid shows twenty-one
 * different logos instead of five Al Jazeera feeds. Cards with real artwork sort
 * first; the rest still render generated art, so no tile is ever blank.
 */
export function arabicChannelFamilies(channels: readonly Title[]): readonly ChannelFamily[] {
  const cached = cache.get(channels)
  if (cached) return cached
  const arabic = channels.filter((channel) => channel.kind === 'live' && isArabicChannel(channel))
  const families = groupChannelFamilies(arabic).sort((a, b) => {
    const artwork = Number(Boolean(b.primary.poster)) - Number(Boolean(a.primary.poster))
    if (artwork) return artwork
    return a.label.localeCompare(b.label, 'ar')
  })
  cache.set(channels, families)
  return families
}
