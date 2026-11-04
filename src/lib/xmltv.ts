import type { EpgProgramme } from '../types'

/** Minimal XMLTV parser (programmes + channel names). Works on already-fetched
 *  text; the caller streams/caps the download because full guides are large. */
export function parseXmltv(xml: string): { programmes: EpgProgramme[]; channelNames: Record<string, string> } {
  const programmes: EpgProgramme[] = []
  const channelNames: Record<string, string> = {}

  const channelRe = /<channel[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/g
  let cm: RegExpExecArray | null
  while ((cm = channelRe.exec(xml))) {
    const [, id, body] = cm
    const name = body.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/)?.[1]
    if (name) channelNames[id] = decodeEntities(stripCdata(name)).trim()
  }

  const progRe = /<programme([^>]*)>([\s\S]*?)<\/programme>/g
  let pm: RegExpExecArray | null
  while ((pm = progRe.exec(xml))) {
    const [, attrs, body] = pm
    const channel = attrs.match(/channel="([^"]+)"/)?.[1] ?? ''
    const start = parseXmltvDate(attrs.match(/start="([^"]+)"/)?.[1])
    const stop = parseXmltvDate(attrs.match(/stop="([^"]+)"/)?.[1])
    const title = textOf(body, 'title')
    if (!channel || !start) continue
    programmes.push({
      channelId: channel,
      start,
      end: stop > start ? stop : start + 30 * 60_000,
      title: title || 'Untitled',
      description: textOf(body, 'desc') || undefined,
      lang: attrs.match(/lang="([^"]+)"/)?.[1],
      hasArchive: /<icon/.test(body),
    })
  }

  return { programmes, channelNames }
}

function textOf(body: string, tag: string): string {
  const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m ? decodeEntities(stripCdata(m[1])).trim() : ''
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

export function parseXmltvDate(value?: string): number {
  if (!value) return 0
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/)
  if (!m) return 0
  const [, y, mo, d, h, mi, se, tz] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z'}`
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? ts : 0
}

export function groupByChannel(programmes: EpgProgramme[]): Map<string, EpgProgramme[]> {
  const map = new Map<string, EpgProgramme[]>()
  for (const p of programmes) {
    const list = map.get(p.channelId) || []
    list.push(p)
    map.set(p.channelId, list)
  }
  for (const list of map.values()) list.sort((a, b) => a.start - b.start)
  return map
}
