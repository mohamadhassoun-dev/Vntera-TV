/**
 * Where a film actually is, read from the element's own numbers.
 *
 * A progressive file whose response stops short of its real length does not simply
 * stop: the element pins `currentTime` to the full `duration`, reports the whole
 * timeline as buffered, and fires `ended`. Every visible symptom of that comes from
 * trusting the report — the bar slid to the far end of a film that was still
 * playing, and playback rescued from a saved position never learned its own progress
 * because only the opening half minute was ever accepted as a start.
 *
 * A move the viewer makes — a press on the track, a skip — is not a report at all:
 * the player credits it as progress where it happens, so a press at the far right
 * is judged like any other position and the end that follows is the viewer's own.
 *
 * These rules live here rather than inside the component so they can be checked
 * without a decoder, a panel, or a person watching.
 */

/** How near the end counts as the end: a stop further back than this is short. */
const END_MARGIN_S = 60
/** A step longer than this is a jump, not playback, so it teaches nothing. */
const STEP_S = 10

/** A position inside the film — never its last instant, which reads as the end. */
function clampPosition(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0
  if (!(duration > 0)) return Math.max(0, seconds)
  return Math.min(Math.max(0, seconds), duration - 1)
}

/**
 * Where a press on the track sends the film. A press at the far end, or past it,
 * used to ask for `duration` itself, and the element answers that with "ended" —
 * so a tap on the bar looked like the film finishing.
 */
export function seekTarget(ratio: number, duration: number): number {
  return clampPosition(ratio * duration, duration)
}

/**
 * Where an element that ended early is put back: the position its viewer left,
 * always inside the film so the restore does not end it again at once.
 */
export function resumeTarget(from: number, duration: number): number {
  return clampPosition(from, duration)
}

/** One `timeupdate`'s worth of state. */
interface ProgressSample {
  /** `currentTime` this sample reports. */
  at: number
  /** Last known real duration, 0 before metadata arrives. */
  duration: number
  /** Furthest position playback has genuinely reached on this source. */
  furthest: number
  /** Position last shown, so half-second renders can be skipped. */
  lastPushed: number
}

interface ProgressUpdate {
  /** Furthest real position after this sample; never moves on a fake end. */
  furthest: number
  /** Position to show on the bar, or null to leave it where it was. */
  publish: number | null
}

/** What to remember and what to show for one `timeupdate`. */
export function readProgressSample({ at, duration, furthest, lastPushed }: ProgressSample): ProgressUpdate {
  // A sample pinned to the duration while playback is far behind it is the end of
  // the delivered bytes, not a place the viewer reached: the bar must not follow
  // it, and it must never teach the player that the film was watched to its end.
  const pinned = at >= duration - 1 && furthest < duration - END_MARGIN_S
  // A normal step is progress. The first sample counts wherever it is, because a
  // film continued from a saved position starts minutes in; before the duration is
  // known only the opening half minute is trusted, since a jump cannot then be told
  // apart from a start. Deliberate moves are already credited by the player, so
  // they arrive here as a step of zero.
  const step = at - furthest
  const reached = at > 0 && !pinned && (furthest > 0 ? step > 0 && step < STEP_S : duration > 0 || at < 30)
  return {
    furthest: reached ? at : furthest,
    // Labels show whole seconds, so half-second renders are wasted work.
    publish: !pinned && Math.abs(at - lastPushed) >= 0.5 ? at : null,
  }
}

/** The viewer really did play the film through to its end. */
export function finishedProperly(watched: number, duration: number): boolean {
  return duration > 0 && watched >= duration - END_MARGIN_S
}

/** What `ended` means for this film: show the card, restore, or ask again. */
type EndAction = 'finish' | 'restore' | 'reconnect' | 'unplayed'

interface EndOfFilm {
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
  /** The source has shown at least one frame, so a finish is possible. */
  played: boolean
}

/**
 * The branch `ended` takes. A finished card is the last resort only after a short
 * body has been given every chance, so a truncated stream can never masquerade as a
 * finish, and a film that was watched to its end is never swallowed by the guard.
 */
export function endOfFilmAction({ watched, duration, afterSeek, absorbed, retries, played }: EndOfFilm): EndAction {
  // A source that ended without ever showing a frame has no progress to judge the
  // end against and nowhere to resume, so "finished" and "restore" are both lies:
  // it is asked again on its own budget, then reported as unplayable.
  if (!played && !(watched > 0)) return 'unplayed'
  if (finishedProperly(watched, duration)) return 'finish'
  if (afterSeek && absorbed < 2) return 'restore'
  return retries < 12 ? 'reconnect' : 'finish'
}
