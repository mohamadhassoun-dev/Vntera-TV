import type { Title } from '../types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const ROTATION_MS = 60 * 60 * 1000
const DEFAULT_HOME_LIMIT = 24

/** Titles already chosen for the page, so no rail repeats another rail's work.
 *  Identities and artwork are held as interned numbers: the sets are consulted
 *  for every title of every rail, and hashing a 60-character URL each time was
 *  the second largest cost on the home hop. */
export interface ArtworkUsage {
  ids: Set<number>
  identities: Set<number>
  artworks: Set<number>
}

export function createArtworkUsage(): ArtworkUsage {
  return { ids: new Set(), identities: new Set(), artworks: new Set() }
}

/** Monday-based UTC week index: stable for a whole calendar week, identical
 *  for every visitor, and independent of the local timezone. */
export function utcWeekIndex(date: Date): number {
  const mondayOffset = (date.getUTCDay() + 6) % 7
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset)
  return Math.floor(monday / WEEK_MS)
}

/** Hourly UTC rotation index: the hero changes its featured Blockbusters on this
 *  boundary, so every visitor sees the same set during the same hour. */
export function utcRotationIndex(date: Date): number {
  return Math.floor(date.getTime() / ROTATION_MS)
}

/** A poster URL that can actually render. Panel data contains truncated URLs
 *  such as `https://image.tmdb.org/t/p/w600_and_h900_bestv2` (no file name),
 *  which load as blank art, so they never qualify for a Home rail. */
export function isRenderableArtwork(url?: string): boolean {
  if (!url) return false
  const value = url.trim()
  if (!/^https?:\/\//i.test(value) && !value.startsWith('data:image')) return false
  if (/(no[-_]?image|noimage|placeholder|dummy|default[-_]?poster|nophoto|blank\.(png|jpe?g|webp))/i.test(value)) {
    return false
  }
  if (value.startsWith('data:image')) return true
  const withoutQuery = value.split(/[?#]/)[0]
  const lastSegment = withoutQuery.split('/').filter(Boolean).pop() ?? ''
  if (!lastSegment) return false
  if (lastSegment.includes('.')) return true
  // Some panels serve extension-less image routes, but only with an explicit
  // image query (`?format=jpg`, `?image=123`).
  return /[?&](?:format|image|img)=/i.test(value)
}

/** Derived keys are pure per title object, and the catalog keeps the same
 *  objects across page visits, so cache them instead of re-running the regexes
 *  for every rail on a 46k-title library. */
const artworkCache = new WeakMap<Title, string>()
const identityCache = new WeakMap<Title, string>()

/** Canonical key for a title's artwork, so one poster never appears twice. */
export function artworkKey(title: Title): string {
  const cached = artworkCache.get(title)
  if (cached !== undefined) return cached
  const url = title.poster?.trim()
  const key = isRenderableArtwork(url) ? url!.toLowerCase() : ''
  artworkCache.set(title, key)
  return key
}

/** Same movie under different panel naming (quality tags, provider prefixes). */
export function titleIdentity(title: Title): string {
  const cached = identityCache.get(title)
  if (cached !== undefined) return cached
  const identity = `${normalizeTitleName(title.name)}|${title.year ?? ''}`
  identityCache.set(title, identity)
  return identity
}

/**
 * Interned numbers for the two derived keys, so rail de-duplication compares
 * small integers instead of long strings. 0 means "no renderable artwork".
 */
const artworkTokenCache = new WeakMap<Title, number>()
const identityTokenCache = new WeakMap<Title, number>()
const artworkTokens = new Map<string, number>()
const identityTokens = new Map<string, number>()
let nextArtworkToken = 1
let nextIdentityToken = 1

export function artworkToken(title: Title): number {
  const cached = artworkTokenCache.get(title)
  if (cached !== undefined) return cached
  const key = artworkKey(title)
  let token = 0
  if (key) {
    token = artworkTokens.get(key) ?? 0
    if (!token) {
      token = nextArtworkToken++
      artworkTokens.set(key, token)
    }
  }
  artworkTokenCache.set(title, token)
  return token
}

export function identityToken(title: Title): number {
  const cached = identityTokenCache.get(title)
  if (cached !== undefined) return cached
  const key = titleIdentity(title)
  let token = identityTokens.get(key) ?? 0
  if (!token) {
    token = nextIdentityToken++
    identityTokens.set(key, token)
  }
  identityTokenCache.set(title, token)
  return token
}

/** Quality, release and language tags that carry no title identity. */
const NOISE_TOKENS = new Set([
  '4k', 'uhd', '2160p', '1080p', '720p', '480p', 'fhd', 'full', 'hd', 'sd', 'hdr', 'hdr10',
  'hevc', 'h265', 'h264', 'x264', 'x265', 'ds', 'dts', 'aac', 'remux', 'web', 'webrip',
  'webdl', 'bluray', 'brrip', 'multi', 'dubbed', 'subbed', 'arabic', 'english', 'french',
  'ar', 'en', 'fr',
])

// Tokenizing is roughly an order of magnitude faster than a 30-branch regex on
// every title in a 46k catalog, which is rebuilt for every rail.
function normalizeTitleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9\u0600-\u06ff]+/)
    .filter((token) => token !== '' && !NOISE_TOKENS.has(token))
    .join(' ')
    .trim()
}

