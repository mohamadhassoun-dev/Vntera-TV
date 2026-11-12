import { create } from 'zustand'
import { idbGet, idbSet } from '../lib/storage'
import { FEATURED_CHANNELS, REFRESH_INTERVAL_MS } from '../lib/config'
import {
  getCategories,
  getLiveChannels,
  getMovies,
  getSeries,
  PanelError,
  fetchM3U,
} from '../lib/xtream'
import { buildCatalogAsync } from '../lib/normalize'
import { warmBandTitle } from '../lib/genreBands'
import { warmTitleDerivations } from '../lib/homeRotation'
import { warmCollectionTitle } from '../lib/collections'
import { warmTrending } from '../lib/search'
import type { CatalogSnapshot, RawCategory, RawLiveStream, RawSeries, RawVodStream, Title } from '../types'
import { classifyEntries, parseM3U } from '../lib/m3u'

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CatalogStore {
  snapshot: CatalogSnapshot | null
  status: CatalogStatus
  phase: string
  progress: number
  error: string | null
  offline: boolean
  load: (opts?: { force?: boolean; account?: string }) => Promise<void>
  refresh: () => Promise<void>
  /**
   * Re-pulls only the live line-up; the panel rotates channel ids. Resolves true
   * only when a new list was actually fetched and applied, so a caller never
   * claims a refresh that its own throttle skipped.
   */
  refreshLive: (opts?: { force?: boolean }) => Promise<boolean>
  reset: () => void
}

// v3: the snapshot is cached in parts (see readCache/writeCache).
/** How old a live line-up may be before it is re-pulled in the background. */
const LIVE_STALE_MS = 15 * 60 * 1000
/** Two refreshes closer together than this collapse into one. */
const LIVE_REFRESH_THROTTLE_MS = 60 * 1000
let liveInFlight: Promise<boolean> | null = null
let lastLiveRefresh = 0
const cacheKey = (account: string) => `catalog:v3:${account}`
const legacyKey = (account: string) => `catalog:v2:${account}`

/** A fresh snapshot without live channels is incomplete and should be retried. */
export function hasFreshLiveCatalog(snapshot: CatalogSnapshot | null, now = Date.now()): boolean {
  return Boolean(
    snapshot &&
      snapshot.channels.length > 0 &&
      // A snapshot saved while the provider's VOD list was empty must not pin
      // Movies and Series to nothing for six hours.
      (snapshot.movies.length > 0 || snapshot.series.length > 0) &&
      now - snapshot.builtAt < REFRESH_INTERVAL_MS,
  )
}

/**
 * A 60k-title snapshot is one enormous object graph, and handing it to IndexedDB
 * in a single call blocks the UI for hundreds of milliseconds (seconds on a
 * phone) — the freeze a viewer reads as the app hanging on launch. The cache is
 * written and read in parts instead, with a frame handed back between them.
 * Nothing about the cached data changes; only the size of each step.
 */
const PART_SIZE = 6000

interface CacheMeta {
  builtAt: number
  account: string
  demo: boolean
  categories: CatalogSnapshot['categories']
  counts: CatalogSnapshot['counts']
  movieParts: number
  seriesParts: number
}

/**
 * Hands a frame back between chunks of cache work so a visible page stays
 * responsive. A hidden tab has no frames to protect, and browsers clamp its
 * timers to about a second, which turned a cache read into a minute-long wait
 * on exactly the page that was waiting for it.
 */
const breathe = () =>
  document.visibilityState === 'hidden'
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, 0))

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out.length ? out : [[]]
}

