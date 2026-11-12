import { API_BASE, PANEL_ORIGIN } from './config'
import type {
  EpgProgramme,
  RawCategory,
  RawEpgListing,
  RawLiveStream,
  RawSeries,
  RawVodStream,
  ServerInfo,
  SeriesInfo,
  UserInfo,
  VodInfo,
} from '../types'

export class PanelError extends Error {
  kind: 'auth' | 'network' | 'server' | 'expired'
  status?: number
  constructor(kind: PanelError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'PanelError'
    this.kind = kind
    this.status = status
  }
}

let credentials: { username: string; password: string } | null = null
let serverOrigin = PANEL_ORIGIN

export function setApiCredentials(username: string, password: string): void {
  credentials = { username, password }
}

export function clearApiCredentials(): void {
  credentials = null
}

export function getApiCredentials() {
  return credentials
}

export function setServerOrigin(origin: string): void {
  serverOrigin = origin.replace(/\/+$/, '')
}

export function getServerOrigin(): string {
  return serverOrigin
}

/** Same-origin proxy for the default panel; a custom portal is called directly
 *  (which works in native shells and wherever the portal sends CORS headers). */
export function resolveBase(origin = serverOrigin): string {
  return origin.replace(/\/+$/, '') === PANEL_ORIGIN.replace(/\/+$/, '') ? API_BASE : origin.replace(/\/+$/, '')
}/**
 * Minimal panel client on top of `fetch`: the app shipped axios (≈50 KB) in the
 * first-load bundle just for these few GET/POST pairs. Same shape, same retry
 * and error mapping, none of the dependency.
 */
type QueryParams = Record<string, unknown>

interface RequestOptions {
  params?: QueryParams
  timeout?: number
  responseType?: 'json' | 'text'
  headers?: Record<string, string>
  /** Accepted for call-site compatibility; bodies are always read as text. */
  transformResponse?: (data: string) => string
  /** The panel answers with a top-level array: read it entry by entry. */
  streamArray?: boolean
}

const DEFAULT_TIMEOUT = 30_000
const RETRY_DELAY_MS = 400
const MAX_RETRIES = 2

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function panelQuery(params: QueryParams, withCredentials: boolean): string {
  const all = withCredentials && credentials ? { ...params, ...credentials } : params
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(all)) {
    if (value == null) continue
    search.append(key, String(value))
  }
  return search.toString()
}

// `any` mirrors what axios gave every call site before: panel payloads are
// validated where they are consumed, not here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface PanelResponse<T = any> {
  data: T
}

/**
 * Reads a JSON array without parsing the whole payload in one call.
 *
 * `get_vod_streams` is tens of megabytes of JSON. One `JSON.parse` of that is
 * half a second on a desktop and several seconds on a phone, during which the
 * app does not paint — the freeze a viewer reads as the app hanging. Each entry
 * is parsed on its own here and the loop hands the frame back every so often, so
 * the same bytes cost a few milliseconds at a time.
 *
 * Anything that does not start with an array (an error object, for instance) is
 * kept whole and parsed normally.
 */
async function parseArrayBody<T>(response: Response): Promise<T[] | null> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  const out: T[] = []
  let buffer = ''
  let raw = ''
  let pos = 0
  let depth = 0
  let inString = false
  let escape = false
  let entryStart = -1
  let started = false
  let sinceYield = 0

  const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (!started) raw += text
      buffer += text
      for (; pos < buffer.length; pos += 1) {
        const code = buffer.charCodeAt(pos)
        if (inString) {
          if (escape) escape = false
          else if (code === 92) escape = true
          else if (code === 34) inString = false
          continue
        }
        if (code === 34) {
          inString = true
          continue
        }
        if (!started) {
          if (code === 91) {
            started = true
            raw = ''
          }
          continue
        }
        if (code === 123 || code === 91) {
          if (depth === 0) entryStart = pos
          depth += 1
          continue
        }
        if (code === 125 || code === 93) {
          if (depth > 0) depth -= 1
          if (depth === 0 && entryStart >= 0) {
            const slice = buffer.slice(entryStart, pos + 1)
            entryStart = -1
            try {
              out.push(JSON.parse(slice) as T)
            } catch {
              /* one malformed entry must not lose the rest */
            }
            if (++sinceYield >= 150) {
              sinceYield = 0
              await yieldToBrowser()
            }
          }
        }
      }
      // Keep only what is still being read: a partial entry, or nothing.
      if (entryStart > 0) {
        buffer = buffer.slice(entryStart)
        pos -= entryStart
        entryStart = 0
      } else if (entryStart < 0 && pos > 0) {
        buffer = ''
        pos = 0
      }
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }

  if (!started) {
    try {
      const whole = JSON.parse(raw || buffer) as unknown
      return Array.isArray(whole) ? (whole as T[]) : null
    } catch {
      return null
    }
  }
  return out
}

