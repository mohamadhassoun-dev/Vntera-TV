import type { Provider, Quality, RawCategory, RawLiveStream, RawSeries, RawVodStream, Title } from '../types'
import { CHANNEL_ART, FEATURED_CHANNELS } from './config'
import { BANDS, matchesBandName } from './genreBands'

const QUALITY_PATTERNS: Array<{ q: Quality; re: RegExp }> = [
  { q: '4K', re: /(\b|\[|\()(4k|uhd|2160p?|hdr10?\+?|dolby\s?vision|dv)(\b|\]|\))/i },
  { q: 'FHD', re: /(\b|\[|\()(fhd|1080p?|full\s?hd)(\b|\]|\))/i },
  { q: 'HD', re: /(\b|\[|\()(hd|720p?|hq)(\b|\]|\))/i },
  { q: 'SD', re: /(\b|\[|\()(sd|480p?|360p?|ld)(\b|\]|\))/i },
]

const LANGUAGE_PATTERNS: Array<{ code: string; re: RegExp }> = [
  { code: 'ar', re: /(\b|\[|\()(ar|arabic|عربي|arab)(\b|\]|\))/i },
  { code: 'en', re: /(\b|\[|\()(en|eng|english)(\b|\]|\))/i },
  { code: 'fr', re: /(\b|\[|\()(fr|fre|french|vf)(\b|\]|\))/i },
  { code: 'tr', re: /(\b|\[|\()(tr|turkish|türkçe)(\b|\]|\))/i },
  { code: 'es', re: /(\b|\[|\()(es|spanish|latino)(\b|\]|\))/i },
  { code: 'hi', re: /(\b|\[|\()(hi|hindi)(\b|\]|\))/i },
  { code: 'multi', re: /(\b|\[|\()(multi|multisub|dubbed|subbed)(\b|\]|\))/i },
]

const PROVIDER_PATTERNS: Array<{ p: Provider; re: RegExp }> = [
  { p: 'netflix', re: /\b(netflix|nf)\b/i },
  { p: 'prime', re: /\b(prime\s?video|amazon\s?prime|prime|amzn)\b/i },
  { p: 'shahid', re: /\b(shahid|shahidvip)\b/i },
  { p: 'disney', re: /\b(disney\+?|disney\s?plus|hotstar)\b/i },
  { p: 'wwe', re: /\b(wwe|wwe\s?network|raw|smackdown)\b/i },
  { p: 'apple', re: /\b(apple\s?tv\+?|atv\+?)\b/i },
  { p: 'hbo', re: /\b(hbo|max|hbo\s?max)\b/i },
  { p: 'osn', re: /\b(osn)\b/i },
]

/** Strip country/provider prefixes such as "AR: ", "NF | " or "DE - ". */
export function stripNamePrefix(name: string): string {
  let s = name.trim()
  s = s.replace(/^(?:[A-Za-z]{1,4}\s*[|:\-]\s*)+/, '')
  s = s.replace(
    /^(?:netflix|nf|prime(?:\s*video)?|amazon(?:\s*prime)?|shahid|disney\+?|osn|hbo(?:\s*max)?|apple\s*tv\+?|wwe)\s*[|:\-]\s*/i,
    '',
  )
  return s.trim() || name.trim()
}

/** Group titles that only differ by edition tags, e.g. "Dune 4K AR" / "Dune HD". */
export function baseTitle(name: string): string {
  let s = ` ${stripNamePrefix(name)} `
  s = s.replace(/[\[\](){}]/g, ' ')
  s = s.replace(
    /(\b|_)(4k|uhd|2160p?|1080p?|720p?|480p?|fhd|full\s?hd|hd|sd|hdr10?\+?|dolby\s?vision|hevc|h265|h264|x264|x265|multi|multisub|dubbed|subbed|arabic|english|french|ar|en|fr|tr|es|hi|raw|remux|web-?dl|bluray)(\b|_)/gi,
    ' ',
  )
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*[-:|]\s*$/, '').trim()
  return s || name.trim()
}