async function readCache(account: string): Promise<CatalogSnapshot | null> {
  const meta = await idbGet<CacheMeta>(`${cacheKey(account)}:meta`)
  if (!meta) return idbGet<CatalogSnapshot>(legacyKey(account))
  const channels: Title[] = (await idbGet<Title[]>(`${cacheKey(account)}:channels`)) ?? []
  const movies: Title[] = []
  for (let part = 0; part < meta.movieParts; part += 1) {
    const slice = await idbGet<Title[]>(`${cacheKey(account)}:movies:${part}`)
    if (slice?.length) for (const title of slice) movies.push(title)
    await breathe()
  }
  const series: Title[] = []
  for (let part = 0; part < meta.seriesParts; part += 1) {
    const slice = await idbGet<Title[]>(`${cacheKey(account)}:series:${part}`)
    if (slice?.length) for (const title of slice) series.push(title)
    await breathe()
  }
  if (!channels.length && !movies.length && !series.length) return null
  // A snapshot written before the artwork rule existed can still point a card at
  // an image URL with no file name, which only ever yields a failed request and
  // a blank tile. Clearing those here fixes every stored catalogue on the spot,
  // instead of forcing a phone through a full 57k-title rebuild.
  for (const list of [channels, movies, series]) {
    for (const title of list) {
      const poster = title.poster
      if (!poster) continue
      const path = poster.split('?')[0]
      if (path.slice(path.lastIndexOf('/') + 1).includes('.')) continue
      title.poster = undefined
      title.hasArtwork = Boolean(title.backdrop)
    }
  }
  return {
    account: meta.account,
    builtAt: meta.builtAt,
    demo: meta.demo,
    categories: meta.categories,
    counts: meta.counts,
    channels,
    movies,
    series,
  }
}

/**
 * A snapshot read back from IndexedDB is plain data: none of the answers the
 * landing page needs per title (does its artwork render, is it an Action title,
 * what is its identity) survive the round trip. Computing them lazily put
 * ~800 ms of regex and string work on the click that opens Home; answering them
 * here, in slices while the launch intro still covers the screen, makes that
 * click a cache read.
 */
async function warmSnapshot(snapshot: CatalogSnapshot): Promise<void> {
  let sinceYield = 0
  for (const movie of snapshot.movies) {
    warmBandTitle(movie)
    warmCollectionTitle(movie)
    warmTitleDerivations(movie)
    if (++sinceYield >= PART_SIZE) {
      sinceYield = 0
      await breathe()
    }
  }
  // Search's trending list is a pass over the whole library too, and it is
  // opened from a single tap in the header.
  await warmTrending(snapshot)
}

async function writeCache(account: string, snapshot: CatalogSnapshot): Promise<void> {
  const movieParts = chunk(snapshot.movies, PART_SIZE)
  const seriesParts = chunk(snapshot.series, PART_SIZE)
  const meta: CacheMeta = {
    builtAt: snapshot.builtAt,
    account: snapshot.account,
    demo: snapshot.demo,
    categories: snapshot.categories,
    counts: snapshot.counts,
    movieParts: movieParts.length,
    seriesParts: seriesParts.length,
  }
  await idbSet(`${cacheKey(account)}:meta`, meta)
  await idbSet(`${cacheKey(account)}:channels`, snapshot.channels)
  for (let part = 0; part < movieParts.length; part += 1) {
    await idbSet(`${cacheKey(account)}:movies:${part}`, movieParts[part])
    await breathe()
  }
  for (let part = 0; part < seriesParts.length; part += 1) {
    await idbSet(`${cacheKey(account)}:series:${part}`, seriesParts[part])
    await breathe()
  }
}

let inFlight: Promise<void> | null = null

