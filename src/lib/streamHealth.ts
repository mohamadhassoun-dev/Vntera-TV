import { API_BASE, PANEL_ORIGIN } from './config'
import { getApiCredentials, getSeriesInfo, getServerOrigin } from './xtream'
import type { CatalogSnapshot, SeriesInfo, Title } from '../types'

export type HealthScope = 'live' | 'movies' | 'series' | 'all'

export interface HealthTarget {
  kind: 'live' | 'movie' | 'series'
  /** Panel id of the title (series: the series id). */
  id: number
  name: string
  /** Media path after the panel origin, credentials included. Empty for series. */
  path: string
  /** Series only: the episode to probe is resolved when the check runs. */
  seriesId?: number
}

export interface HealthCheck {
  ok: boolean
  reason: string
  status: number
  ms: number
}

export interface HealthFailure {
  key: string
  kind: HealthTarget['kind']
  id: number
  name: string
  reason: string
  status: number
  at: number
}

/** How long one panel stream may take before a check calls it dead. */
const PROBE_TIMEOUT_MS = 20_000
/**
 * The panel answers 429 after a burst of catalogue calls, and one run asks for
 * the episodes of every series it checks. Those lookups go one at a time with a
 * gap so a run does not trip its own rate limit and report healthy shows as
 * broken.
 */
const INFO_GAP_MS = 500
const INFO_ATTEMPTS = 3

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Serialises the panel's catalogue calls for this tab. */
let infoChain: Promise<unknown> = Promise.resolve()

/**
 * The checker runs against the site's own bridge, so it sees exactly what the
 * player sees. A session pointed at another portal has no bridge in front of it,
 * and a direct panel call from the browser is refused for CORS.
 */
export function canCheckStreams(): boolean {
  return getServerOrigin().replace(/\/+$/, '') === PANEL_ORIGIN.replace(/\/+$/, '')
}

export function mediaPath(kind: 'live' | 'movie' | 'series', streamId: number, container?: string): string {
  const creds = getApiCredentials()
  if (!creds) return ''
  const user = encodeURIComponent(creds.username)
  const pass = encodeURIComponent(creds.password)
  const ext = kind === 'live' ? 'ts' : container || 'mp4'
  return `${kind}/${user}/${pass}/${streamId}.${ext}`
}

/** One short server-side probe of a media path. */
export async function probeMedia(path: string, signal: AbortSignal): Promise<HealthCheck> {
  const started = performance.now()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const forward = () => controller.abort()
  signal.addEventListener('abort', forward, { once: true })
  try {
    const response = await fetch(`${API_BASE}/__probe?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, reason: `http_${response.status}`, status: response.status, ms: 0 }
    const body = (await response.json()) as Partial<HealthCheck> & { bytes?: number }
    return {
      ok: Boolean(body.ok),
      reason: body.ok ? '' : body.reason || 'empty',
      status: Number(body.status ?? 0),
      ms: Number(body.ms ?? Math.round(performance.now() - started)),
    }
  } catch {
    if (signal.aborted) return { ok: false, reason: 'stopped', status: 0, ms: 0 }
    return { ok: false, reason: 'timeout', status: 0, ms: Math.round(performance.now() - started) }
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', forward)
  }
}

/** Probes one title: an episode of a series is resolved first, then checked. */
export async function probeTarget(target: HealthTarget, signal: AbortSignal): Promise<HealthCheck> {
  if (!target.path && !target.seriesId) return { ok: false, reason: 'no_stream', status: 0, ms: 0 }
  let path = target.path
  if (!path && target.seriesId) {
    const info = await seriesInfo(target.seriesId, signal)
    if (!info) return { ok: false, reason: signal.aborted ? 'stopped' : 'panel_busy', status: 0, ms: 0 }
    const seasons = Object.keys(info.episodes ?? {}).sort((a, b) => Number(a) - Number(b))
    const first = seasons.length ? info.episodes?.[seasons[0]]?.[0] : undefined
    if (!first) return { ok: false, reason: 'no_episodes', status: 0, ms: 0 }
    path = mediaPath('series', Number(first.id), first.container_extension)
  }
  if (!path) return { ok: false, reason: 'no_stream', status: 0, ms: 0 }

  let result = await probeMedia(path, signal)
  // A stream the panel refused because it was busy is worth asking again.
  if (!result.ok && result.status === 429 && !signal.aborted) {
    await sleep(900)
    result = await probeMedia(path, signal)
  }
  return result
}

/** One series' episode tree, queued behind the previous lookup and retried. */
async function seriesInfo(seriesId: number, signal: AbortSignal): Promise<SeriesInfo | null> {
  for (let attempt = 0; attempt < INFO_ATTEMPTS; attempt += 1) {
    if (signal.aborted) return null
    const queued = infoChain.then(async () => {
      await sleep(INFO_GAP_MS)
      return getSeriesInfo(seriesId)
    })
    infoChain = queued.catch(() => undefined)
    try {
      return await queued
    } catch {
      if (signal.aborted) return null
      await sleep(700 * (attempt + 1))
    }
  }
  return null
}

/**
 * One run's slice of the library.
 *
 * A full library is tens of thousands of titles, which is hours of checking, so
 * a run takes `limit` titles from a cursor and returns where the next run
 * continues. Repeated runs therefore cover everything without one endless scan.
 */
export function healthTargets(
  snapshot: CatalogSnapshot,
  scope: HealthScope,
  limit: number,
  from = 0,
): { targets: HealthTarget[]; cursor: number; pool: number } {
  const pool: Title[] =
    scope === 'live'
      ? snapshot.channels
      : scope === 'movies'
        ? snapshot.movies
        : scope === 'series'
          ? snapshot.series
          : [...snapshot.movies, ...snapshot.series, ...snapshot.channels]
  const total = pool.length
  if (!total) return { targets: [], cursor: 0, pool: 0 }

  const start = ((from % total) + total) % total
  const count = Math.min(limit, total)
  const targets: HealthTarget[] = []
  for (let n = 0; n < count; n += 1) {
    const title = pool[(start + n) % total]
    if (title.kind === 'series') {
      targets.push({ kind: 'series', id: title.id, name: title.name, path: '', seriesId: title.id })
      continue
    }
    const edition = title.editions[0]
    if (!edition) continue
    const path = mediaPath(title.kind, edition.streamId, edition.container)
    if (!path) continue
    targets.push({ kind: title.kind, id: title.id, name: title.name, path })
  }
  return { targets, cursor: (start + count) % total, pool: total }
}
