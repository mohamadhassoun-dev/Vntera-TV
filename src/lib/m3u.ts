// Streaming M3U / #EXTINF parser. Runs inside a Web Worker for large playlists
// (11k+ channels) so the UI thread never blocks.

export interface M3UEntry {
  name: string
  url: string
  logo?: string
  group?: string
  tvgId?: string
  tvgName?: string
  language?: string
  duration: number
}

const ATTR_RE = /([\w-]+)="([^"]*)"/g

export function parseExtinf(line: string) {
  const attrs: Record<string, string> = {}
  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(line))) attrs[m[1].toLowerCase()] = m[2]
  const commaIndex = line.lastIndexOf(',')
  const name = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : ''
  const duration = Number(line.match(/#EXTINF:\s*(-?\d+(?:\.\d+)?)/)?.[1] ?? -1)
  return { attrs, name, duration }
}

export function parseM3U(text: string): M3UEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: M3UEntry[] = []
  let pending: {
    name: string
    attrs: Record<string, string>
    duration: number
    group?: string
    vlc?: Record<string, string>
  } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('#EXTINF')) {
      const { attrs, name, duration } = parseExtinf(line)
      pending = { name, attrs, duration, group: attrs['group-title'] }
    } else if (line.startsWith('#EXTGRP:') && pending) {
      pending.group = line.slice(8).trim()
    } else if (line.startsWith('#EXTVLCOPT:') && pending) {
      const [k, v] = line.slice(11).split('=')
      pending.vlc = { ...(pending.vlc || {}), [k.trim().toLowerCase()]: v }
    } else if (!line.startsWith('#') && pending) {
      entries.push({
        name: pending.name,
        url: line,
        logo: pending.attrs['tvg-logo'],
        group: pending.group,
        tvgId: pending.attrs['tvg-id'],
        tvgName: pending.attrs['tvg-name'],
        language: pending.attrs['tvg-language'] || pending.attrs['tvg-lang'],
        duration: pending.duration,
      })
      pending = null
    }
  }
  return entries
}

/** Split a playlist into live channels, movies and series based on URL shape. */
export function classifyEntries(entries: M3UEntry[]) {
  const live: M3UEntry[] = []
  const vod: M3UEntry[] = []
  const series: M3UEntry[] = []
  for (const e of entries) {
    if (/\/series\//.test(e.url)) series.push(e)
    else if (/\/movie\//.test(e.url)) vod.push(e)
    else live.push(e)
  }
  return { live, vod, series }
}