export const useCatalog = create<CatalogStore>((set, get) => ({
  snapshot: null,
  status: 'idle',
  phase: '',
  progress: 0,
  error: null,
  offline: false,

  reset: () => set({ snapshot: null, status: 'idle', progress: 0, phase: '', error: null }),

  load: async (opts = {}) => {
    const account = opts.account ?? get().snapshot?.account ?? 'anonymous'
    if (inFlight) return inFlight

    const run = async () => {
      const cached = await readCache(account)
      // Warming the derived answers is a landing-page nicety, and it walks every
      // movie in the library. Waiting for all of it before publishing a snapshot
      // that is already in hand left a watch page without its title — and on the
      // "Stream unavailable." card — for a minute on a busy or hidden tab. Bound
      // the wait and let the rest of the warm pass continue in the background.
      if (cached) {
        await Promise.race([
          warmSnapshot(cached),
          new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
        ])
      }
      if (cached && !opts.force) {
        set({ snapshot: cached, status: 'ready', progress: 100, phase: '' })
        // The channel list goes stale long before the title library does, so it
        // is re-pulled in the background — after this paint, never before it.
        if (Date.now() - cached.builtAt > LIVE_STALE_MS) void get().refreshLive()
        // A failed/empty live-stream response must not be treated as a complete
        // fresh catalog: otherwise Live TV and Home shortcuts stay empty for six
        // hours even when the provider has recovered. Retry the catalog instead.
        if (hasFreshLiveCatalog(cached)) return
      } else if (!opts.force) {
        set({ status: 'loading', phase: 'Connecting to Vntera', progress: 4 })
      } else {
        set({ status: 'loading', phase: 'Refreshing catalog', progress: 4 })
      }

      try {
        const categories = await getCategories()
        set({ phase: 'Indexing categories', progress: 12 })

        let live: RawLiveStream[] = []
        let vod: RawVodStream[] = []
        let seriesRaw: RawSeries[] = []

        let channels: Title[] = []
        let movies: Title[] = []
        let series: Title[] = []
        const catArg = {
          live: categories.live as RawCategory[],
          vod: categories.vod as RawCategory[],
          series: categories.series as RawCategory[],
        }

        // A 57k-title library must not block Live TV behind one giant response:
        // publish each section as soon as it is normalized.
        const publish = (progress: number) => {
          const snapshot: CatalogSnapshot = {
            account,
            builtAt: Date.now(),
            demo: false,
            channels,
            movies,
            series,
            categories: catArg,
            counts: { channels: live.length, movies: vod.length, series: seriesRaw.length },
          }
          // Sections land out of order (live first, starter movies next), so a
          // late, smaller section must never walk the progress bar backwards.
          set({ snapshot, status: 'ready', progress: Math.max(progress, get().progress), error: null, offline: false })
          return snapshot
        }

        const liveTask = getLiveChannels().then(async (r) => {
          live = r
          channels = (
            await buildCatalogAsync({ account, live: r, vod: [], seriesRaw: [], categories: catArg })
          ).channels
          publish(35)
          set({ phase: `Live ready · ${r.length.toLocaleString()} channels` })
        })
        // The full 46k-title pull takes about half a minute on this panel, and
        // the home page used to stay empty until it landed. A few categories are
        // a few hundred kilobytes, so ask for those first and paint titles while
        // the rest arrives; the full list replaces them when it finishes.
        const starterIds = catArg.vod.slice(0, 4).map((c) => String(c.category_id))
        // Series is the last section to arrive and the Series page used to sit on
        // skeletons until the whole 10k-title pull landed. Two categories are
        // enough to fill the grid while the rest is on its way.
        const starterSeriesIds = catArg.series.slice(0, 2).map((c) => String(c.category_id))
        const starterTask = (async () => {
          const seen = new Map<number, RawVodStream>()
          const seenSeries = new Map<number, RawSeries>()
          let pendingSeries = 0
          const announceSeries = () => {
            if (seriesRaw.length || seenSeries.size < 120 || pendingSeries) return
            pendingSeries = window.setTimeout(() => {
              pendingSeries = 0
              if (seriesRaw.length) return
              const raw = [...seenSeries.values()]
              void buildCatalogAsync({
                account,
                live: [],
                vod: [],
                seriesRaw: raw,
                categories: catArg,
              }).then((built) => {
                // The full pull may have landed while this slice was indexing.
                if (seriesRaw.length) return
                series = built.series
                publish(48)
              })
            }, 120)
          }
          let pendingPublish = 0
          const announce = (final = false) => {
            // One tiny category is not a home page: a rail needs enough titles
            // to fill itself, so wait for a few hundred before the first paint.
            if (!final && seen.size < 300) return
            // Coalesce the categories that land together into one render.
            if (pendingPublish) return
            pendingPublish = window.setTimeout(() => {
              pendingPublish = 0
              // The complete list wins the race: never replace a finished
              // catalogue with this smaller slice.
              if (!seen.size || vod.length) return
              const raw = [...seen.values()]
              void buildCatalogAsync({ account, live: [], vod: raw, seriesRaw: [], categories: catArg }).then(
                (built) => {
                  if (vod.length) return
                  vod = raw
                  movies = built.movies
                  publish(45)
                  set({ phase: `Showing ${vod.length.toLocaleString()} titles` })
                },
              )
            }, 120)
          }
          await Promise.all([
            ...starterIds.map(async (id) => {
              const list = await getMovies(id).catch(() => [] as RawVodStream[])
              if (vod.length) return
              for (const item of list) seen.set(Number(item.stream_id), item)
              announce()
            }),
            ...starterSeriesIds.map(async (id) => {
              const list = await getSeries(id).catch(() => [] as RawSeries[])
              if (seriesRaw.length) return
              for (const item of list) seenSeries.set(Number(item.series_id), item)
              announceSeries()
            }),
          ])
          announce(true)
          announceSeries()
        })()
        // The big pulls wait for the starter (or six seconds): they otherwise
        // take every connection and the first titles arrive as slowly as the
        // whole library. The cap keeps a slow category from holding them back.
        const starterSettled = Promise.race([
          starterTask,
          new Promise<void>((resolve) => window.setTimeout(resolve, 6000)),
        ])
        const vodTask = starterSettled.then(() => getMovies()).then(async (r) => {
          vod = r
          movies = (await buildCatalogAsync({ account, live: [], vod: r, seriesRaw: [], categories: catArg }))
            .movies
          publish(70)
          set({ phase: `Movies ready · ${r.length.toLocaleString()} titles` })
        })
        const seriesTask = starterSettled.then(() => getSeries()).then(async (r) => {
          seriesRaw = r
          series = (await buildCatalogAsync({ account, live: [], vod: [], seriesRaw: r, categories: catArg }))
            .series
          publish(88)
          set({ phase: `Series ready · ${r.length.toLocaleString()} titles` })
        })

        const results = await Promise.allSettled([liveTask, vodTask, seriesTask])
        const failed = results.filter((r) => r.status === 'rejected').length

        if (!live.length) {
          // Fallback: derive channels from the M3U playlist when the JSON list is empty.
          try {
            set({ phase: 'Parsing M3U playlist', progress: 82 })
            const text = await fetchM3U()
            const { live: liveEntries } = classifyEntries(parseM3U(text))
            live = liveEntries.map((e, i) => ({
              num: i + 1,
              name: e.tvgName || e.name,
              stream_id: Number(e.url.match(/\/(\d+)(?:\.\w+)?$/)?.[1] ?? i + 1) || i + 1,
              stream_icon: e.logo,
              epg_channel_id: e.tvgId,
              category_id: e.group,
              added: '',
            }))
            if (!categories.live.length && live.length) {
              const groups = [...new Set(live.map((c) => String(c.category_id || 'General')))]
              categories.live = groups.map((g, i) => ({ category_id: g || String(i), category_name: g || 'General' }))
            }
          } catch {
            /* M3U fallback is best-effort */
          }
        }

        if (!live.length && !vod.length && !seriesRaw.length) {
          throw new PanelError('server', 'Vntera returned an empty library. Check that the subscription is active.')
        }

        // The M3U fallback above may have produced channels after the live task.
        if (!channels.length && live.length) {
          channels = (await buildCatalogAsync({ account, live, vod: [], seriesRaw: [], categories: catArg }))
            .channels
        }
        publish(100)
        set({
          status: 'ready',
          phase: '',
          progress: 100,
          error: failed ? 'Some sections failed to refresh; showing what loaded.' : null,
        })
        // Persist once, after paint, and off the critical path: writing a
        // 60k-title snapshot four times while the page is arriving is what made
        // a cold start feel heavy. An idle callback keeps the serialization out
        // of the first paint as well.
        const finalSnapshot = get().snapshot
        if (finalSnapshot) {
          const persist = () => void writeCache(account, finalSnapshot)
          const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
          if (typeof idle === 'function') idle(persist)
          else window.setTimeout(persist, 1200)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load the catalog.'
        const fallback = cached ?? get().snapshot
        set({
          status: fallback ? 'ready' : 'error',
          error: message,
          phase: '',
          offline: !!fallback,
          snapshot: fallback,
        })
      }
    }

    inFlight = run().finally(() => {
      inFlight = null
    })
    return inFlight
  },

  refresh: async () => {
    const snapshot = get().snapshot
    await get().load({ force: true, account: snapshot?.account })
  },

  refreshLive: async (opts = {}) => {
    const snapshot = get().snapshot
    if (!snapshot) return false
    // A viewer flipping channels must not turn into a request storm against a
    // panel that allows one stream at a time. A channel the panel no longer
    // serves is the one case that overrides this (`force`).
    if (!opts.force && Date.now() - lastLiveRefresh < LIVE_REFRESH_THROTTLE_MS) return false
    // A forced refresh exists to answer "is this channel still listed?", so it
    // never queues behind an earlier run: a stalled one would leave the viewer on
    // a screen that can never say anything about the list.
    if (liveInFlight && !opts.force) return liveInFlight
    lastLiveRefresh = Date.now()
    const run = async (): Promise<boolean> => {
      try {
        let live = await getLiveChannels()
        if (!live.length) {
          // The panel answers an empty list when its single stream slot is busy,
          // which is exactly the state a failed channel leaves behind. One short
          // wait usually gets the real line-up.
          await new Promise((resolve) => setTimeout(resolve, 1_500))
          live = await getLiveChannels()
        }
        if (!live.length) {
          console.warn('[catalog] live refresh: provider returned no channels')
          return false
        }
        const built = await buildCatalogAsync({
          account: snapshot.account,
          live,
          vod: [],
          seriesRaw: [],
          categories: snapshot.categories,
        })
        const current = get().snapshot
        // Replace only the channel list: movies and series are unaffected, and
        // `builtAt` stays put so the six-hourly full refresh still runs.
        if (!current || !built.channels.length) {
          console.warn('[catalog] live refresh: nothing to apply', {
            current: Boolean(current),
            built: built.channels.length,
            raw: live.length,
          })
          return false
        }
        const next: CatalogSnapshot = {
          ...current,
          channels: built.channels,
          counts: { ...current.counts, channels: live.length },
        }
        set({ snapshot: next })
        // Persist it too: a rotation that only lived in memory would come back
        // with the stale line-up on the next visit.
        void writeCache(current.account, next)
        return true
      } catch (error) {
        // A background refresh never disturbs what is already on screen, but a
        // silent failure here is what makes a screen claim a refresh it did not
        // get, so it is reported.
        console.warn('[catalog] live refresh failed', error)
        return false
      }
    }
    // The panel's line-up is a few megabytes over a streaming parse, and that
    // parse can stall on a saturated connection. A timeout keeps a hung run from
    // holding the slot for every later refresh.
    const guard = new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), 30_000)
    })
    liveInFlight = Promise.race([run(), guard]).finally(() => {
      liveInFlight = null
    })
    return liveInFlight
  },
}))