export function detectQuality(name: string): Quality {
  for (const { q, re } of QUALITY_PATTERNS) if (re.test(name)) return q
  return 'SD'
}

export function detectLanguages(name: string): string[] {
  const found = new Set<string>()
  for (const { code, re } of LANGUAGE_PATTERNS) if (re.test(name)) found.add(code)
  if (!found.size) found.add('und')
  return [...found]
}

export function detectProvider(name: string, category = ''): Provider {
  for (const { p, re } of PROVIDER_PATTERNS) if (re.test(name) || re.test(category)) return p
  return 'other'
}

export function parseYear(name: string, fallback?: string | number): number | undefined {
  const direct = fallback != null ? Number(fallback) : NaN
  if (Number.isFinite(direct) && direct > 1900 && direct < 2100) return direct
  const m = name.match(/\b(19\d{2}|20\d{2})\b/)
  return m ? Number(m[1]) : undefined
}

export function toRating(value?: string | number): number | undefined {
  if (value == null) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  // Panels mix 5-based and 10-based ratings.
  return n <= 5 ? Math.round(n * 2 * 10) / 10 : Math.round(n * 10) / 10
}

export function parseDurationSeconds(value?: string): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value)) {
    const n = Number(value)
    return n > 100000 ? Math.round(n / 1000) : n
  }
  const m = value.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i)
  if (m) return Number(m[1]) * 3600 + (m[2] ? Number(m[2]) * 60 : 0)
  const mm = value.match(/^(\d+)\s*m(?:in)?/i)
  if (mm) return Number(mm[1]) * 60
  return undefined
}

export function splitList(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[,/|]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'n/a')
    .slice(0, 12)
}

export function epochSeconds(value?: string | number): number {
  if (!value) return 0
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n > 10_000_000_000 ? Math.round(n / 1000) : Math.round(n)
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : 0
}

export function isUsableImage(url?: string): boolean {
  if (!url) return false
  const u = url.trim().toLowerCase()
  if (!u.startsWith('http') && !u.startsWith('data:image')) return false
  if (/(no[-_]?image|noimage|placeholder|dummy|default[-_]?poster|nophoto|blank\.(png|jpg))/.test(u)) return false
  return true
}

/** Clean a raw name for display: strip edition tags but keep the title itself. */
export function displayName(name: string): string {
  let s = stripNamePrefix(name).replace(/\s*[\[(](4k|uhd|fhd|hd|sd|2160p|1080p|720p|hdr10?\+?|hevc|multi|ar|en|fr|tr)[\])]\s*/gi, ' ')
  const trailing =
    /\s+(4k|uhd|fhd|full\s?hd|hd|sd|2160p|1080p|720p|480p|hdr10?\+?|hevc|multi(?:sub)?|ar|en|fr|tr|arabic|english|french)$/i
  let previous = ''
  while (previous !== s) {
    previous = s
    s = s.replace(trailing, '')
  }
  return s.replace(/\s{2,}/g, ' ').trim() || name.trim()
}

interface BuildInput {
  account: string
  live: RawLiveStream[]
  vod: RawVodStream[]
  seriesRaw: RawSeries[]
  categories: { live: RawCategory[]; vod: RawCategory[]; series: RawCategory[] }
  demo?: boolean
  watchCounts?: Record<string, number>
}

function categoryLookup(cats: RawCategory[]) {
  const map = new Map<string, string>()
  for (const c of cats) map.set(String(c.category_id), c.category_name)
  return map
}

function bestEdition(a: Title['editions'][number], b: Title['editions'][number]) {
  const order: Record<Quality, number> = { '4K': 4, FHD: 3, HD: 2, SD: 1 }
  return order[a.quality] - order[b.quality]
}

/** One selectable edition per distinct quality/language combination. */
export function uniqueEditions(editions: Title['editions']): Title['editions'] {
  const map = new Map<string, Title['editions'][number]>()
  for (const e of editions) {
    const langs = e.languages.filter((l) => l && l !== 'und')
    const key = `${e.quality}|${langs.join(',')}`
    if (!map.has(key)) map.set(key, e)
  }
  return [...map.values()]
}

