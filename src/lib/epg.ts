import type { EpgProgramme } from '../types'

export function nowPlaying(programmes: EpgProgramme[], at = Date.now()): EpgProgramme | undefined {
  return programmes.find((p) => p.start <= at && p.end > at)
}

export function nextUp(programmes: EpgProgramme[], at = Date.now()): EpgProgramme | undefined {
  return programmes.filter((p) => p.start > at).sort((a, b) => a.start - b.start)[0]
}

export function programmeProgress(p: EpgProgramme, at = Date.now()): number {
  const total = Math.max(1, p.end - p.start)
  return Math.min(100, Math.max(0, ((at - p.start) / total) * 100))
}

export function programmeListForChannel(map: Map<string, EpgProgramme[]>, channelId?: string): EpgProgramme[] {
  if (!channelId) return []
  return map.get(channelId) ?? []
}

export function formatClock(ts: number, locale = 'en-GB'): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
}