// ------------------------------ selectors ----------------------------------

export function channelsFor(snapshot: CatalogSnapshot | null, categoryId?: string): Title[] {
  if (!snapshot) return []
  if (!categoryId || categoryId === 'all') return snapshot.channels
  return snapshot.channels.filter((c) => c.categoryId === categoryId)
}

export interface FeaturedChannelShortcut {
  channel: Title
  /** Requested display label; playback keeps the panel's original stream id. */
  label: string
}

/**
 * Channel lookups by id and by name, built once per channel list.
 *
 * The shortcut column asks for about twenty channels by name, and answering that
 * by scanning all 8.9k channels — lower-casing every name for every entry — cost
 * 74 ms inside the tap that opened Home. One pass answers all of them.
 */
interface ChannelIndex {
  byId: Map<number, Title>
  byName: Map<string, Title>
}

const channelIndexCache = new WeakMap<readonly Title[], ChannelIndex>()

export function channelIndex(channels: readonly Title[]): ChannelIndex {
  const cached = channelIndexCache.get(channels)
  if (cached) return cached
  const byId = new Map<number, Title>()
  const byName = new Map<string, Title>()
  for (const channel of channels) {
    if (!byId.has(channel.id)) byId.set(channel.id, channel)
    for (const name of [channel.name, channel.cleanName]) {
      const key = name.trim().toLowerCase()
      if (!key) continue
      const previous = byName.get(key)
      // Among duplicates the newest wins, because the panel appends the copy
      // that still plays.
      if (!previous || (channel.addedAt ?? 0) > (previous.addedAt ?? 0)) byName.set(key, channel)
    }
  }
  const index: ChannelIndex = { byId, byName }
  channelIndexCache.set(channels, index)
  return index
}

