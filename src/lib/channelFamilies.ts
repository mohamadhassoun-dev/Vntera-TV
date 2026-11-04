import type { Quality, Title } from '../types'

const QUALITY_RANK: Record<Quality, number> = { '4K': 4, FHD: 3, HD: 2, SD: 1 }

/** Words that never identify a channel brand (quality tags, feed markers). */
const NOISE_TOKENS = new Set([
  'uhd',
  'fhd',
  'hd',
  'sd',
  '4k',
  '8k',
  'hdr',
  'hq',
  'plus',
  'premium',
  'live',
  'tv',
  'channel',
  'backup',
  'test',
  'arabic',
  'english',
  'french',
])

/** Brand of a channel name: "AL JAZEERA 2 UHD" and "ALJAZEERA" share one. */
export function channelFamilyKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const meaningful = tokens.filter((token) => !NOISE_TOKENS.has(token))
  if (!meaningful.length) return tokens.join(' ') || name.trim().toLowerCase()
  const [first, second] = meaningful
  // "AL JAZEERA" / "EL JAZEERA" must land on "aljazeera", not "al".
  if ((first === 'al' || first === 'el' || first === 'ال') && second) return `${first}${second}`
  return first
}

export interface ChannelFamily {
  key: string
  label: string
  /** Best member to show on the grid card: has artwork, then best quality. */
  primary: Title
  members: Title[]
}

function preferChannel(a: Title, b: Title): Title {
  const artA = a.hasArtwork && a.poster ? 1 : 0
  const artB = b.hasArtwork && b.poster ? 1 : 0
  if (artA !== artB) return artA > artB ? a : b
  const quality = QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]
  if (quality) return quality > 0 ? b : a
  if (a.name.length !== b.name.length) return a.name.length < b.name.length ? a : b
  return a.id < b.id ? a : b
}

/** Collapse duplicate feeds of one brand into a single family card. */
export function groupChannelFamilies(channels: readonly Title[]): ChannelFamily[] {
  const groups = new Map<string, Title[]>()
  for (const channel of channels) {
    const key = channelFamilyKey(channel.name)
    const bucket = groups.get(key)
    if (bucket) bucket.push(channel)
    else groups.set(key, [channel])
  }
  return [...groups.entries()].map(([key, members]) => {
    const primary = members.reduce(preferChannel)
    return { key, label: primary.name, primary, members }
  })
}

/** Short description of a feed variant, e.g. "4K · AR · AR - NEWS". */
export function channelVariantMeta(channel: Title): string {
  const parts: string[] = [channel.quality]
  const languages = channel.languages.filter((language) => language && language !== 'und')
  if (languages.length) parts.push(languages.map((language) => language.toUpperCase()).join('/'))
  if (channel.categoryName) parts.push(channel.categoryName)
  return parts.join(' · ')
}
