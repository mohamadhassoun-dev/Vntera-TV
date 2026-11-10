import type { Title } from '../types'
import { arabicChannelLabel } from './arabicChannels'
import { channelFamilyKey } from './channelFamilies'
import { channelArtSrc } from './normalize'

/**
 * Live-channel feeds that sit next to the brand rows on Home.
 *
 * The panel groups channels by category, but these feeds are spread over a
 * dozen categories each (ZEE alone is filed under India, the UK, Egypt, the
 * UAE and Bangladesh), so they are collected as one brand family — the very
 * grouping the channel card's feed picker lists, which is why a family's rail
 * carries exactly the feeds that dialog offers (all seventeen MBC feeds, all
 * eighteen Netflix feeds, all one hundred and seventeen beIN feeds …).
 */
export interface LiveFeedDefinition {
  key: string
  /** Section heading on Home. */
  label: string
  /** Brand the rail collects, as keyed by `channelFamilyKey`. */
  familyKey: string
  /**
   * Logo shown for every card in the feed when a channel has no usable logo of
   * its own — including when its panel URL is dead. Fetched once from the
   * brand's published logo and shipped with the app, so it cannot go offline.
   */
  fallbackLogo: string
}

export const LIVE_FEEDS: readonly LiveFeedDefinition[] = [
  { key: 'zee-tv', label: 'ZEE TV', familyKey: 'zee', fallbackLogo: '/logos/feeds/zee-tv.jpg' },
  {
    key: 'tod-bein-events',
    label: 'TOD beIN EVENTS',
    familyKey: 'tod',
    fallbackLogo: '/logos/feeds/tod-bein-events.png',
  },
  {
    key: 'bein-hdr',
    label: 'BEIN HDR',
    familyKey: 'bein',
    fallbackLogo: '/logos/feeds/bein-hdr.png',
  },
  {
    key: 'shahid-tash',
    label: 'SHAHID',
    familyKey: 'shahid',
    fallbackLogo: '/logos/feeds/shahid-tash.png',
  },
  { key: 'mbc-tow', label: 'MBC', familyKey: 'mbc', fallbackLogo: '/logos/feeds/mbc-tow.png' },
  {
    key: 'spotify-kawa',
    label: 'SPOTIFY',
    familyKey: 'spotify',
    fallbackLogo: '/logos/feeds/spotify-kawa.png',
  },
  {
    key: 'netflix-kids',
    label: 'NetFlix',
    familyKey: 'netflix',
    fallbackLogo: '/logos/feeds/netflix-kids.png',
  },
] as const

export function feedDefinition(key: string): LiveFeedDefinition | undefined {
  return LIVE_FEEDS.find((feed) => feed.key === key)
}

/** Panel order first, then name, so numbered events read 1, 2, 3 … not 1, 10, 11. */
function compareChannels(a: Title, b: Title): number {
  const order = (a.num ?? a.id) - (b.num ?? b.id)
  if (order) return order
  return a.name.localeCompare(b.name)
}

/** Quality and section words: useless when deciding which channel a name means. */
const NOISE_TOKENS = new Set(['tv', 'hd', 'sd', 'fhd', 'uhd', '4k', '8k', 'hdr', 'channel', 'live'])

function nameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token && !/^\d+$/.test(token) && !NOISE_TOKENS.has(token))
  return new Set(tokens)
}

/**
 * Logos that are not images at all once the browser fetches them.
 *
 * Some panel entries point at a Google image-search thumbnail
 * (encrypted-tbn*.gstatic.com), which answers with a one-pixel spacer instead of
 * the logo, so the tile renders empty. Treating those as "no artwork" lets the
 * channel borrow a real logo from the same feed, which is the rule the feed
 * rails follow everywhere else.
 */
const BLANK_ART = /(?:encrypted-tbn\d*\.gstatic\.com|gstatic\.com\/images\?)/i

/** The channel's own logo, when it is a URL that actually paints. */
export function usableChannelArt(channel: Title): string | undefined {
  const src = channelArtSrc(channel)
  if (!src || src.startsWith('data:') || BLANK_ART.test(src)) return undefined
  return src
}

/**
 * The logo a channel without artwork borrows: the feed mate whose name shares
 * the most words with it, so "ZEE ALWAN Egypt" gets ZEE ALWAN's logo rather
 * than whichever ZEE feed happened to carry one.
 */
function borrowLogo(channel: Title, donors: readonly Title[]): string | undefined {
  if (!donors.length) return undefined
  const own = nameTokens(channel.name)
  let best: Title | undefined
  let bestScore = -1
  let bestTokens = Infinity
  for (const donor of donors) {
    const art = usableChannelArt(donor)
    if (!art) continue
    const tokens = nameTokens(donor.name)
    let score = 0
    for (const token of tokens) if (own.has(token)) score += 1
    // On a tie the plainest brand wins: "ZEE TV" lends its logo to the ZEE
    // channels that have none, not "ZEE PUNJABI" just because it comes first.
    if (score > bestScore || (score === bestScore && tokens.size < bestTokens)) {
      best = donor
      bestScore = score
      bestTokens = tokens.size
    }
  }
  return best ? usableChannelArt(best) : undefined
}

/**
 * Every feed of the brand, each one carrying an image.
 *
 * A channel without a logo borrows one from the closest-named channel in the
 * same feed; a feed where nothing has artwork shows the brand's own logo on all
 * its cards. The returned titles are copies, so the resolved artwork is used by
 * the card without touching the catalogue entry itself.
 */
export function pickFeedChannels(channels: readonly Title[], feed: LiveFeedDefinition): Title[] {
  // channelArtSrc re-applies the bundled logos, so a catalogue cached before a
  // logo was added still shows the right image without re-syncing the panel.
  const members = channels
    .filter(
      (channel) =>
        channel.kind === 'live' &&
        // Panel section tags ("|AR.MBC|", "AR: ") are not part of the brand, so
        // they are trimmed before keying — otherwise every tagged channel lands
        // in one meaningless "AR" family.
        channelFamilyKey(arabicChannelLabel(channel.name)) === feed.familyKey,
    )
    .sort(compareChannels)
  if (!members.length) return []
  const donors = members.filter((channel) => usableChannelArt(channel))
  const seen = new Set<number>()
  const out: Title[] = []
  for (const channel of members) {
    if (seen.has(channel.id)) continue
    seen.add(channel.id)
    const poster = usableChannelArt(channel) ?? borrowLogo(channel, donors) ?? feed.fallbackLogo
    out.push({ ...channel, poster, hasArtwork: true })
  }
  return out
}

const cache = new WeakMap<readonly Title[], Map<string, Title[]>>()

/** Every Home feed at once, cached per catalogue so back navigation stays instant. */
export function liveFeedChannels(channels: readonly Title[]): Map<string, Title[]> {
  const cached = cache.get(channels)
  if (cached) return cached
  const feeds = new Map<string, Title[]>()
  for (const feed of LIVE_FEEDS) feeds.set(feed.key, pickFeedChannels(channels, feed))
  cache.set(channels, feeds)
  return feeds
}