async function request<T = any>(
  method: 'GET' | 'POST',
  path: string,
  body?: string,
  options: RequestOptions = {},
): Promise<PanelResponse<T>> {
  const query = panelQuery(options.params ?? {}, method === 'GET')
  const url = `${resolveBase()}${path}${query ? `?${query}` : ''}`
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const retriable = method !== 'POST'

  const attempt = async (n: number): Promise<PanelResponse<T>> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...options.headers,
        },
      })
    } catch {
      clearTimeout(timer)
      if (retriable && n < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (n + 1))
        return attempt(n + 1)
      }
      throw new PanelError(
        'network',
        'Cannot reach Vntera. Check the portal address, or try again in a moment.',
      )
    }

    let text = ''
    let streamed: unknown[] | null = null
    try {
      if (options.streamArray && response.ok) {
        streamed = await parseArrayBody(response.clone())
        if (!streamed?.length) {
          // A streamed read can come back empty when the edge buffers or breaks
          // the body up oddly, and an empty line-up is a very different thing
          // from an unreadable one. Read it whole before concluding anything.
          try {
            const whole = JSON.parse(await response.text()) as unknown
            if (Array.isArray(whole) && whole.length) streamed = whole
          } catch {
            /* keep whatever the streamed read produced */
          }
        }
      } else {
        text = await response.text()
      }
    } catch {
      text = ''
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      if (response.status >= 500 && retriable && n < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (n + 1))
        return attempt(n + 1)
      }
      if (response.status === 401) {
        throw new PanelError(
          'auth',
          'Vntera rejected these credentials. Check the account and password.',
          response.status,
        )
      }
      if (response.status === 403) {
        throw new PanelError('auth', 'Vntera rejected this subscription.', response.status)
      }
      throw new PanelError('server', 'Vntera is having trouble right now. Try again in a moment.', response.status)
    }

    if (streamed) return { data: streamed as T }
    if (options.responseType === 'text') return { data: text as T }
    if (!text) return { data: null as T }
    try {
      return { data: JSON.parse(text) as T }
    } catch {
      // Some panels answer with plain text where JSON is expected.
      return { data: text as T }
    }
  }

  return attempt(0)
}

const api = {
  get: <T = any>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T = any>(path: string, body?: string, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
}

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

/** Never let one slow panel endpoint hold the whole catalog hostage. */
function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

function normalizeUserInfo(raw: UserInfo | undefined): UserInfo | null {
  if (!raw || typeof raw !== 'object' || raw.auth == null) return null
  return raw
}

function isExpired(info: UserInfo): boolean {
  if (!info.exp_date) return false
  const ts = Number(info.exp_date)
  if (!Number.isFinite(ts) || ts <= 0) return false
  return ts * 1000 < Date.now()
}

// ------------------------------ auth ---------------------------------------

export async function authenticate(
  username: string,
  password: string,
  origin?: string,
): Promise<{ userInfo: UserInfo; serverInfo: ServerInfo }> {
  if (origin) setServerOrigin(origin)
  const body = new URLSearchParams({ username, password })
  let data: { user_info?: UserInfo; server_info?: ServerInfo } | UserInfo
  try {
    const res = await api.post('/player_api.php', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 25_000,
    })
    data = res.data
  } catch (err) {
    // Some panels only answer GET for auth.
    if (err instanceof PanelError && err.kind === 'auth') {
      const res = await api.get('/player_api.php', { params: { username, password } })
      data = res.data
    } else throw err
  }

  const userInfoRaw = (data as { user_info?: UserInfo }).user_info ?? (data as UserInfo)
  const info = normalizeUserInfo(userInfoRaw)
  if (!info) throw new PanelError('auth', 'Vntera did not return a subscription. Check your username and password.')
  if (Number(info.auth) === 0) throw new PanelError('auth', info.message || 'Invalid username or password.')
  if (info.status && /disabled|banned|suspended/i.test(info.status)) {
    throw new PanelError('auth', `Subscription is ${info.status}.`)
  }
  if (isExpired(info)) throw new PanelError('expired', 'This subscription has expired.')

  credentials = { username, password }
  setServerOrigin(origin || serverOrigin)
  return {
    userInfo: info,
    serverInfo: ((data as { server_info?: ServerInfo }).server_info ?? {}) as ServerInfo,
  }
}

