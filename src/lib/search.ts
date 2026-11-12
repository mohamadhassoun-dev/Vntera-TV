import type { CatalogSnapshot, Title } from '../types'
import { detectProvider, matchesQuality, stripNamePrefix } from './normalize'

export interface SearchFilters {
  kind: 'all' | 'movie' | 'series' | 'live'
  quality: 'all' | '4K' | 'FHD' | 'HD' | 'SD'
  language: 'all' | 'ar' | 'en' | 'fr'
  genre: 'all' | string
}

export const DEFAULT_FILTERS: SearchFilters = { kind: 'all', quality: 'all', language: 'all', genre: 'all' }

interface IndexEntry {
  title: Title
  haystack: string
  tokens: string[]
}

interface IndexState {
  movies: Title[]
  series: Title[]
  channels: Title[]
  counts: [number, number, number]
  entries: IndexEntry[]
}

let indexState: IndexState | null = null

function indexEntry(title: Title): IndexEntry {
  const haystack = `${title.name} ${title.genres.join(' ')} ${title.categoryName} ${title.year ?? ''} ${
    title.director ?? ''
  } ${title.cast.join(' ')}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return { title, haystack, tokens: haystack.split(' ').filter(Boolean) }
}

/**
 * The catalogue arrives in slices while the panel's three-megabyte lists are on
 * the wire, so this index grows with it: an unchanged catalogue costs a length
 * check, a grown one indexes only the new tail, and a replaced array (the
 * finished pull) starts it over.
 */
function buildIndex(catalog: CatalogSnapshot): IndexEntry[] {
  const pools = [catalog.movies, catalog.series, catalog.channels] as const
  const state = indexState
  if (state && state.movies === pools[0] && state.series === pools[1] && state.channels === pools[2]) {
    const [doneMovies, doneSeries, doneChannels] = state.counts
    if (doneMovies <= pools[0].length && doneSeries <= pools[1].length && doneChannels <= pools[2].length) {
      if (doneMovies < pools[0].length) {
        for (let i = doneMovies; i < pools[0].length; i += 1) state.entries.push(indexEntry(pools[0][i]))
      }
      if (doneSeries < pools[1].length) {
        for (let i = doneSeries; i < pools[1].length; i += 1) state.entries.push(indexEntry(pools[1][i]))
      }
      if (doneChannels < pools[2].length) {
        for (let i = doneChannels; i < pools[2].length; i += 1) state.entries.push(indexEntry(pools[2][i]))
      }
      state.counts = [pools[0].length, pools[1].length, pools[2].length]
      return state.entries
    }
  }
  const entries: IndexEntry[] = []
  for (const pool of pools) for (const title of pool) entries.push(indexEntry(title))
  indexState = {
    movies: pools[0],
    series: pools[1],
    channels: pools[2],
    counts: [pools[0].length, pools[1].length, pools[2].length],
    entries,
  }
  return entries
}

/**
 * Builds the whole index during the launch warm-up, in slices, so the first
 * keystroke in Search on a cached catalogue is a filter and nothing else.
 */
export async function warmSearchIndex(catalog: CatalogSnapshot): Promise<void> {
  const pools = [catalog.movies, catalog.series, catalog.channels] as const
  const entries: IndexEntry[] = []
  let sinceYield = 0
  for (const pool of pools) {
    for (const title of pool) {
      entries.push(indexEntry(title))
      if (++sinceYield >= 4000) {
        sinceYield = 0
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  }
  indexState = {
    movies: pools[0],
    series: pools[1],
    channels: pools[2],
    counts: [pools[0].length, pools[1].length, pools[2].length],
    entries,
  }
}

/** Client-side search over the cached catalog — instant, works offline, and
 *  deduplicated because the catalog only holds best-quality editions. */
export function searchContent(catalog: CatalogSnapshot | null, query: string, filters: SearchFilters = DEFAULT_FILTERS) {
  if (!catalog) return []
  const q = query.trim().toLowerCase()
  if (!q && filters.kind === 'all' && filters.quality === 'all' && filters.language === 'all' && filters.genre === 'all') {
    return []
  }

  const terms = q.split(/\s+/).filter(Boolean)
  const entries = buildIndex(catalog)
  const scored: Array<{ title: Title; score: number }> = []

  for (const { title, haystack, tokens } of entries) {
    if (filters.kind !== 'all' && title.kind !== filters.kind) continue
    if (!matchesQuality(title, filters.quality)) continue
    if (filters.language !== 'all' && !title.languages.includes(filters.language)) continue
    if (filters.genre !== 'all' && !title.genres.some((g) => g.toLowerCase() === filters.genre.toLowerCase())) continue

    let score = 0
    if (terms.length) {
      score = 0
      for (const term of terms) {
        const exact = title.cleanName === term
        const starts = title.cleanName.startsWith(term)
        const word = tokens.some((t) => t.startsWith(term))
        const contains = haystack.includes(term)
        if (!contains) {
          score = -1
          break
        }
        score += exact ? 60 : starts ? 40 : word ? 22 : 8
        if (title.kind === 'movie' || title.kind === 'series') score += 4
      }
      if (score < 0) continue
      score += Math.min(20, (title.rating ?? 0) * 2)
      score += title.hasArtwork ? 5 : 0
    }

    scored.push({ title, score })
  }

  scored.sort((a, b) => b.score - a.score || (b.title.rating ?? 0) - (a.title.rating ?? 0) || b.title.addedAt - a.title.addedAt)

  // Panel catalogs often carry the same film twice (with and without a year,
  // or one row per feed). Keep one result per normalized title name.
  const seen = new Set<string>()
  const unique: Title[] = []
  for (const { title } of scored) {
    const key =
      title.kind === 'live'
        ? `live:${title.id}`
        : `${title.kind}:${title.name
            .replace(/\((?:19|20)\d{2}\)/g, '')
            .replace(/[^a-z0-9]+/gi, ' ')
            .trim()
            .toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(title)
  }
  return unique
}

