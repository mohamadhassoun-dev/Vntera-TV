#!/usr/bin/env node
/**
 * Serial library verifier.
 *
 * The panel this platform runs on allows ONE concurrent connection per
 * subscription (user_info.max_connections = "1"), so a sweep cannot be
 * parallel: every extra request is a customer who cannot watch. This walks the
 * library one item at a time, with backoff, and records what each probe found.
 *
 * What a probe proves: the source answered, sent real media bytes rather than an
 * HTML error page, and did so within the timeout. What it does NOT prove: that a
 * decoder can render it. That needs a real player, which is why results are
 * stored as "bytes" and never called "playable" on their own.
 *
 * Progress is written after every item, so a sweep can be stopped and resumed.
 *
 *   node scripts/verify-library.mjs --movies 6 --live 6 --episodes 4
 *   node scripts/verify-library.mjs --all --limit 500
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const ORIGIN = process.env.VNTERA_ORIGIN || 'http://movies.vntera.com/xtream'
const USER = process.env.VNTERA_USER || '2943386372'
const PASS = process.env.VNTERA_PASS || '4766862424'
const STATE = process.env.VNTERA_STATE || '.tools/verify-state.json'
const TIMEOUT_MS = Number(process.env.VNTERA_TIMEOUT_MS || 15000)
const PROBE_BYTES = 256 * 1024

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? Number(argv[i + 1]) : fallback
}
const has = (name) => argv.includes(`--${name}`)

const api = async (action, params = {}) => {
  const q = new URLSearchParams({ username: USER, password: PASS, action, ...params })
  const res = await fetch(`${ORIGIN}/player_api.php?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`panel ${res.status} for ${action}`)
  return res.json()
}

const loadState = () => {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'))
  } catch {
    return { items: {}, startedAt: new Date().toISOString() }
  }
}
let state = loadState()
const save = () => {
  mkdirSync(dirname(STATE), { recursive: true })
  writeFileSync(STATE, JSON.stringify(state, null, 2))
}

/** One item, one connection, one honest answer. */
const probe = async (url) => {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const buf = new Uint8Array(await res.arrayBuffer())
    const text = Buffer.from(buf).toString('utf8')
    // Live answers with a playlist, not media: the proof is its first segment.
    if (/^#EXTM3U/.test(text)) {
      const uri = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
      if (!uri) return { ok: false, status: res.status, bytes: buf.byteLength, contentType: 'playlist', ms: Date.now() - started, reason: 'empty-playlist' }
      const segment = await fetch(new URL(uri, url), { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const segBytes = new Uint8Array(await segment.arrayBuffer())
      const okSeg = segment.ok && segBytes.byteLength > 2048
      return {
        ok: okSeg,
        status: segment.status,
        bytes: segBytes.byteLength,
        contentType: segment.headers.get('content-type') || '',
        ms: Date.now() - started,
        reason: okSeg ? null : 'playlist-segment-empty',
      }
    }
    const first = text.slice(0, 12)
    const html = /^\s*<(!doctype|html|\?xml)/i.test(first) || /<html/i.test(first)
    const ok = res.ok && buf.byteLength > 2048 && !html
    return {
      ok,
      status: res.status,
      bytes: buf.byteLength,
      contentType: res.headers.get('content-type') || '',
      ms: Date.now() - started,
      reason: ok ? null : html ? 'html-instead-of-media' : buf.byteLength <= 2048 ? 'no-media-bytes' : `http-${res.status}`,
    }
  } catch (err) {
    return { ok: false, status: 0, bytes: 0, contentType: '', ms: Date.now() - started, reason: `network-${err.name}` }
  }
}

const streamUrl = (kind, id, ext) => {
  const base = ORIGIN.replace(/\/$/, '')
  const path = kind === 'live' ? 'live' : kind === 'series' ? 'series' : 'movie'
  return `${base}/${path}/${USER}/${PASS}/${id}.${ext || (kind === 'live' ? 'm3u8' : 'mp4')}`
}

const targets = []
const wantMovies = arg('movies', 0)
const wantLive = arg('live', 0)
const wantEpisodes = arg('episodes', 0)
const limit = arg('limit', 0)

const note = (t) => {
  if (limit && targets.length >= limit) return
  targets.push(t)
}

if (wantMovies || wantLive || wantEpisodes) {
  if (wantMovies) {
    const cats = await api('get_vod_categories')
    const cat = Array.isArray(cats) ? cats[0] : null
    const list = await api('get_vod_streams', cat ? { category_id: cat.category_id } : {})
    for (const m of (Array.isArray(list) ? list : []).slice(0, wantMovies)) {
      note({ kind: 'movie', id: m.stream_id, title: m.name, category: cat?.category_name ?? 'all', ext: m.container_extension })
    }
  }
  if (wantLive) {
    const cats = await api('get_live_categories')
    const cat = Array.isArray(cats) ? cats[0] : null
    const list = await api('get_live_streams', cat ? { category_id: cat.category_id } : {})
    for (const c of (Array.isArray(list) ? list : []).slice(0, wantLive)) {
      note({ kind: 'live', id: c.stream_id, title: c.name, category: cat?.category_name ?? 'all', ext: 'm3u8' })
    }
  }
  if (wantEpisodes) {
    const cats = await api('get_series_categories')
    const cat = Array.isArray(cats) ? cats[0] : null
    const series = await api('get_series', cat ? { category_id: cat.category_id } : {})
    const first = (Array.isArray(series) ? series : [])[0]
    if (first) {
      const info = await api('get_series_info', { series_id: first.series_id })
      const episodes = Object.values(info?.episodes ?? {}).flat().slice(0, wantEpisodes)
      for (const ep of episodes) {
        note({
          kind: 'series',
          id: ep.id,
          title: `${first.name} S${ep.season}E${ep.episode_num}`,
          category: cat?.category_name ?? 'all',
          ext: ep.container_extension,
        })
      }
    }
  }
}

if (!targets.length) {
  console.log('nothing selected — pass --movies N, --live N, --episodes N (and optionally --limit N)')
  process.exit(1)
}

const results = []
for (const [index, item] of targets.entries()) {
  const key = `${item.kind}:${item.id}`
  if (state.items[key]?.ok) {
    results.push({ ...item, ...state.items[key], skipped: true })
    continue
  }
  const probeResult = await probe(streamUrl(item.kind, item.id, item.ext))
  const record = {
    title: item.title,
    kind: item.kind,
    category: item.category,
    source: 'panel',
    testedAt: new Date().toISOString(),
    attempts: (state.items[key]?.attempts ?? 0) + 1,
    ...probeResult,
  }
  state.items[key] = record
  save()
  results.push({ ...item, ...record })
  const mark = record.ok ? 'OK  ' : 'FAIL'
  console.log(
    `${mark} [${index + 1}/${targets.length}] ${item.kind} ${item.id} · ${record.bytes.toLocaleString()}B · ${record.ms}ms · ${record.title?.slice(0, 46) ?? ''}${record.ok ? '' : ` · ${record.reason}`}`,
  )
  // A dead panel answers everything the same way; stop rather than hammer it.
  if (!record.ok && record.reason?.startsWith('network') && index > 0) {
    const recent = results.slice(-3)
    if (recent.length === 3 && recent.every((r) => r.reason?.startsWith('network'))) {
      console.error('three network failures in a row — stopping so the panel is left alone')
      break
    }
  }
  await new Promise((r) => setTimeout(r, 900))
}

const counted = results.filter((r) => !r.skipped)
const ok = counted.filter((r) => r.ok).length
console.log(
  `\ntested ${counted.length} · media bytes ${ok} · failed ${counted.length - ok} · state ${STATE}` +
    (results.length > counted.length ? ` · ${results.length - counted.length} already verified` : ''),
)
const slowest = counted.filter((r) => r.ok).sort((a, b) => b.ms - a.ms)[0]
if (slowest) console.log(`slowest working source: ${slowest.ms}ms · ${slowest.title}`)
