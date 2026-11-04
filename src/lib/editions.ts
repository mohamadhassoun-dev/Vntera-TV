import type { Quality } from '../types'

export const QUALITY_RANK: Record<Quality, number> = { SD: 1, HD: 2, FHD: 3, '4K': 4 }

export interface NetworkSpeed {
  /** The browser (or the profile) asked to spare data. */
  saveData?: boolean
  /** Network Information API bucket, e.g. "3g" or "4g". */
  effectiveType?: string
  /** Estimated downlink in Mbit/s. */
  downlink?: number
}

/** Highest quality a link can sustain without constant rebuffering, or null if it looks fine. */
export function slowNetworkCap(speed: NetworkSpeed): Quality | null {
  if (speed.saveData) return 'SD'
  if (speed.effectiveType === 'slow-2g' || speed.effectiveType === '2g') return 'SD'
  if (speed.effectiveType === '3g') return 'HD'
  // "4g" only says the radio is fast; the measured downlink is what decides
  // whether a 4K file can actually keep up. Safari/Firefox only report this.
  if (typeof speed.downlink === 'number' && speed.downlink > 0) {
    if (speed.downlink < 1.2) return 'SD'
    if (speed.downlink < 3) return 'HD'
    if (speed.downlink < 8) return 'FHD'
  }
  return null
}

/** Read the browser's connection hints once, for callers that cannot pass them in. */
export function detectNetworkSpeed(saveData = false): NetworkSpeed {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } })
    .connection
  return {
    saveData: saveData || Boolean(connection?.saveData),
    effectiveType: connection?.effectiveType,
    downlink: connection?.downlink,
  }
}

/**
 * Pick the edition to stream. A pinned quality wins, otherwise the link decides:
 * slow connections start at the lowest edition instead of stalling on a 4K file.
 */
export function pickEdition<E extends { quality: Quality }>(
  editions: E[],
  preference: Quality | 'auto',
  speed: NetworkSpeed = {},
): E | undefined {
  if (!editions.length) return undefined
  const bestFirst = [...editions].sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])
  const cap = preference === 'auto' ? slowNetworkCap(speed) : preference
  if (!cap) return bestFirst[0]
  const limit = QUALITY_RANK[cap]
  return bestFirst.find((edition) => QUALITY_RANK[edition.quality] <= limit) ?? bestFirst[bestFirst.length - 1]
}

/** Next edition below `current`, used when a stream keeps stalling. */
export function lowerEdition<E extends { quality: Quality; streamId: number }>(editions: E[], current: E | undefined): E | undefined {
  if (!current) return undefined
  const rank = QUALITY_RANK[current.quality]
  return editions
    .filter((edition) => edition.streamId !== current.streamId && QUALITY_RANK[edition.quality] < rank)
    .sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])[0]
}
