import { formatTimecode } from './format'

/**
 * The length shown on an episode thumbnail, or '' when there is none.
 *
 * The panel usually sends no length for an episode and sometimes sends a zero
 * timecode instead of leaving it out. Formatting either of those painted
 * "00:00:00" on every episode in a season, which reads as a broken player rather
 * than as missing data, so a zero value counts as no value at all.
 */
export function episodeDurationLabel(duration?: string | null, seconds?: number | null): string {
  const text = (duration ?? '').trim()
  if (text && !/^0{1,2}:0{2}:0{2}(\.0+)?$/.test(text)) return text
  return seconds && seconds > 0 ? formatTimecode(seconds) : ''
}