/** The curated Shortcut channels, in configuration order, omitting any channel
 *  this panel does not carry. */
export function featuredChannels(snapshot: CatalogSnapshot | null): FeaturedChannelShortcut[] {
  if (!snapshot) return []
  const out: FeaturedChannelShortcut[] = []
  const index = channelIndex(snapshot.channels)
  for (const entry of FEATURED_CHANNELS) {
    // The panel often lists one channel twice: the working stream plus a dead
    // duplicate left over from a re-provision. Both answer to the same name, so
    // the configured id is the reliable pick and the name is only the fallback
    // for when the panel re-issues ids. Among name matches the newest wins,
    // because the panel appends the duplicate that still plays.
    let byName: Title | undefined
    for (const name of entry.names ?? []) {
      const match = index.byName.get(name.trim().toLowerCase())
      if (match && (!byName || (match.addedAt ?? 0) > (byName.addedAt ?? 0))) byName = match
    }
    const channel = (entry.id ? index.byId.get(entry.id) : undefined) ?? byName
    if (channel) out.push({ channel, label: entry.label })
  }
  return out
}

export function topTen(snapshot: CatalogSnapshot | null): Title[] {
  if (!snapshot) return []
  return [...snapshot.movies, ...snapshot.series]
    .sort((a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 10)
}

export function recentlyAdded(snapshot: CatalogSnapshot | null, days = 7, limit = 60): Title[] {
  if (!snapshot) return []
  const since = Date.now() / 1000 - days * 86_400
  return [...snapshot.movies, ...snapshot.series]
    .filter((t) => t.addedAt >= since)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, limit)
}