/** Deterministic weekly order for a rail: a hash-shuffled pool that starts a
 *  whole page later each week, so consecutive weeks show disjoint pages. */
export function weeklyRailOrder(
  candidates: readonly Title[],
  railKey: string,
  weekIndex: number,
  pageSize = DEFAULT_HOME_LIMIT,
): Title[] {
  const pool = uniqueArtworkMovies(candidates)
  if (!pool.length) return []
  // Hash once per title rather than twice on every comparison: a 46k-title
  // pool means ~700k comparisons, and hashing inside the comparator alone cost
  // seconds per rail.
  const ordered = pool
    .map((title) => ({ title, key: stableHash(`${railKey}:${title.id}`) }))
    .sort((a, b) => a.key - b.key || a.title.id - b.title.id)
    .map((entry) => entry.title)
  const page = Math.min(Math.max(1, Math.floor(pageSize) || 1), ordered.length)
  const offset = ((weekIndex * page + stableHash(railKey)) % ordered.length + ordered.length) % ordered.length
  return [...ordered.slice(offset), ...ordered.slice(0, offset)]
}

/** Take titles that no other rail uses, with a poster URL no other rail shows. */
export function takeUnusedTitles(
  ordered: readonly Title[],
  limit: number,
  usage: ArtworkUsage,
  alreadyPicked: readonly Title[] = [],
): Title[] {
  if (limit <= 0) return []
  const picked: Title[] = []
  const seenIds = new Set(alreadyPicked.map((title) => title.id))
  const seenIdentities = new Set(alreadyPicked.map(identityToken))
  const seenArtwork = new Set(alreadyPicked.map(artworkToken))
  for (const title of ordered) {
    if (picked.length >= limit) break
    const artwork = artworkToken(title)
    if (!artwork) continue
    const identity = identityToken(title)
    if (seenIds.has(title.id) || usage.ids.has(title.id)) continue
    if (seenIdentities.has(identity) || usage.identities.has(identity)) continue
    if (seenArtwork.has(artwork) || usage.artworks.has(artwork)) continue
    picked.push(title)
    seenIds.add(title.id)
    seenIdentities.add(identity)
    seenArtwork.add(artwork)
  }
  return picked
}

/** Mark titles as used by a rail so later rails cannot repeat them. */
export function reserveTitles(usage: ArtworkUsage, titles: readonly Title[]): void {
  for (const title of titles) {
    usage.ids.add(title.id)
    usage.identities.add(identityToken(title))
    const artwork = artworkToken(title)
    if (artwork) usage.artworks.add(artwork)
  }
}

