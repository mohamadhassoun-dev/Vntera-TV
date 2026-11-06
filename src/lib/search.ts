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

let indexCache: { key: string; entries: IndexEntry[] } | null = null

function buildIndex(catalog: CatalogSnapshot): IndexEntry[] {
  const key = `${catalog.account}:${catalog.builtAt}`
  if (indexCache?.key === key) return indexCache.entries
  const all: Title[] = [...catalog.movies, ...catalog.series, ...catalog.channels]
  const entries = all.map((title) => {
    const haystack = `${title.name} ${title.genres.join(' ')} ${title.categoryName} ${title.year ?? ''} ${
      title.director ?? ''
    } ${title.cast.join(' ')}`
      .toLowerCase()
      .replace(/\s+/g, ' ')
    return { title, haystack, tokens: haystack.split(' ').filter(Boolean) }
  })
  indexCache = { key, entries }
  return entries
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

export function trendingSearches(catalog: CatalogSnapshot | null, limit = 8): string[] {
  if (!catalog) return []
  const pool = [...catalog.movies, ...catalog.series]
  const byKey = new Map<string, string>()
  for (const title of pool) {
    const key = searchKey(title.name)
    if (key && !byKey.has(key)) byKey.set(key, cleanSearchName(title.name))
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
    const exact = byKey.get(wanted.toLowerCase())
    if (exact) {
      add(exact)
      continue
    }
    const prefix = pool.find((title) => searchKey(title.name).startsWith(wanted.toLowerCase()))
    if (prefix) add(prefix.name)
  }

  const popular = [...pool]
    .sort((a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
  for (const title of popular) {
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