export function popular(snapshot: CatalogSnapshot | null, limit = 60): Title[] {
  if (!snapshot) return []
  return [...snapshot.movies, ...snapshot.series]
    .sort((a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, limit)
}

export function trending(snapshot: CatalogSnapshot | null, limit = 60): Title[] {
  if (!snapshot) return []
  return [...snapshot.movies, ...snapshot.series]
    .filter((t) => t.addedAt > 0)
    .sort((a, b) => b.addedAt * 0.6 + (b.rating ?? 0) * 1000 - (a.addedAt * 0.6 + (a.rating ?? 0) * 1000))
    .slice(0, limit)
}

export function categoriesWithCounts(snapshot: CatalogSnapshot | null, kind: 'live' | 'movie' | 'series') {
  if (!snapshot) return []
  const pool = kind === 'live' ? snapshot.channels : kind === 'movie' ? snapshot.movies : snapshot.series
  const raw = kind === 'live' ? snapshot.categories.live : kind === 'movie' ? snapshot.categories.vod : snapshot.categories.series
  const counts = new Map<string, number>()
  for (const t of pool) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
  const out = raw
    .map((c) => ({ id: String(c.category_id), name: c.category_name, count: counts.get(String(c.category_id)) ?? 0 }))
    .filter((c) => c.count > 0)
  out.sort((a, b) => b.count - a.count)
  return [{ id: 'all', name: kind === 'live' ? 'All Channels' : kind === 'movie' ? 'All Movies' : 'All Series', count: pool.length }, ...out]
}