/** One rail: weekly page, unique titles, unique artwork, remembered globally. */
export function selectUniqueRailTitles(
  candidates: readonly Title[],
  railKey: string,
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
  usage: ArtworkUsage = createArtworkUsage(),
): Title[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const cap = Math.floor(limit)
  const picked = takeUnusedTitles(weeklyRailOrder(candidates, railKey, weekIndex, cap), cap, usage)
  reserveTitles(usage, picked)
  return picked
}

/**
 * Answers the two questions every rail asks about a title — does its artwork
 * render, and what is its identity — so a later rail build is a cache read.
 */
export function warmTitleDerivations(title: Title): void {
  artworkKey(title)
  titleIdentity(title)
  artworkToken(title)
  identityToken(title)
}

/** "New on Vntera": recent movies first, then unique trending movies. */
export function selectUniqueNewTitles(
  recent: readonly Title[],
  trending: readonly Title[],
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
  usage: ArtworkUsage = createArtworkUsage(),
): Title[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const cap = Math.floor(limit)
  const recentPool = uniqueArtworkMovies(recent)
  const trendingPool = uniqueArtworkMovies(trending)
  const recentOrder =
    recentPool.length > cap ? weeklyRailOrder(recent, 'new-recent', weekIndex, cap) : recentPool
  const trendingOrder =
    trendingPool.length > cap ? weeklyRailOrder(trending, 'new-trending', weekIndex, cap) : trendingPool
  const picked = takeUnusedTitles(recentOrder, cap, usage)
  if (picked.length < cap) {
    picked.push(...takeUnusedTitles(trendingOrder, cap - picked.length, usage, picked))
  }
  reserveTitles(usage, picked)
  return picked
}

/** Deterministic weekly window over a rail's artwork-backed movie pool. */
export function selectWeeklyMovieTitles(
  candidates: readonly Title[],
  railKey: string,
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
): Title[] {
  return selectUniqueRailTitles(candidates, railKey, weekIndex, limit, createArtworkUsage())
}

/** "New on Vntera" for a standalone (unshared) selection. */
export function selectWeeklyNewTitles(
  recent: readonly Title[],
  trending: readonly Title[],
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
): Title[] {
  return selectUniqueNewTitles(recent, trending, weekIndex, limit, createArtworkUsage())
}

/** One-shot timer for the next hour boundary. Returns its own cleanup. */
export function scheduleNextRotationUpdate(onBoundary: () => void, now: number): () => void {
  const nextBoundary = (Math.floor(now / ROTATION_MS) + 1) * ROTATION_MS
  const timer = globalThis.setTimeout(onBoundary, Math.max(0, nextBoundary - now))
  return () => globalThis.clearTimeout(timer)
}

/** One-shot timer for the next Monday 00:00 UTC. Returns its own cleanup. */
export function scheduleNextUtcWeekUpdate(onBoundary: () => void, now: number): () => void {
  const date = new Date(now)
  const mondayOffset = (date.getUTCDay() + 6) % 7
  const startOfWeek = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset)
  const nextBoundary = startOfWeek + WEEK_MS
  const timer = globalThis.setTimeout(onBoundary, Math.max(0, nextBoundary - now))
  return () => globalThis.clearTimeout(timer)
}

function uniqueArtworkMovies(titles: readonly Title[]): Title[] {
  const seenIds = new Set<number>()
  const seenIdentities = new Set<number>()
  const seenArtwork = new Set<number>()
  return titles.filter((title) => {
    if (title.kind !== 'movie' || !title.hasArtwork) return false
    const artwork = artworkToken(title)
    if (!artwork) return false
    const identity = identityToken(title)
    if (seenIds.has(title.id) || seenIdentities.has(identity) || seenArtwork.has(artwork)) return false
    seenIds.add(title.id)
    seenIdentities.add(identity)
    seenArtwork.add(artwork)
    return true
  })
}

export function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
