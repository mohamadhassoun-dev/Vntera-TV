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
import { warmSearchIndex, warmTrending } from '../lib/search'
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
  /** False for a snapshot written while the library was still arriving. */
  complete?: boolean
}

/**
 * Caches written mid-load. They are good enough to paint a second visit
 * instantly, but they must not be treated as a finished library — otherwise a
 * few hundred titles would be "fresh" for six hours and never refresh.
 */
const partialCaches = new WeakSet<CatalogSnapshot>()

/**
 * What a read cache actually holds: the parts on disk are the titles this visit
 * starts from, so a resumed load can skip writing them again.
 */
let lastCacheShape: { builtAt: number; movieParts: number; seriesParts: number; hasChannels: boolean } | null =
  null

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
  lastCacheShape = null
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
  const snapshot: CatalogSnapshot = {
    account: meta.account,
    builtAt: meta.builtAt,
    demo: meta.demo,
    categories: meta.categories,
    counts: meta.counts,
    channels,
    movies,
    series,
  }
  if (meta.complete === false) partialCaches.add(snapshot)
  lastCacheShape = {
    builtAt: meta.builtAt,
    movieParts: meta.movieParts,
    seriesParts: meta.seriesParts,
    hasChannels: channels.length > 0,
  }
  return snapshot
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
  // The index behind every keystroke in Search. Built in slices here, while the
  // launch intro is on screen, so the first search on a cached library filters
  // instead of indexing 57k titles inside the tap.
  await warmSearchIndex(snapshot)
  await warmTrending(snapshot)
}

