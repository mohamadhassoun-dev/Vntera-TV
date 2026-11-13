/**
 * Where a film actually is, read from the element's own numbers.
 *
 * A progressive file whose response stops short of its real length does not simply
 * stop: the element pins `currentTime` to the full `duration`, reports the whole
 * timeline as buffered, and fires `ended`. Every visible symptom of that comes from
 * trusting the report — the bar slid to the far end of a film that was still
 * playing, a press on the track could ask for the last instant and look like the
 * film finishing, and playback rescued from a saved position never learned its own
 * progress because only the opening half minute was ever accepted as a start.
 *
 * These rules live here rather than inside the component so they can be checked
 * without a decoder, a panel, or a person watching.
 */

/** How near the end counts as the end: a stop further back than this is short. */
export const END_MARGIN_S = 60

/** The three numbers the end-of-film rules are decided from. */
export interface ProgressPoint {
  /** `currentTime` this sample reports. */
  at: number
  /** Last known real duration, 0 before metadata arrives. */
  duration: number
  /** Furthest position playback has genuinely reached on this source. */
  furthest: number
}

/** One `timeupdate`'s worth of state. */
export interface ProgressSample extends ProgressPoint {
  /** Position last shown, so half-second renders can be skipped. */
  lastPushed: number
}

export interface ProgressUpdate {
  /** Furthest real position after this sample; never moves on a fake end. */
  furthest: number
  /** Position to show on the bar, or null to leave it where it was. */
  publish: number | null
}

/**
 * True when a sample sits at the very end of a film whose playback never got
 * anywhere near it: the end of the delivered bytes, not a place the viewer went.
 */
export function isPinnedEndSample({ at, duration, furthest }: ProgressPoint): boolean {
  return duration > END_MARGIN_S && at >= duration - 1 && furthest < duration - END_MARGIN_S
}

/**
 * Furthest real position after a sample. Only a normal step counts as progress.
 * The first sample counts wherever it is, because a film continued from a saved
 * position starts minutes in; reading only the first 30 s left every resumed film
 * at 0, which turned each later stop into a film the player believed was over.
 */
export function advanceFurthest({ at, duration, furthest }: ProgressPoint): number {
  if (!(at > 0) || isPinnedEndSample({ at, duration, furthest })) return furthest
  // Before the duration is known there is no way to tell a real start from a jump
  // to the end, so the opening half minute is still all that is trusted there.
  if (furthest === 0) return duration > 0 || at < 30 ? at : furthest
  const step = at - furthest
  return step > 0 && step < 10 ? at : furthest
}

/** What to remember and what to show for one `timeupdate`. */
export function readProgressSample(sample: ProgressSample): ProgressUpdate {
  const furthest = advanceFurthest(sample)
  if (isPinnedEndSample(sample)) return { furthest, publish: null }
  // Labels show whole seconds, so half-second renders are wasted work.
  if (Math.abs(sample.at - sample.lastPushed) < 0.5) return { furthest, publish: null }
  return { furthest, publish: sample.at }
}

/** A position inside the film — never its last instant, which reads as the end. */
export function clampPosition(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0
  if (!(duration > 0)) return Math.max(0, seconds)
  return Math.min(Math.max(0, seconds), Math.max(0, duration - 1))
}

/**
 * Where a press on the track sends the film. A press at the far end, or past it,
 * used to ask for `duration` itself, and the element answers that with "ended" —
 * so a tap on the bar looked like the film finishing.
 */
export function seekTarget(ratio: number, duration: number): number {
  return clampPosition(Number.isFinite(ratio) ? ratio * duration : 0, duration)
}

/** The delivered response stopped short of the film's own length. */
export function stoppedShort(watched: number, duration: number): boolean {
  return duration > 0 && watched > 0 && watched < duration - END_MARGIN_S
}

/** The viewer really did play the film through to its end. */
export function finishedProperly(watched: number, duration: number): boolean {
  return duration > 0 && watched >= duration - END_MARGIN_S
}

/**
 * What `ended` means for this film. `restore` puts the viewer back where the
 * pressed seek left off, `reconnect` re-attaches after a short body, and
 * `finish` shows the finished card.
 */
export type EndAction = 'restore' | 'reconnect' | 'finish'

export interface EndOfFilm {
  /** Best known real progress on this source. */
  watched: number
  /** Last known real duration. */
  duration: number
  /** A press on the track is still this viewer's most recent move. */
  afterSeek: boolean
  /** Restores already spent on that seek. */
  absorbed: number
  /** Reconnects already spent on this film. */
  retries: number
}

/**
 * The branch `ended` takes. A finished card is the last resort only after a short
 * body has been given every chance, so a truncated stream can never masquerade as
 * a finish, and a film that was watched to its end is never swallowed by the guard.
 */
export function endOfFilmAction({ watched, duration, afterSeek, absorbed, retries }: EndOfFilm): EndAction {
  if (!stoppedShort(watched, duration)) return 'finish'
  if (afterSeek && absorbed < 2) return 'restore'
  return retries < 12 ? 'reconnect' : 'finish'
}

/** Just enough of an element to put an ended one back on its feet. */
export interface ResumableElement {
  currentTime: number
}

/**
 * Bring an element that has already fired `ended` back to `from` and start it.
 * Setting the time alone left it paused on its last frame with nothing to say why,
 * which is what a seek that landed on a short byte range used to do.
 */
export function resumeAfterShortRange<T extends ResumableElement>(
  el: T,
  from: number,
  duration: number,
  play: (el: T) => void,
): number {
  const target = clampPosition(from, duration)
  el.currentTime = target
  play(el)
  return target
}
