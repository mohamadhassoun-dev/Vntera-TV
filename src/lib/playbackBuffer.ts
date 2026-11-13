/**
 * How much video the player keeps ahead of the playhead.
 *
 * Two very different engines serve this app, and they need the same policy
 * expressed two ways:
 *
 * - hls.js owns a segment scheduler, so the target is a config value and the
 *   library fills exactly that much media (`maxBufferLength`, capped upward by
 *   `maxMaxBufferLength`).
 * - A progressive MP4 has no scheduler: the browser decides its readahead and
 *   the only way to know how much is really there is its `buffered` ranges.
 *   There the target is read back from the element, and the cap means "never
 *   wait for more than this before letting the picture run".
 *
 * The window is deliberately 15–20 s: enough to ride out an ordinary network
 * hiccup, short enough that a tune or a seek does not sit on a large download
 * first, and small enough that the media source stays bounded on a TV stick.
 */
export const BUFFER_TARGET_S = 18
/** Upper bound on what the player waits for (and what hls.js may grow to). */
export const BUFFER_CAP_S = 45
/** Below this the next stall is seconds away. */
export const BUFFER_FLOOR_S = 3
/** Enough media for a first frame; startup must not wait for the target. */
export const BUFFER_START_S = 2

/** The part of `TimeRanges` this module needs, so it can be tested directly. */
export interface BufferRanges {
  length: number
  start(index: number): number
  end(index: number): number
}

export interface BufferedMedia {
  buffered: BufferRanges
  currentTime: number
  duration?: number
}

/**
 * Seconds of playable media ahead of the playhead, read from the element's real
 * buffered ranges (the range the playhead sits in, not simply the last one).
 */
export function bufferedAhead(media: BufferedMedia): number {
  const ranges = media.buffered
  const at = media.currentTime
  if (!ranges || !ranges.length) return 0
  for (let i = 0; i < ranges.length; i += 1) {
    const start = ranges.start(i)
    const end = ranges.end(i)
    // A seek leaves the playhead a fraction outside the range it just joined.
    if (start <= at + 0.25 && end >= at) return Math.max(0, end - at)
  }
  // Not inside any range yet (a seek still being served), so nothing playable
  // is ahead of the playhead.
  return 0
}

/** The buffer target for this media, never beyond what is left of the file. */
export function bufferTargetFor(media: BufferedMedia): number {
  const left = Number.isFinite(media.duration) ? Math.max(0, (media.duration as number) - media.currentTime) : BUFFER_CAP_S
  return Math.min(BUFFER_TARGET_S, Math.max(BUFFER_START_S, left))
}

export interface HlsBufferProfile {
  maxBufferLength: number
  maxMaxBufferLength: number
  maxBufferSize: number
  backBufferLength: number
  abrEwmaDefaultEstimate: number
  abrBandWidthFactor: number
  abrBandWidthUpFactor: number
  startLevel: number
  startFragPrefetch: boolean
  maxStarvationDelay: number
}

/**
 * hls.js equivalent of the policy above.
 *
 * A thin link starts conservative rather than optimistic: the bandwidth
 * estimate seeds low, the first fragment is the lowest rendition, and the
 * estimator has to earn an upward switch. That is what stops "fast internet"
 * assumptions from turning into a spinner on a 1.5 Mbit/s connection.
 */
export function hlsBufferProfile({ slowLink, isLive }: { slowLink: boolean; isLive: boolean }): HlsBufferProfile {
  return {
    // Forward target, then the upward cap once playback is healthy.
    maxBufferLength: BUFFER_TARGET_S,
    maxMaxBufferLength: slowLink ? 30 : BUFFER_CAP_S,
    // Bound the media source in bytes as well as seconds; a 4K rendition fills
    // 45 s far faster than an SD one.
    maxBufferSize: slowLink ? 24 * 1000 * 1000 : 60 * 1000 * 1000,
    // Keep history for the live timeshift window, not the whole evening.
    backBufferLength: isLive ? 90 : 30,
    // Conservative startup estimate; ABR corrects it after the first segments.
    abrEwmaDefaultEstimate: slowLink ? 700_000 : 1_400_000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: slowLink ? 0.6 : 0.7,
    // -1 lets ABR pick; a weak link starts on its lowest rendition so a first
    // frame arrives instead of a stall.
    startLevel: slowLink ? 0 : -1,
    startFragPrefetch: true,
    maxStarvationDelay: 4,
  }
}