async function writeCache(account: string, snapshot: CatalogSnapshot, complete = false): Promise<void> {
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
    complete,
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

/**
 * Mid-load saves used to hand the whole snapshot to IndexedDB every fifteen
 * seconds. On a 46k-title library that is the entire catalogue rewritten a dozen
 * times while the viewer is browsing: megabytes of pointless writes and a
 * stutter each time. Only the parts that are not stored yet are written now, so
 * a save costs the titles that arrived since the last one.
 */
let persistTimer = 0
let persistAt = 0
/** Titles already in IndexedDB, counted as whole parts, for this load. */
let storedMovies = 0
let storedSeries = 0
let storedChannelsFor = 0
/** Saves queue behind each other: two overlapping writers would interleave parts. */
let writeChain: Promise<void> = Promise.resolve()

/** Stores every complete part that is not stored yet; returns the new count. */
async function storeNewParts(
  account: string,
  kind: 'movies' | 'series',
  items: Title[],
  already: number,
): Promise<number> {
  const fullParts = Math.floor(items.length / PART_SIZE)
  let stored = already
  for (let part = Math.floor(already / PART_SIZE); part < fullParts; part += 1) {
    const slice = items.slice(part * PART_SIZE, (part + 1) * PART_SIZE)
    await idbSet(`${cacheKey(account)}:${kind}:${part}`, slice)
    stored = (part + 1) * PART_SIZE
    await breathe()
  }
  return stored
}

function schedulePersist(account: string): void {
  if (persistTimer) return
  const wait = Math.max(0, 15_000 - (Date.now() - persistAt))
  persistTimer = window.setTimeout(() => {
    persistTimer = 0
    persistAt = Date.now()
    writeChain = writeChain
      .then(async () => {
        const current = useCatalog.getState().snapshot
        if (!current || current.account !== account) return
        storedMovies = await storeNewParts(account, 'movies', current.movies, storedMovies)
        storedSeries = await storeNewParts(account, 'series', current.series, storedSeries)
        // Channels are one list and never grow in place, so they are written
        // once per build rather than on every save.
        if (storedChannelsFor !== current.builtAt && current.channels.length) {
          await idbSet(`${cacheKey(account)}:channels`, current.channels)
          storedChannelsFor = current.builtAt
        }
        if (!storedMovies && !storedSeries) return
        // The reader only looks at the parts this meta names, so a library that
        // is still growing reads back exactly what has been written.
        const meta: CacheMeta = {
          builtAt: current.builtAt,
          account: current.account,
          demo: current.demo,
          categories: current.categories,
          counts: { ...current.counts, movies: storedMovies, series: storedSeries },
          movieParts: Math.floor(storedMovies / PART_SIZE),
          seriesParts: Math.floor(storedSeries / PART_SIZE),
          complete: false,
        }
        await idbSet(`${cacheKey(account)}:meta`, meta)
      })
      .catch((error) => console.warn('[catalog] cache write failed', error))
  }, wait)
}

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
    // A new load starts with nothing of its own stored yet; the parts already
    // on disk from an earlier visit are still valid and are skipped by count.
    storedMovies = 0
    storedSeries = 0

    const run = async () => {
      const cached = await readCache(account)
      // Resuming a library a previous visit was still downloading: its stored
      // parts hold the titles this visit starts from, so the counters are seeded
      // with them and the first save writes only what is new. Without this the
      // resumed load rewrote every part it had just read back.
      if (cached && partialCaches.has(cached) && lastCacheShape) {
        storedMovies = lastCacheShape.movieParts * PART_SIZE
        storedSeries = lastCacheShape.seriesParts * PART_SIZE
        storedChannelsFor = lastCacheShape.hasChannels ? lastCacheShape.builtAt : 0
      }
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
        // A cache written mid-load paints the library but is not the finished
        // article, so the rest keeps downloading instead of being skipped.
        if (hasFreshLiveCatalog(cached) && !partialCaches.has(cached)) return
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

        // A resumed partial library continues from what is already on disk:
        // the new pull then appends only the titles it does not have yet (the
        // dedupe below seeds itself from these lists), and the cache counters
        // seeded from the stored meta stay true for the whole visit.
        const resumed = cached && partialCaches.has(cached) ? cached : null
        let channels: Title[] = resumed?.channels ?? []
        let movies: Title[] = resumed?.movies ?? []
        let series: Title[] = resumed?.series ?? []
        const catArg = {
          live: categories.live as RawCategory[],
          vod: categories.vod as RawCategory[],
          series: categories.series as RawCategory[],
        }

        // A 57k-title library must not block Live TV behind one giant response:
        // publish each section as soon as it is normalized.
        // A snapshot published mid-load must keep one birthday: consumers cache
        // their derived work per builtAt, and a fresh stamp on every incremental
        // publish would throw the search index away and rebuild it each time.
        const builtStamp = Date.now()
        const publish = (progress: number) => {
          const snapshot: CatalogSnapshot = {
            account,
            builtAt: builtStamp,
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
          // Persist while the library is still arriving, so the next visit opens
          // with thousands of searchable titles instead of an empty shelf. A
          // full pull can take a minute; waiting for it meant most visits never
          // wrote a cache at all.
          if (movies.length + series.length >= 3_000) schedulePersist(account)
          return snapshot
        }

        // The movie and series pulls are three megabytes each and take about
        // half a minute. Their entries are indexed in batches as they arrive, so
        // search answers a query against the first few thousand titles in about
        // a second and keeps filling while the rest is still on the wire.
        let movieQueue: RawVodStream[] = []
        let seriesQueue: RawSeries[] = []
        let movieTimer = 0
        let seriesTimer = 0
        const seenMovieIds = new Set<number>()
        const seenSeriesIds = new Set<number>()
        const knownMovieKeys = new Set<string>()
        const knownSeriesKeys = new Set<string>()
        /** The complete movie list has been indexed; slices must stop adding. */
        let fullMoviesPulled = false
        const seedKnownMovies = () => {
          if (knownMovieKeys.size || !movies.length) return
          for (const title of movies) {
            knownMovieKeys.add(title.key)
            seenMovieIds.add(title.id)
          }
        }
        const seedKnownSeries = () => {
          if (knownSeriesKeys.size || !series.length) return
          for (const title of series) {
            knownSeriesKeys.add(title.key)
            seenSeriesIds.add(title.id)
          }
        }
        /**
         * "Showing N titles" is a promise about what is on screen, and the
         * streamed batches kept growing the grid under a number written at the
         * first paint — the page claimed 836 while holding 4,050. While the page
         * is in that state the count is restated; a pull narrating its own
         * progress ("Loading movies · 3/105") is left alone.
         */
        const restateTitleCount = () => {
          if (!get().phase.startsWith('Showing')) return
          set({ phase: `Showing ${movies.length.toLocaleString()} titles` })
        }
        const drainMovies = () => {
          movieTimer = 0
          const batch = movieQueue
          movieQueue = []
          // The finished pull wins: never add a slice to a complete list.
          if (!batch.length || fullMoviesPulled) return
          void buildCatalogAsync({ account, live: [], vod: batch, seriesRaw: [], categories: catArg })
            .then((built) => {
              if (fullMoviesPulled) return
              for (const title of built.movies) {
                if (knownMovieKeys.has(title.key)) continue
                knownMovieKeys.add(title.key)
                movies.push(title)
              }
              publish(Math.min(69, 46 + Math.floor(movies.length / 2000)))
              restateTitleCount()
            })
            .catch((error) => console.warn('[catalog] movie batch failed', error))
        }
        const drainSeries = () => {
          seriesTimer = 0
          const batch = seriesQueue
          seriesQueue = []
          if (!batch.length || seriesRaw.length) return
          void buildCatalogAsync({ account, live: [], vod: [], seriesRaw: batch, categories: catArg })
            .then((built) => {
              if (seriesRaw.length) return
              for (const title of built.series) {
                if (knownSeriesKeys.has(title.key)) continue
                knownSeriesKeys.add(title.key)
                series.push(title)
              }
              publish(Math.min(87, 49 + Math.floor(series.length / 600)))
            })
            .catch((error) => console.warn('[catalog] series batch failed', error))
        }
        const appendMovieBatch = (batch: RawVodStream[]) => {
          seedKnownMovies()
          for (const item of batch) {
            const id = Number(item.stream_id)
            if (!id || seenMovieIds.has(id)) continue
            seenMovieIds.add(id)
            movieQueue.push(item)
          }
          if (!movieTimer) movieTimer = window.setTimeout(drainMovies, 300)
        }
        const appendSeriesBatch = (batch: RawSeries[]) => {
          seedKnownSeries()
          for (const item of batch) {
            const id = Number(item.series_id)
            if (!id || seenSeriesIds.has(id)) continue
            seenSeriesIds.add(id)
            seriesQueue.push(item)
          }
          if (!seriesTimer) seriesTimer = window.setTimeout(drainSeries, 300)
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
                // The full pull may have landed while this slice was indexing,
                // and streamed batches may already have put more on screen.
                if (seriesRaw.length || series.length > raw.length) return
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
                  // Never shrink the grid: by now the streamed batches may have
                  // put far more titles up than this starter slice holds.
                  if (fullMoviesPulled || movies.length > raw.length) return
                  // Deliberately does not set `vod`: that flag means the whole
                  // pull finished, and setting it here stopped every later
                  // streamed batch from reaching the grid.
                  movies = built.movies
                  // This slice is a different list from whatever was stored.
                  storedMovies = 0
                  publish(45)
                  set({ phase: `Showing ${movies.length.toLocaleString()} titles` })
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
        // The big pulls stream now, so they only need the starter's head start
        // long enough to get its first category in flight — waiting the old six
        // seconds put the first searchable titles that much later, which is what
        // a cold Search waited on.
        const starterSettled = Promise.race([
          starterTask,
          new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
        ])
        /**
         * Pulls the whole library one category at a time, four at once.
         *
         * The panel's single-call list is ~20 MB of JSON (3.4 MB compressed) and
         * on a slow or flaky link it either crawls for a minute or dies with an
         * HTTP/2 reset that loses everything. Per-category calls are 4-160 KB, so
         * the first ones land in about a second, the grid and the search index
         * grow from the first batch, and one dead category costs only itself.
         */
        const pullByCategory = async <T>(
          ids: string[],
          fetchOne: (id: string, onBatch: (items: T[]) => void) => Promise<T[]>,
          append: (items: T[]) => void,
          label: string,
          idOf: (item: T) => number,
        ): Promise<T[]> => {
          const queue = [...ids]
          const out = new Map<number, T>()
          const failed: string[] = []
          let done = 0
          /** Fetches one category; false means it never arrived. */
          const pullOne = async (id: string): Promise<boolean> => {
            let streamed = 0
            const take = (items: T[]) => {
              if (!items.length) return
              for (const item of items) {
                const key = idOf(item)
                if (key) out.set(key, item)
              }
              streamed += items.length
              append(items)
            }
            try {
              const list = await fetchOne(id, take)
              // A body that never streamed arrives whole here instead.
              if (!streamed && list.length) take(list)
              return true
            } catch (error) {
              console.warn(`[catalog] ${label} category failed`, id, error)
              return false
            }
          }
          const worker = async () => {
            for (;;) {
              const id = queue.shift()
              if (!id) return
              if (!(await pullOne(id))) failed.push(id)
              done += 1
              if (done % 3 === 0 || done === ids.length) {
                set({ phase: `Loading ${label} · ${done}/${ids.length} categories` })
              }
              // A breath between categories: the panel rate-limits a burst, and
              // a tenth of a second costs nothing across a hundred categories.
              await new Promise((resolve) => setTimeout(resolve, 250))
            }
          }
          await Promise.all([worker(), worker(), worker(), worker()])
          // The panel refuses requests in bursts, and a refused category used to
          // be written off for the whole visit — the library simply lacked it and
          // search could never find those titles. Whatever did not land is asked
          // for again, one at a time, with a longer breath between them.
          for (const id of failed) {
            if (!(await pullOne(id))) console.warn(`[catalog] ${label} category still missing`, id)
            await new Promise((resolve) => setTimeout(resolve, 900))
          }
          return [...out.values()]
        }

        const vodTask = starterSettled
          .then(async () => {
            const ids = catArg.vod.map((c) => String(c.category_id))
            const r = ids.length
              ? await pullByCategory<RawVodStream>(
                  ids,
                  (id, onBatch) => getMovies(id, onBatch),
                  appendMovieBatch,
                  'movies',
                  (item) => Number(item.stream_id),
                )
              : await getMovies(undefined, appendMovieBatch)
            return r
          })
          .then(async (r) => {
            // A pull that died on the wire must not erase the thousands of titles
            // its streamed batches already put on screen; the list simply stays
            // partial and the next launch tries again (the cache skips writes for
            // a snapshot that never saw a complete pull).
            if (!r.length) return
            fullMoviesPulled = true
            vod = r
            const built = await buildCatalogAsync({ account, live: [], vod: r, seriesRaw: [], categories: catArg })
            if (!built.movies.length) return
            movies = built.movies
            // A fresh pull reorders and re-ids the list, so nothing on disk can
            // be trusted as already written against these arrays.
            storedMovies = 0
            publish(70)
            set({ phase: `Movies ready · ${r.length.toLocaleString()} titles` })
          })
        const seriesTask = starterSettled
          .then(async () => {
            const ids = catArg.series.map((c) => String(c.category_id))
            return ids.length
              ? await pullByCategory<RawSeries>(
                  ids,
                  (id, onBatch) => getSeries(id, onBatch),
                  appendSeriesBatch,
                  'series',
                  (item) => Number(item.series_id),
                )
              : await getSeries(undefined, appendSeriesBatch)
          })
          .then(async (r) => {
            if (!r.length) return
            seriesRaw = r
            const built = await buildCatalogAsync({ account, live: [], vod: [], seriesRaw: r, categories: catArg })
            if (!built.series.length) return
            series = built.series
            storedSeries = 0
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
        // A snapshot that only ever saw the starter categories is not the
        // library. Writing it would pin Movies and Search to those few hundred
        // titles for six hours, so it is kept on screen but not persisted and
        // the next launch tries the full pull again.
        const completeEnough =
          fullMoviesPulled || seriesRaw.length > 0 || movies.length + series.length > 5_000
        if (finalSnapshot && completeEnough) {
          const persist = () => void writeCache(account, finalSnapshot, completeEnough)
          const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
          if (typeof idle === 'function') idle(persist)
          else window.setTimeout(persist, 1200)
        }
      } catch (err) {
        // Only our own client's messages are written for a viewer; anything else
        // (a parser complaint, "Failed to fetch") is replaced with a sentence.
        const message =
          err instanceof PanelError ? err.message : 'The catalogue could not be loaded. Check your connection and try again.'
        if (!(err instanceof PanelError)) console.warn('[catalog] load failed', err)
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
