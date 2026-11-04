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
import { buildCatalog, featuredChannelLabel } from '../lib/normalize'
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
  reset: () => void
}

// v2: names are prefix-stripped and duplicate provider editions merged.
const cacheKey = (account: string) => `catalog:v2:${account}`

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
      const cached = await idbGet<CatalogSnapshot>(cacheKey(account))
      const fresh = cached && Date.now() - cached.builtAt < REFRESH_INTERVAL_MS
      if (cached && !opts.force) {
        set({ snapshot: cached, status: 'ready', progress: 100, phase: '' })
        if (fresh) return
      } else if (!opts.force) {
        set({ status: 'loading', phase: 'Connecting to panel', progress: 4 })
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
          set({ snapshot, status: 'ready', progress, error: null, offline: false })
          return snapshot
        }

        const liveTask = getLiveChannels().then((r) => {
          live = r
          channels = buildCatalog({ account, live: r, vod: [], seriesRaw: [], categories: catArg }).channels
          const partial = publish(35)
          // Cache the live snapshot immediately: a slow 57k VOD pull must not
          // leave the next launch with an empty catalog.
          if (partial.channels.length) void idbSet(cacheKey(account), partial)
          set({ phase: `Live ready · ${r.length.toLocaleString()} channels` })
        })
        const vodTask = getMovies().then((r) => {
          vod = r
          movies = buildCatalog({ account, live: [], vod: r, seriesRaw: [], categories: catArg }).movies
          publish(70)
          set({ phase: `Movies ready · ${r.length.toLocaleString()} titles` })
        })
        const seriesTask = getSeries().then((r) => {
          seriesRaw = r
          series = buildCatalog({ account, live: [], vod: [], seriesRaw: r, categories: catArg }).series
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
          throw new PanelError('server', 'The panel returned an empty library. Check that the subscription is active.')
        }

        // The M3U fallback above may have produced channels after the live task.
        if (!channels.length && live.length) {
          channels = buildCatalog({ account, live, vod: [], seriesRaw: [], categories: catArg }).channels
        }
        publish(100)
        set({
          status: 'ready',
          phase: '',
          progress: 100,
          error: failed ? 'Some sections failed to refresh; showing what loaded.' : null,
        })
        // Persist after paint: a 60k-title snapshot must not delay first render.
        const finalSnapshot = get().snapshot
        if (finalSnapshot) void idbSet(cacheKey(account), finalSnapshot)
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

/** The curated Shortcut channels, in configuration order, omitting any channel
 *  this panel does not carry. */
export function featuredChannels(snapshot: CatalogSnapshot | null): FeaturedChannelShortcut[] {
  if (!snapshot) return []
  const out: FeaturedChannelShortcut[] = []
  for (const entry of FEATURED_CHANNELS) {
    const channel = entry.id
      ? snapshot.channels.find((c) => c.id === entry.id)
      : snapshot.channels.find((c) => featuredChannelLabel(c) === entry.label)
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