const CHANNEL_NOISE_RE = /\b(4k|uhd|fhd|hd|sd|hdr|hevc|h265|h264|raw|multi|arabic|english|french|ar|en|fr)\b/gi
const QUALITY_RANK: Record<Title['quality'], number> = { '4K': 4, FHD: 3, HD: 2, SD: 1 }

/** Strip leading feed labels ("AR:", "S|", "VIP PH:", "4K:") and quality noise. */
function cleanChannelName(channel: Title): string {
  let s = channel.name.trim()
  s = s.replace(/^(?:[^|:]{1,24}[|:]\s*)+/, '')
  s = stripNamePrefix(s)
  s = s.replace(CHANNEL_NOISE_RE, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Collapse "AR: AL JAZEERA", "AL JAZEERA 2", "ALJAZEERA WORLD" into one brand. */
export function channelBrandKey(channel: Title): string {
  const compact = cleanChannelName(channel)
    .replace(/[^a-z0-9\u0600-\u06FF]/gi, '')
    .toLowerCase()
  return compact.slice(0, 8) || 'channels'
}

export function channelBrandLabel(channels: Title[]): string {
  const names = channels
    .map((c) => cleanChannelName(c))
    .filter(Boolean)
    .sort((a, b) => a.length - b.length)
  const first = names[0] ?? 'Channels'
  return first.split(' ').slice(0, 2).join(' ').replace(/[|:–-]+$/, '').trim()
}

export function groupChannelsByBrand(channels: Title[]): Array<{ key: string; name: string; channels: Title[] }> {
  const groups = new Map<string, Title[]>()
  for (const channel of channels) {
    const key = channelBrandKey(channel)
    const list = groups.get(key) ?? []
    list.push(channel)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    name: channelBrandLabel(list),
    channels: [...list].sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality] || a.name.localeCompare(b.name)),
  }))
}

/**
 * Titles people actually look for, in preference order. Each one is only shown
 * when the catalogue really carries it — a chip must never open an empty result
 * page. The rest of the row fills with the most-watched titles the panel has.
 */
const TRENDING_NAMES = [
  'Fauda',
  'Venom',
  'The Batman',
  'Oppenheimer',
  'John Wick',
  'The Last of Us',
  'Wednesday',
  'Stranger Things',
  'Money Heist',
  'Breaking Bad',
  'Squid Game',
  'Dune',
  'Interstellar',
  'Peaky Blinders',
  'Game of Thrones',
  'The Walking Dead',
  'Prison Break',
  'The Godfather',
]

const cleanSearchName = (name: string) => name.replace(/\s*\[.*?\]\s*/g, '').trim()
const searchKey = (name: string) => cleanSearchName(name).toLowerCase()

/** Normalised search key per title, computed once: trending asks for it on every
 *  title of a 57k catalogue, once per curated name. */
const titleKeyCache = new WeakMap<Title, string>()

function searchKeyOf(title: Title): string {
  const cached = titleKeyCache.get(title)
  if (cached !== undefined) return cached
  const key = searchKey(title.name)
  titleKeyCache.set(title, key)
  return key
}

/**
 * Answers per catalogue, so opening Search a second time is free: this walks all
 * 57k titles, and Search is opened from a single tap in the header, so the scan
 * used to be the page's first paint.
 */
const trendingCache = new WeakMap<CatalogSnapshot, Map<number, string[]>>()

interface TrendingIndex {
  titles: Title[]
  sortedKeys: string[]
  byKey: Map<string, string>
}

const trendingIndexCache = new WeakMap<CatalogSnapshot, TrendingIndex>()

/**
 * The trending scan walks every title in the library, so it is built during the
 * catalogue warm-up — in slices, while the launch intro is on screen — instead
 * of on the tap that opens Search.
 */
export async function warmTrending(catalog: CatalogSnapshot): Promise<void> {
  await buildTrendingIndex(catalog, 6000)
  trendingSearches(catalog, 8)
}

