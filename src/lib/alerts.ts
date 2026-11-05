import { useEffect, useMemo, useRef } from 'react'
import { useCatalog } from '../store/catalog'
import { useEpg } from '../store/epg'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { alertTitleKey, notificationKey, takeUnannounced } from './notifications'
import type { CatalogSnapshot, EpgProgramme, NotificationItem, Title } from '../types'

type AddNotification = (item: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => void

const idsKey = (account: string) => `vntera:alerts:ids:${account}`
const seenKey = (account: string) => `vntera:alerts:seen:${account}`
/** Titles this profile has already been told about, by identity not stream id. */
const MAX_SEEN = 4000
const EVENTS_KEY = 'vntera:alerts:events'
const GUIDE_KEY = 'vntera:alerts:guide'
const GUIDE_REFRESH_MS = 6 * 60 * 60 * 1000
const MAX_EVENTS = 240
const MAX_ADDED = 4
const MAX_REMOVED = 3
/** Module-level so a StrictMode remount cannot cancel the scheduled guide pull. */
let guideTimer: number | null = null
const FOOTBALL_WINDOW_SEC = 12 * 60 * 60
/** A diff larger than this is a re-index, not real editorial activity. */
const REINDEX_THRESHOLD = 40

const FOOTBALL_RE =
  /football|soccer|fifa|uefa|champions league|premier league|la liga|serie a|bundesliga|ligue 1|world cup|egypt cup|derby|\bvs\.?\b|\bfc\b|match ?day|كورة|مباراة|دوري|ريال|برشلونة/i
const FOOTBALL_CHANNEL_RE = /football|soccer|bein|dazn|supersport|espn|كورة|رياضة/i

interface IdState {
  movies: string
  series: string
  builtAt: number
}

/** XMLTV stores epoch milliseconds; the short EPG endpoint uses seconds. */
function toSeconds(value: number): number {
  return value > 1e11 ? Math.round(value / 1000) : value
}

function readIds(account: string): IdState | null {
  try {
    const raw = localStorage.getItem(idsKey(account))
    if (!raw) return null
    const parsed = JSON.parse(raw) as IdState
    if (typeof parsed?.movies !== 'string' || typeof parsed?.series !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function writeIds(account: string, state: IdState) {
  try {
    localStorage.setItem(idsKey(account), JSON.stringify(state))
  } catch {
    /* Storage full: alerts keep working for this session. */
  }
}

function readSeen(account: string): string[] {
  try {
    const raw = localStorage.getItem(seenKey(account))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function writeSeen(account: string, keys: readonly string[]) {
  try {
    localStorage.setItem(seenKey(account), JSON.stringify(keys.slice(-MAX_SEEN)))
  } catch {
    /* Non-fatal. */
  }
}

function readEvents(): string[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function writeEvents(keys: string[]) {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(keys.slice(-MAX_EVENTS)))
  } catch {
    /* Non-fatal. */
  }
}

function newTitleNotification(title: Title): Omit<NotificationItem, 'id' | 'createdAt' | 'read'> {
  const isSeries = title.kind === 'series'
  return {
    kind: 'content',
    title: `${isSeries ? 'New series' : 'New movie'}: ${title.name}`,
    body: `${title.year ? `${title.year} · ` : ''}Just added to Vntera`,
    href: `/title/${title.kind}/${title.id}`,
    poster: title.poster,
  }
}

function diffCatalog(snapshot: CatalogSnapshot, previous: CatalogSnapshot | null, add: AddNotification) {
  const account = snapshot.account
  const state = readIds(account)
  // A panel re-index hands the same show a new stream id; identity is what stops
  // it from being announced a second time.
  const seen = new Set(readSeen(account))
  // Announcements made before the seen list existed are re-derived from the
  // centre itself, so a title already on the list is never announced again.
  const announced = new Set(
    useLibrary
      .getState()
      .notifications.filter((n) => n.kind === 'content')
      .map((n) => notificationKey(n)),
  )
  const alreadyAnnounced = (title: Title) =>
    announced.has(notificationKey(newTitleNotification(title)))
  // Seed the identity list from titles already sitting in the centre, so the
  // history survives "Clear all" on a profile that upgraded mid-announcement.
  if (announced.size) {
    for (const title of [...snapshot.movies, ...snapshot.series]) {
      if (alreadyAnnounced(title)) seen.add(alertTitleKey(title))
    }
  }

  const nextMovieIds = snapshot.movies.map((t) => String(t.id))
  const nextSeriesIds = snapshot.series.map((t) => String(t.id))
  const nextMovies = new Set(nextMovieIds)
  const nextSeries = new Set(nextSeriesIds)

  // First launch for this profile: remember the library instead of announcing 60k
  // titles, but surface the freshest additions so the centre is not empty.
  if (!state) {
    writeIds(account, { movies: nextMovieIds.join(','), series: nextSeriesIds.join(','), builtAt: snapshot.builtAt })
    const recent = [...snapshot.movies, ...snapshot.series]
      .filter((t) => t.hasArtwork && t.addedAt > 0 && Date.now() / 1000 - t.addedAt <= 14 * 86_400)
      .sort((a, b) => b.addedAt - a.addedAt)
    const fresh = takeUnannounced(recent, seen, 3, alreadyAnnounced)
    for (const title of fresh.reverse()) add(newTitleNotification(title))
    writeSeen(account, [...seen])
    return
  }

  const prevMovies = new Set(state.movies.split(',').filter(Boolean))
  const prevSeries = new Set(state.series.split(',').filter(Boolean))

  const addedMovies = snapshot.movies.filter((t) => t.hasArtwork && !prevMovies.has(String(t.id)))
  const addedSeries = snapshot.series.filter((t) => t.hasArtwork && !prevSeries.has(String(t.id)))
  const removedMovies = [...prevMovies].filter((id) => !nextMovies.has(id))
  const removedSeries = [...prevSeries].filter((id) => !nextSeries.has(id))

  const addedTotal = addedMovies.length + addedSeries.length
  const removedTotal = removedMovies.length + removedSeries.length
  const reindex = addedTotal > REINDEX_THRESHOLD || removedTotal > REINDEX_THRESHOLD

  if (!reindex) {
    const announceMovies = takeUnannounced(
      addedMovies.sort((a, b) => b.addedAt - a.addedAt),
      seen,
      MAX_ADDED,
      alreadyAnnounced,
    )
    const announceSeries = takeUnannounced(
      addedSeries.sort((a, b) => b.addedAt - a.addedAt),
      seen,
      2,
      alreadyAnnounced,
    )
    announceMovies.forEach((title) => add(newTitleNotification(title)))
    announceSeries.forEach((title) => add(newTitleNotification(title)))

    const names = new Map<number, string>()
    previous?.movies.forEach((t) => names.set(t.id, t.name))
    previous?.series.forEach((t) => names.set(t.id, t.name))

    removedMovies.slice(0, MAX_REMOVED).forEach((id) => {
      const name = names.get(Number(id))
      add({
        kind: 'system',
        title: name ? `Removed: ${name}` : 'Movie removed',
        body: name ? 'No longer available in the catalog.' : 'A movie left the catalog.',
      })
    })
    removedSeries.slice(0, 2).forEach((id) => {
      const name = names.get(Number(id))
      add({
        kind: 'system',
        title: name ? `Removed: ${name}` : 'Series removed',
        body: name ? 'No longer available in the catalog.' : 'A series left the catalog.',
      })
    })
  }

  writeIds(account, {
    movies: nextMovieIds.join(','),
    series: nextSeriesIds.join(','),
    builtAt: snapshot.builtAt,
  })
  writeSeen(account, [...seen])
}

/** Catalog-change and football alerts. Mounted once in the app shell. */
export function useAutoAlerts() {
  const snapshot = useCatalog((s) => s.snapshot)
  const status = useCatalog((s) => s.status)
  const progress = useCatalog((s) => s.progress)
  const addNotification = useLibrary((s) => s.addNotification)
  const notificationsOn = useSettings((s) => s.notifications)
  const epgAlerts = useSettings((s) => s.epgAlerts)
  const ensure = useEpg((s) => s.ensure)
  const epgCache = useEpg((s) => s.cache)
  const fullGuideLoaded = useEpg((s) => s.fullGuideLoaded)
  const fullGuideBusy = useEpg((s) => s.fullGuideBusy)
  const loadFullGuide = useEpg((s) => s.loadFullGuide)
  const previous = useRef<CatalogSnapshot | null>(null)

  const footballChannels = useMemo(() => {
    if (!snapshot) return []
    return snapshot.channels.filter((c) => FOOTBALL_CHANNEL_RE.test(c.name)).slice(0, 4)
  }, [snapshot])

  // Wait for the final publish, then diff against the previous snapshot.
  useEffect(() => {
    if (!snapshot || !notificationsOn || status !== 'ready' || progress < 100) return
    const timer = window.setTimeout(() => {
      diffCatalog(snapshot, previous.current, addNotification)
      previous.current = snapshot
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [snapshot, status, progress, notificationsOn, addNotification])

  // Short EPG is cheap and works on most panels.
  useEffect(() => {
    if (!notificationsOn || !epgAlerts) return
    for (const channel of footballChannels) {
      void ensure({ channelId: channel.epgChannelId, streamId: channel.id, name: channel.name })
    }
  }, [footballChannels, notificationsOn, epgAlerts, ensure])

  // This panel returns an empty short EPG, so pull the full XMLTV guide at most
  // every six hours when no programme data is present.
  useEffect(() => {
    if (!snapshot || !notificationsOn || !epgAlerts || !footballChannels.length) return
    if (fullGuideLoaded || fullGuideBusy || guideTimer !== null) return
    if (Object.values(epgCache).some((entry) => entry.programmes.length > 0)) return

    let lastAttempt = 0
    try {
      lastAttempt = Number(localStorage.getItem(GUIDE_KEY) ?? 0)
    } catch {
      lastAttempt = 0
    }
    if (Date.now() - lastAttempt < GUIDE_REFRESH_MS) return

    guideTimer = window.setTimeout(() => {
      guideTimer = null
      try {
        localStorage.setItem(GUIDE_KEY, String(Date.now()))
      } catch {
        /* Non-fatal. */
      }
      void loadFullGuide()
    }, 4000)
  }, [
    snapshot,
    notificationsOn,
    epgAlerts,
    footballChannels,
    epgCache,
    fullGuideLoaded,
    fullGuideBusy,
    loadFullGuide,
  ])

  // Turn live/upcoming football fixtures from the guide into one-off alerts.
  useEffect(() => {
    if (!snapshot || !notificationsOn || !epgAlerts) return

    const channelsByEpg = new Map<string, Title>()
    for (const channel of snapshot.channels) {
      if (channel.epgChannelId) channelsByEpg.set(String(channel.epgChannelId), channel)
      channelsByEpg.set(String(channel.id), channel)
    }

    const now = Date.now() / 1000
    const notified = new Set(readEvents())
    const fixtures: Array<{ programme: EpgProgramme; channel: Title; start: number }> = []

    for (const [epgKey, entry] of Object.entries(epgCache)) {
      const channel = channelsByEpg.get(epgKey)
      if (!channel) continue
      for (const programme of entry.programmes) {
        const start = toSeconds(programme.start)
        const end = toSeconds(programme.end)
        if (end < now || start > now + FOOTBALL_WINDOW_SEC) continue
        if (!FOOTBALL_RE.test(programme.title)) continue
        const key = `${channel.id}|${start}|${programme.title}`
        if (notified.has(key)) continue
        notified.add(key)
        fixtures.push({ programme, channel, start })
      }
    }

    if (!fixtures.length) return
    writeEvents([...notified])

    fixtures
      .sort((a, b) => a.start - b.start)
      .slice(0, 2)
      .forEach(({ programme, channel, start }) => {
        const kickoff = new Date(start * 1000)
        const when =
          start <= now
            ? 'Live now'
            : kickoff.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        addNotification({
          kind: 'live',
          title: `Football: ${programme.title}`,
          body: `${channel.name} · ${when}`,
          href: `/watch/live/${channel.id}`,
          poster: channel.poster,
        })
      })
  }, [snapshot, epgCache, notificationsOn, epgAlerts, addNotification])
}