export async function getUserInfo(): Promise<{ userInfo: UserInfo; serverInfo: ServerInfo }> {
  const res = await api.get('/player_api.php')
  const data = res.data as { user_info?: UserInfo; server_info?: ServerInfo }
  const info = normalizeUserInfo(data.user_info)
  if (!info || Number(info.auth) === 0) throw new PanelError('auth', 'Session rejected by the panel.')
  return { userInfo: info, serverInfo: data.server_info ?? {} }
}

// --------------------------- catalog lists ---------------------------------

export async function getCategories(): Promise<{
  live: RawCategory[]
  vod: RawCategory[]
  series: RawCategory[]
}> {
  const [live, vod, series] = await Promise.all([
    withDeadline(
      api.get('/player_api.php', { params: { action: 'get_live_categories' } }).then((r) => asArray<RawCategory>(r.data)),
      12_000,
      [] as RawCategory[],
    ),
    withDeadline(
      api.get('/player_api.php', { params: { action: 'get_vod_categories' } }).then((r) => asArray<RawCategory>(r.data)),
      12_000,
      [] as RawCategory[],
    ),
    withDeadline(
      api.get('/player_api.php', { params: { action: 'get_series_categories' } }).then((r) => asArray<RawCategory>(r.data)),
      12_000,
      [] as RawCategory[],
    ),
  ])
  return { live, vod, series }
}

export async function getLiveChannels(categoryId?: string): Promise<RawLiveStream[]> {
  const res = await api.get('/player_api.php', {
    params: { action: 'get_live_streams', ...(categoryId ? { category_id: categoryId } : {}) },
    timeout: 60_000,
    streamArray: true,
  })
  return asArray<RawLiveStream>(res.data)
}

export async function getMovies(categoryId?: string): Promise<RawVodStream[]> {
  const res = await api.get('/player_api.php', {
    params: { action: 'get_vod_streams', ...(categoryId ? { category_id: categoryId } : {}) },
    timeout: 90_000,
    streamArray: true,
  })
  return asArray<RawVodStream>(res.data)
}

export async function getSeries(categoryId?: string): Promise<RawSeries[]> {
  const res = await api.get('/player_api.php', {
    params: { action: 'get_series', ...(categoryId ? { category_id: categoryId } : {}) },
    timeout: 90_000,
    streamArray: true,
  })
  return asArray<RawSeries>(res.data)
}

export async function getSeriesInfo(seriesId: number): Promise<SeriesInfo> {
  const res = await api.get('/player_api.php', { params: { action: 'get_series_info', series_id: seriesId } })
  const data = (res.data ?? {}) as SeriesInfo & { episodes?: Record<string, Array<unknown>> }
  const seasons = asArray<{ season_number: number | string; episode_count?: number; cover?: string }>(data.seasons)
  const episodes = data.episodes ?? {}
  return { ...data, seasons, episodes: episodes as SeriesInfo['episodes'] }
}

export async function getEpisodeInfo(
  seriesId: number,
  season: number,
  episode: number,
): Promise<SeriesInfo> {
  // Panels expose the whole season tree; the requested episode is selected locally.
  const info = await getSeriesInfo(seriesId)
  const list = info.episodes?.[String(season)] ?? []
  const found = list.find((e) => Number(e.episode_num) === episode)
  if (!found) throw new PanelError('server', `Episode S${season}E${episode} is not available.`)
  return info
}

export async function getVODInfo(vodId: number): Promise<VodInfo> {
  const res = await api.get('/player_api.php', { params: { action: 'get_vod_info', vod_id: vodId } })
  return (res.data ?? {}) as VodInfo
}

// ------------------------------- EPG ---------------------------------------

