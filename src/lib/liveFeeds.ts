import type { Title } from '../types'
import { channelArtSrc } from './normalize'

/**
 * Live-channel feeds that sit next to the brand rows on Home.
 *
 * The panel groups channels by category, but these seven feeds are spread over
 * a dozen categories each (ZEE alone is filed under India, the UK, Egypt, the
 * UAE and Bangladesh), so they are picked by name instead. That
 * is also what keeps them current: a channel the panel adds to one of these
 * feeds tomorrow shows up without a code change or a stream id.
 */
export interface LiveFeedDefinition {
  key: string
  /** Section heading on Home. */
  label: string
  /** Channel names that belong to the feed. */
  match: RegExp
  /**
   * Logo shown for every card in the feed when a channel has no usable logo of
   * its own — including when its panel URL is dead. Fetched once from the
   * brand's published logo and shipped with the app, so it cannot go offline.
   */
  fallbackLogo: string
}

export const LIVE_FEEDS: readonly LiveFeedDefinition[] = [
  { key: 'zee-tv', label: 'ZEE TV', match: /\bzee\b/i, fallbackLogo: '/logos/feeds/zee-tv.jpg' },
  {
    key: 'tod-bein-events',
    label: 'TOD beIN EVENTS',
    match: /\btod\s+be?in\s+events\b/i,
    fallbackLogo: '/logos/feeds/tod-bein-events.png',
  },
  {
    key: 'bein-hdr',
    label: 'BEIN HDR',
    match: /\bbe?in\b.*\bhdr\b/i,
    fallbackLogo: '/logos/feeds/bein-hdr.png',
  },
  {
    key: 'shahid-tash',
    label: 'SHAHID TASH',
    match: /shahid\s*tash/i,
    fallbackLogo: '/logos/feeds/shahid-tash.png',
  },
  {
    key: 'mbc-tow',
    label: 'MBC TOW',
    match: /\bmbc\b.*\btow\b/i,
    fallbackLogo: '/logos/feeds/mbc-tow.png',
  },
  {
    key: 'spotify-kawa',
    label: 'SPOTIFY Kawa',
    match: /spotify\s*kawa/i,
    fallbackLogo: '/logos/feeds/spotify-kawa.png',
  },
  {
    key: 'netflix-kids',
    label: 'NetFlix Kids',
    match: /netflix\s*kids/i,
    fallbackLogo: '/logos/feeds/netflix-kids.png',
  },
] as const

/** How many channels a Home feed rail carries. */
export const FEED_LIMIT = 24

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
  return best ? channelArtSrc(best) : undefined
}

/**
 * The feed's channels, every one of them carrying an image.
 *
 * A channel without a logo borrows one from the closest-named channel in the
 * same feed; a feed where nothing has artwork shows the brand's own logo on all
 * its cards. The returned titles are copies, so the resolved artwork is used by
 * the card without touching the catalogue entry itself.
 */
export function pickFeedChannels(
  channels: readonly Title[],
  feed: LiveFeedDefinition,
  limit = FEED_LIMIT,
): Title[] {
  const members = channels
    .filter((channel) => channel.kind === 'live' && feed.match.test(channel.name))
    .sort(compareChannels)
  if (!members.length) return []
  // channelArtSrc re-applies the bundled logos, so a catalogue cached before a
  // logo was added still shows the right image without re-syncing the panel.
  const donors = members.filter((channel) => channelArtSrc(channel))
  const seen = new Set<number>()
  const out: Title[] = []
  for (const channel of members) {
    if (seen.has(channel.id)) continue
    seen.add(channel.id)
    const poster = channelArtSrc(channel) ?? borrowLogo(channel, donors) ?? feed.fallbackLogo
    out.push({ ...channel, poster, hasArtwork: true })
    if (out.length >= limit) break
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