/** Merge duplicate editions into a single browsable title. */
function reduceEditions(titles: Title[]): Title {
  const sorted = [...titles].sort((a, b) => bestEdition(b.editions[0], a.editions[0]) || b.addedAt - a.addedAt)
  const best = { ...sorted[0] }
  const editions = new Map<number, Title['editions'][number]>()
  for (const t of sorted) for (const e of t.editions) editions.set(e.streamId, e)
  best.editions = [...editions.values()].sort(bestEdition)
  best.languages = [...new Set(sorted.flatMap((t) => t.languages))].filter(Boolean)
  best.poster = sorted.find((t) => isUsableImage(t.poster))?.poster
  best.backdrop = sorted.find((t) => isUsableImage(t.backdrop))?.backdrop
  best.plot = sorted.find((t) => t.plot)?.plot
  best.trailer = sorted.find((t) => t.trailer)?.trailer
  best.rating = sorted.find((t) => t.rating)?.rating
  best.durationSec = sorted.find((t) => t.durationSec)?.durationSec
  best.hasArtwork = isUsableImage(best.poster) || isUsableImage(best.backdrop)
  return best
}

interface BuildContext {
  liveCats: Map<string, string>
  vodCats: Map<string, string>
  seriesCats: Map<string, string>
  counts: Record<string, number>
}

function buildContext(input: BuildInput): BuildContext {
  return {
    liveCats: categoryLookup(input.categories.live),
    vodCats: categoryLookup(input.categories.vod),
    seriesCats: categoryLookup(input.categories.series),
    counts: input.watchCounts || {},
  }
}

function bucket(map: Map<string, Title[]>, key: string, title: Title): void {
  const existing = map.get(key)
  if (existing) existing.push(title)
  else map.set(key, [title])
}

/**
 * Normalising ~46k titles used to run as one synchronous pass. On a phone that
 * is several seconds in which nothing paints, which is what made a cold launch
 * look frozen. The same work is cut into slices that hand the frame back to the
 * browser between them, so the page stays alive while the library is indexed.
 */
const SLICE = 900

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function liveEntry(ch: RawLiveStream, ctx: BuildContext): [string, Title] {
  const { liveCats, counts } = ctx
  {
    const name = displayName(ch.name)
    const key = baseTitle(name).toLowerCase()
    const categoryId = String(ch.category_id ?? '0')
    const categoryName = liveCats.get(categoryId) || 'Uncategorised'
    const quality = detectQuality(ch.name)
    const languages = detectLanguages(ch.name)
    const poster = CHANNEL_ART[ch.stream_id] ?? (isUsableImage(ch.stream_icon) ? ch.stream_icon : undefined)
    const title: Title = {
      key: `live:${key}`,
      kind: 'live',
      id: ch.stream_id,
      name,
      cleanName: key,
      quality,
      languages,
      editions: [
        {
          streamId: ch.stream_id,
          quality,
          languages,
          label: `${quality} · ${languages.map((l) => l.toUpperCase()).join('/')}`,
          addedAt: epochSeconds(ch.added),
        },
      ],
      categoryId,
      categoryName,
      addedAt: epochSeconds(ch.added),
      poster,
      hasArtwork: !!poster,
      provider: detectProvider(ch.name, categoryName),
      epgChannelId: ch.epg_channel_id,
      tvArchive: Number(ch.tv_archive) || 0,
      num: Number(ch.num) || ch.stream_id,
      genres: [categoryName],
      cast: [],
      watchCount: counts[`live:${ch.stream_id}`] || 0,
    }
    return [key, title]
  }
}