export function parsePanelTime(value?: string | number): number {
  if (value == null) return 0
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000
  const s = value.trim()
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n > 1e12 ? n : n * 1000
  }
  // 2024-10-24 18:30:00  /  20241024183000 +0300
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/)
  if (compact) {
    const [, y, mo, d, h, mi, se, tz] = compact
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z'}`
    return Date.parse(iso)
  }
  const parsed = Date.parse(s.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : 0
}

function mapListings(listings: RawEpgListing[], channelId: string): EpgProgramme[] {
  return listings
    .map((l) => {
      const start = parsePanelTime(l.start_timestamp ?? l.start)
      const end = parsePanelTime(l.stop_timestamp ?? l.end)
      return {
        channelId: l.channel_id || channelId,
        start,
        end: end > start ? end : start + 30 * 60_000,
        title: (l.title || 'Untitled').trim(),
        description: l.description || undefined,
        lang: l.lang,
        hasArchive: !!l.has_archive,
      }
    })
    .filter((p) => p.start > 0)
    .sort((a, b) => a.start - b.start)
}

export async function getEPG(channelId: string, _date?: string): Promise<EpgProgramme[]> {
  // get_simple_data_table covers the full available guide for one stream.
  const res = await api.get('/player_api.php', {
    params: { action: 'get_simple_data_table', stream_id: channelId },
  })
  const data = res.data as { epg_listings?: RawEpgListing[] }
  return mapListings(asArray<RawEpgListing>(data?.epg_listings), channelId)
}

export async function getShortEpg(streamId: number, limit = 4): Promise<EpgProgramme[]> {
  const res = await api.get('/player_api.php', {
    params: { action: 'get_short_epg', stream_id: streamId, limit },
  })
  const data = res.data as { epg_listings?: RawEpgListing[] }
  return mapListings(asArray<RawEpgListing>(data?.epg_listings), String(streamId))
}

// ---------------------------- streams / files ------------------------------

export function streamUrl(
  kind: 'live' | 'movie' | 'series',
  streamId: number,
  opts: { container?: string; liveFormat?: 'm3u8' | 'ts'; origin?: string } = {},
): string {
  const creds = credentials
  const base = resolveBase(opts.origin)
  if (!creds) return ''
  const { username, password } = creds
  if (kind === 'live') {
    const ext = opts.liveFormat ?? 'm3u8'
    return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
  }
  const ext = opts.container || 'mp4'
  return `${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
}

/**
 * The panel's own stream address, without the site bridge in front of it.
 *
 * The bridge is the right default (it answers 200 and is reachable from the
 * WebView), but a panel can refuse a bridge request — a spent connection slot or
 * a stale session token answers 401 — while its own address still serves the
 * file. Downloads keep this URL as the second chance.
 */
export function directStreamUrl(
  kind: 'live' | 'movie' | 'series',
  streamId: number,
  opts: { container?: string; liveFormat?: 'm3u8' | 'ts' } = {},
): string {
  const creds = credentials
  if (!creds) return ''
  const base = serverOrigin.replace(/\/+$/, '')
  const { username, password } = creds
  if (kind === 'live') {
    const ext = opts.liveFormat ?? 'm3u8'
    return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
  }
  const ext = opts.container || 'mp4'
  return `${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
}

export function m3uUrl(origin?: string): string {
  const creds = credentials
  if (!creds) return ''
  return `${resolveBase(origin)}/get.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(
    creds.password,
  )}&type=m3u_plus&output=ts`
}

export function xmltvUrl(origin?: string): string {
  const creds = credentials
  if (!creds) return ''
  return `${resolveBase(origin)}/xmltv.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(
    creds.password,
  )}`
}

export async function fetchM3U(): Promise<string> {
  const res = await api.get('/get.php', {
    params: { ...(credentials || {}), type: 'm3u_plus', output: 'ts' },
    responseType: 'text',
    timeout: 120_000,
    transformResponse: (d) => d,
  })
  return typeof res.data === 'string' ? res.data : String(res.data)
}

export async function fetchXmltv(): Promise<string> {
  const res = await api.get('/xmltv.php', {
    responseType: 'text',
    timeout: 180_000,
    transformResponse: (d) => d,
  })
  return typeof res.data === 'string' ? res.data : String(res.data)
}