async function buildTrendingIndex(catalog: CatalogSnapshot, slice?: number): Promise<TrendingIndex> {
  const cached = trendingIndexCache.get(catalog)
  if (cached) return cached
  const titles: Title[] = []
  const keys: string[] = []
  const byKey = new Map<string, string>()
  let sinceYield = 0
  const pools = [catalog.movies, catalog.series]
  for (const pool of pools) {
    for (const title of pool) {
      const key = searchKeyOf(title)
      if (key) {
        titles.push(title)
        keys.push(key)
        if (!byKey.has(key)) byKey.set(key, cleanSearchName(title.name))
      }
      if (slice && ++sinceYield >= slice) {
        sinceYield = 0
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  }
  const index: TrendingIndex = { titles, sortedKeys: keys.slice().sort(), byKey }
  trendingIndexCache.set(catalog, index)
  return index
}

/** The same index, built in one go for a Search page opened before warming ran. */
function buildTrendingIndexSync(catalog: CatalogSnapshot): TrendingIndex {
  const cached = trendingIndexCache.get(catalog)
  if (cached) return cached
  const titles: Title[] = []
  const keys: string[] = []
  const byKey = new Map<string, string>()
  for (const pool of [catalog.movies, catalog.series]) {
    for (const title of pool) {
      const key = searchKeyOf(title)
      if (!key) continue
      titles.push(title)
      keys.push(key)
      if (!byKey.has(key)) byKey.set(key, cleanSearchName(title.name))
    }
  }
  const index: TrendingIndex = { titles, sortedKeys: keys.slice().sort(), byKey }
  trendingIndexCache.set(catalog, index)
  return index
}

export function trendingSearches(catalog: CatalogSnapshot | null, limit = 8): string[] {
  if (!catalog) return []
  let byLimit = trendingCache.get(catalog)
  if (!byLimit) {
    byLimit = new Map()
    trendingCache.set(catalog, byLimit)
  }
  const cached = byLimit.get(limit)
  if (cached) return cached
  const picked = computeTrending(catalog, limit)
  byLimit.set(limit, picked)
  return picked
}

function computeTrending(catalog: CatalogSnapshot, limit: number): string[] {
  // The index is built once per catalogue (see warmTrending); the curated-name
  // scan below reads its sorted key list instead of running a regex per title
  // per curated name, which was three quarters of a million normalisations.
  const index = trendingIndexCache.get(catalog)
  const { titles, sortedKeys, byKey } = index ?? buildTrendingIndexSync(catalog)

  /** First title whose normalised name starts with `needle`. */
  const byPrefix = (needle: string): string | undefined => {
    let low = 0
    let high = sortedKeys.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sortedKeys[mid] < needle) low = mid + 1
      else high = mid
    }
    const key = sortedKeys[low]
    return key && key.startsWith(needle) ? byKey.get(key) : undefined
  }

  const picked: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    const key = searchKey(name)
    if (!key || seen.has(key) || picked.length >= limit) return
    seen.add(key)
    picked.push(cleanSearchName(name))
  }

  // A curated title matches on its whole name first, then on a prefix, so
  // "Venom" finds "Venom: The Last Dance" instead of being dropped.
  for (const wanted of TRENDING_NAMES) {
    const needle = wanted.toLowerCase()
    const exact = byKey.get(needle)
    if (exact) {
      add(exact)
      continue
    }
    const prefix = byPrefix(needle)
    if (prefix) add(prefix)
  }

  // Only the most watched few are needed, so the library is scanned once
  // instead of sorting all of it to read the first eight names.
  // A few spare names, because duplicates collapse into one chip below.
  const cap = Math.max(limit * 4, limit)
  const best: Title[] = []
  for (const title of titles) {
    let at = best.length
    while (at > 0) {
      const other = best[at - 1]
      const better =
        (title.watchCount ?? 0) > (other.watchCount ?? 0) ||
        ((title.watchCount ?? 0) === (other.watchCount ?? 0) && (title.rating ?? 0) > (other.rating ?? 0))
      if (!better) break
      at -= 1
    }
    if (at >= cap) continue
    best.splice(at, 0, title)
    if (best.length > cap) best.pop()
  }
  for (const title of best) {
    if (picked.length >= limit) break
    add(title.name)
  }

  return picked
}

export function groupProviders(titles: Title[]) {
  const map = new Map<string, Title[]>()
  for (const t of titles) {
    const p = t.provider === 'other' ? 'other' : t.provider
    const list = map.get(p) || []
    list.push(t)
    map.set(p, list)
  }
  return map
}

/** Group the catalog by provider for the home-page studio rails. */
export function providerRows(catalog: CatalogSnapshot | null, order: string[] = ['netflix', 'prime', 'shahid', 'disney', 'wwe']) {
  if (!catalog) return []
  const pool = [...catalog.movies, ...catalog.series]
  return order
    .map((provider) => ({
      provider,
      titles: pool
        .filter((t) => detectProvider(`${t.name} ${t.categoryName}`, t.categoryName) === provider)
        .slice(0, 160),
    }))
    .filter((row) => row.titles.length > 0)
}