function movieEntry(m: RawVodStream, ctx: BuildContext): [string, Title] {
  const { vodCats, counts } = ctx
  {
    const name = displayName(m.name)
    const key = `${baseTitle(name).toLowerCase()}|${parseYear(m.name, m.year) ?? ''}`
    const categoryId = String(m.category_id ?? '0')
    const categoryName = vodCats.get(categoryId) || 'Movies'
    const quality = detectQuality(m.name)
    const languages = detectLanguages(m.name)
    const addedAt = epochSeconds(m.added)
    const poster = isUsableImage(m.stream_icon) ? m.stream_icon : undefined
    const title: Title = {
      key: `movie:${key}`,
      kind: 'movie',
      id: m.stream_id,
      name,
      cleanName: key,
      year: parseYear(m.name, m.year),
      rating: toRating(m.rating ?? m.rating_5based),
      quality,
      languages,
      editions: [
        {
          streamId: m.stream_id,
          quality,
          languages,
          container: m.container_extension || 'mp4',
          label: `${quality} · ${languages.map((l) => l.toUpperCase()).join('/')}`,
          addedAt,
        },
      ],
      categoryId,
      categoryName,
      addedAt,
      poster,
      hasArtwork: !!poster,
      provider: detectProvider(m.name, categoryName),
      genres: [categoryName],
      cast: [],
      watchCount: counts[`movie:${m.stream_id}`] || 0,
    }
    return [key.toUpperCase(), title]
  }
}

function seriesEntry(s: RawSeries, ctx: BuildContext): [string, Title] {
  const { seriesCats, counts } = ctx
  {
    const name = displayName(s.name)
    const key = baseTitle(name).toLowerCase()
    const categoryId = String(s.category_id ?? '0')
    const categoryName = seriesCats.get(categoryId) || 'Series'
    const quality = detectQuality(s.name)
    const languages = detectLanguages(s.name)
    const backdrop = Array.isArray(s.backdrop_path) ? s.backdrop_path[0] : s.backdrop_path
    const poster = isUsableImage(s.cover) ? s.cover : undefined
    const title: Title = {
      key: `series:${s.series_id}`,
      kind: 'series',
      id: s.series_id,
      name,
      cleanName: key,
      year: parseYear(name, s.releaseDate?.slice(0, 4)),
      rating: toRating(s.rating ?? s.rating_5based),
      quality,
      languages,
      editions: [
        {
          streamId: s.series_id,
          quality,
          languages,
          label: `${quality} · ${languages.map((l) => l.toUpperCase()).join('/')}`,
          addedAt: epochSeconds(s.last_modified),
          seriesId: s.series_id,
        },
      ],
      categoryId,
      categoryName,
      addedAt: epochSeconds(s.last_modified),
      poster,
      backdrop: isUsableImage(backdrop) ? backdrop : undefined,
      hasArtwork: !!poster,
      provider: detectProvider(s.name, categoryName),
      genres: splitList(s.genre).length ? splitList(s.genre) : [categoryName],
      cast: splitList(s.cast),
      director: s.director,
      plot: s.plot,
      trailer: s.youtube_trailer || undefined,
      episodeRunTime: s.episode_run_time,
      watchCount: counts[`series:${s.series_id}`] || 0,
    }
    return [key, title]
  }
}

function finish(movies: Title[]) {
  for (const m of movies) {
    if (m.rating && m.rating >= 8 && m.addedAt > 0) m.blockbuster = true
    if (m.genres.some((g) => /vntera\s?original/i.test(g))) m.vnteraOriginal = true
  }
  return movies
}

export function buildCatalog(input: BuildInput) {
  const ctx = buildContext(input)
  const channelTitles = new Map<string, Title[]>()
  for (const ch of input.live) {
    const [key, title] = liveEntry(ch, ctx)
    bucket(channelTitles, key, title)
  }
  const movieTitles = new Map<string, Title[]>()
  for (const m of input.vod) {
    const [key, title] = movieEntry(m, ctx)
    bucket(movieTitles, key, title)
  }
  const seriesMap = new Map<string, Title[]>()
  for (const s of input.seriesRaw) {
    const [key, title] = seriesEntry(s, ctx)
    bucket(seriesMap, key, title)
  }

  return {
    // A channel can legitimately appear once per category/quality feed; keep the
    // highest quality edition and mark it featured when it matches the pinned set.
    channels: [...channelTitles.values()].map(reduceEditions),
    movies: finish([...movieTitles.values()].map(reduceEditions)),
    series: [...seriesMap.values()].map(reduceEditions),
    counts: {
      channels: input.live.length,
      movies: input.vod.length,
      series: input.seriesRaw.length,
    },
  }
}

/** The same catalogue, built in slices so the browser can paint in between. */
export async function buildCatalogAsync(input: BuildInput) {
  const ctx = buildContext(input)
  const channelTitles = new Map<string, Title[]>()
  let sinceYield = 0
  for (const ch of input.live) {
    const [key, title] = liveEntry(ch, ctx)
    bucket(channelTitles, key, title)
    if (++sinceYield >= SLICE) {
      sinceYield = 0
      await yieldToBrowser()
    }
  }
  await yieldToBrowser()

  const movieTitles = new Map<string, Title[]>()
  for (const m of input.vod) {
    const [key, title] = movieEntry(m, ctx)
    bucket(movieTitles, key, title)
    if (++sinceYield >= SLICE) {
      sinceYield = 0
      await yieldToBrowser()
    }
  }
  await yieldToBrowser()

  const seriesMap = new Map<string, Title[]>()
  for (const s of input.seriesRaw) {
    const [key, title] = seriesEntry(s, ctx)
    bucket(seriesMap, key, title)
    if (++sinceYield >= SLICE) {
      sinceYield = 0
      await yieldToBrowser()
    }
  }
  await yieldToBrowser()

  const reduce = async (groups: Map<string, Title[]>): Promise<Title[]> => {
    const out: Title[] = []
    for (const list of groups.values()) {
      out.push(reduceEditions(list))
      if (++sinceYield >= SLICE) {
        sinceYield = 0
        await yieldToBrowser()
      }
    }
    return out
  }

  const channels = await reduce(channelTitles)
  const movies = finish(await reduce(movieTitles))
  const series = await reduce(seriesMap)

  // The landing page asks every one of these the same two questions (is this an
  // Action title, a Drama title?) the first time it opens. Answering them here,
  // in slices, hands that first home render a warm answer instead of a name
  // normalisation for forty-six thousand titles in one blocking pass.
  for (const movie of movies) {
    matchesBandName(movie, BANDS.action)
    matchesBandName(movie, BANDS.drama)
    if (++sinceYield >= SLICE) {
      sinceYield = 0
      await yieldToBrowser()
    }
  }

  return {
    channels,
    movies,
    series,
    counts: {
      channels: input.live.length,
      movies: input.vod.length,
      series: input.seriesRaw.length,
    },
  }
}

/** Configured display label for a pinned shortcut channel, if it matches one.
 *  Matching stays exact so "MTV 90s" or plain "beIN SPORTS" are not pulled in. */
/** Curated logo first, then whatever the panel sent. Applied at render time as
 *  well as during normalisation, so a cached catalog picks it up immediately. */
export function channelArtSrc(channel: Title): string | undefined {
  return CHANNEL_ART[channel.id] ?? channel.poster
}

export function featuredChannelLabel(t: Title): string | undefined {
  const names = [t.name.trim().toLowerCase(), t.cleanName.trim().toLowerCase()]
  return FEATURED_CHANNELS.find((f) => f.names?.some((n) => names.includes(n)))?.label
}

export function isFeaturedChannel(t: Title): boolean {
  return featuredChannelLabel(t) !== undefined
}

/** Quality filter: "4K" also includes FHD so UHD collections stay populated. */
export function matchesQuality(t: Title, quality?: string): boolean {
  if (!quality || quality === 'all') return true
  if (quality === '4K') return t.quality === '4K'
  if (quality === 'FHD') return t.quality === '4K' || t.quality === 'FHD'
  if (quality === 'HD') return t.quality === '4K' || t.quality === 'FHD' || t.quality === 'HD'
  return true
}

export function stripUndefined<T extends object>(obj: T): T {
  const out = {} as T
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}
