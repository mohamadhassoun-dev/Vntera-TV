import { describe, expect, it } from 'vitest'
import {
  END_MARGIN_S,
  endOfFilmAction,
  finishedProperly,
  isPinnedEndSample,
  readProgressSample,
  resumeAfterShortRange,
  seekTarget,
  stoppedShort,
} from './playbackPosition'

/**
 * These exercise the rules the player actually runs: `Player.tsx` calls
 * `readProgressSample`, `seekTarget`, `stoppedShort`, `finishedProperly` and
 * `resumeAfterShortRange` directly, so nothing here is a second copy of them.
 */

/** A two-hour film, the length a truncation has to be measured against. */
const FILM = 7_200

/** `timeupdate`s at a steady cadence, the way the element delivers them. */
function ramp(from: number, to: number, step: number): number[] {
  const samples: number[] = []
  for (let t = from; t <= to + 1e-9; t += step) samples.push(Number(t.toFixed(3)))
  return samples
}

/**
 * Feed a run of samples through the same entry point the player's `timeupdate`
 * handler uses, and report what the bar was told to show and what the player
 * remembered as real progress.
 */
function watch(samples: number[], duration = FILM, startShown = 0) {
  let furthest = 0
  let lastPushed = startShown
  const shown: number[] = []
  let suppressedEndJumps = 0
  for (const at of samples) {
    const before = furthest
    const update = readProgressSample({ at, duration, furthest, lastPushed })
    furthest = update.furthest
    if (update.publish === null) {
      // Distinguish the end jump the guard rejected from a sample only skipped
      // because it was less than half a second past the last label.
      if (isPinnedEndSample({ at, duration, furthest: before })) suppressedEndJumps += 1
      continue
    }
    lastPushed = update.publish
    shown.push(update.publish)
  }
  return { furthest, shown, suppressedEndJumps }
}

describe('a press on the progress track', () => {
  it('asks for a position short of the duration, even at or past the far end', () => {
    for (const ratio of [1, 1.0001, 1.4, 9, 1e6]) {
      const target = seekTarget(ratio, FILM)
      expect(target).toBeLessThan(FILM)
      expect(target).toBeGreaterThanOrEqual(0)
    }
    // The furthest edge of the track is the last second, not the end itself.
    expect(seekTarget(1, FILM)).toBe(FILM - 1)
    expect(seekTarget(0.5, FILM)).toBe(FILM / 2)
    expect(seekTarget(0, FILM)).toBe(0)
    // Nothing to clamp against before metadata arrives.
    expect(seekTarget(1, 0)).toBe(0)
    expect(seekTarget(Number.NaN, FILM)).toBe(0)
  })

  it('cannot end the film on the press itself: only playing the last second can', () => {
    const target = seekTarget(1, FILM)
    // A second of playback is left, so `ended` cannot follow the press directly.
    expect(FILM - target).toBeGreaterThanOrEqual(1)
    // A jump to the last second is still an end jump while the viewer is mid-film,
    // so the bar does not follow it either.
    expect(isPinnedEndSample({ at: FILM - 1, duration: FILM, furthest: 100 })).toBe(true)
    // Once playback really is near the end — inside the same margin `onEnded`
    // calls a finish — that same position is accepted, so a film pressed to its
    // end still finishes the way it should.
    expect(isPinnedEndSample({ at: FILM - 1, duration: FILM, furthest: FILM - 30 })).toBe(false)
    // Just outside the margin it is still a jump from where the viewer was.
    expect(isPinnedEndSample({ at: FILM - 1, duration: FILM, furthest: FILM - 90 })).toBe(true)
    const nearEnd = watch(ramp(FILM - 90, FILM - 1, 0.25), FILM, FILM - 90)
    expect(nearEnd.suppressedEndJumps).toBe(0)
    expect(Math.max(...nearEnd.shown)).toBe(FILM - 1)
    expect(finishedProperly(nearEnd.furthest, FILM)).toBe(true)
    expect(stoppedShort(nearEnd.furthest, FILM)).toBe(false)
  })
})

describe('a sample pinned to the duration while the film is still mid-play', () => {
  it('is ignored on a fresh watch from the start', () => {
    const seen = watch([...ramp(0.25, 300, 0.25), FILM])
    // The end jump is the only sample the guard threw away.
    expect(seen.suppressedEndJumps).toBe(1)
    expect(seen.shown).not.toContain(FILM)
    // The bar stayed where the viewer was, not at the far end.
    expect(Math.max(...seen.shown)).toBeLessThanOrEqual(300)
    expect(seen.furthest).toBeCloseTo(300, 3)
    // And no finished state follows: this is a short body, so the player reconnects.
    expect(finishedProperly(seen.furthest, FILM)).toBe(false)
    expect(stoppedShort(seen.furthest, FILM)).toBe(true)
  })

  it('is ignored on a watch resumed from a saved position, which used to stick at 0', () => {
    const seen = watch([...ramp(5_400, 5_700, 0.25), FILM], FILM, 5_400)
    expect(seen.suppressedEndJumps).toBe(1)
    expect(seen.shown).not.toContain(FILM)
    expect(Math.max(...seen.shown)).toBeLessThanOrEqual(5_700)
    // The saved position is real progress: without this the film reported 0 and
    // every later stop looked like a finish.
    expect(seen.furthest).toBeGreaterThan(5_000)
    expect(seen.furthest).toBeCloseTo(5_700, 3)
    expect(finishedProperly(seen.furthest, FILM)).toBe(false)
    expect(stoppedShort(seen.furthest, FILM)).toBe(true)
  })

  it('never teaches the player that the end was reached, so the film is not "over"', () => {
    // The first sample of a truncated film can be the pinned one, before any
    // normal step has been seen.
    const onlyJump = readProgressSample({ at: FILM, duration: FILM, furthest: 0, lastPushed: 0 })
    expect(onlyJump.publish).toBeNull()
    expect(onlyJump.furthest).toBe(0)
    expect(finishedProperly(onlyJump.furthest, FILM)).toBe(false)
    // A jump on an element whose duration is not known yet is still distrusted.
    const noDuration = readProgressSample({ at: 5_000, duration: 0, furthest: 0, lastPushed: 0 })
    expect(noDuration.furthest).toBe(0)
  })
})

describe('a genuine play-through to the end', () => {
  it('still reports finished after playing from the start', () => {
    const seen = watch([...ramp(0.25, FILM - 0.25, 0.25), FILM])
    // Nothing is rejected at the real end: the bar runs to the far end.
    expect(seen.suppressedEndJumps).toBe(0)
    expect(Math.max(...seen.shown)).toBeGreaterThan(FILM - 2)
    expect(seen.furthest).toBeCloseTo(FILM, 3)
    expect(finishedProperly(seen.furthest, FILM)).toBe(true)
    expect(stoppedShort(seen.furthest, FILM)).toBe(false)
  })

  it('still reports finished after playing from a resumed position', () => {
    const seen = watch([...ramp(6_000, FILM - 0.25, 0.25), FILM], FILM, 6_000)
    expect(seen.suppressedEndJumps).toBe(0)
    expect(Math.max(...seen.shown)).toBeGreaterThan(FILM - 2)
    expect(finishedProperly(seen.furthest, FILM)).toBe(true)
    expect(stoppedShort(seen.furthest, FILM)).toBe(false)
  })

  it('still reports finished when the last sample lands inside the margin', () => {
    // `timeupdate` is not guaranteed to deliver the exact final second.
    for (const last of [FILM - 1, FILM - 30, FILM - END_MARGIN_S]) {
      const seen = watch(ramp(6_000, last, 0.25))
      expect(Math.max(...seen.shown)).toBe(last)
      expect(isPinnedEndSample({ at: last, duration: FILM, furthest: last - 0.25 })).toBe(false)
      expect(finishedProperly(seen.furthest, FILM)).toBe(true)
      expect(stoppedShort(seen.furthest, FILM)).toBe(false)
    }
  })

  it('still finishes a film shorter than the truncation margin', () => {
    // A 45-second clip can never be "60 s short of its end", so it must end.
    const short = 45
    const seen = watch(ramp(0.25, short, 0.25), short)
    expect(seen.suppressedEndJumps).toBe(0)
    expect(Math.max(...seen.shown)).toBe(short)
    expect(finishedProperly(seen.furthest, short)).toBe(true)
    expect(stoppedShort(seen.furthest, short)).toBe(false)
  })
})

describe('what `ended` means', () => {
  it('shows the finished card after a real play-through, whatever the counters say', () => {
    expect(endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: false, absorbed: 0, retries: 0 })).toBe(
      'finish',
    )
    // A press on the track just before the end does not turn the end into a restore.
    expect(endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: true, absorbed: 0, retries: 0 })).toBe(
      'finish',
    )
    // Nor do the reconnect counters, once they are exhausted, hold the card back.
    expect(endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: false, absorbed: 2, retries: 12 })).toBe(
      'finish',
    )
    // Playback that is genuinely near the end finishes too, not just the exact end.
    expect(endOfFilmAction({ watched: FILM - 30, duration: FILM, afterSeek: true, absorbed: 0, retries: 3 })).toBe(
      'finish',
    )
  })

  it('never shows the finished card for a body that stopped short', () => {
    // The pinned-end sample was ignored, so progress is still mid-film.
    expect(endOfFilmAction({ watched: 300, duration: FILM, afterSeek: true, absorbed: 0, retries: 0 })).toBe(
      'restore',
    )
    expect(endOfFilmAction({ watched: 300, duration: FILM, afterSeek: false, absorbed: 0, retries: 0 })).toBe(
      'reconnect',
    )
    // Even with the restore budget spent and a reconnect pending, it is not a finish.
    expect(endOfFilmAction({ watched: 300, duration: FILM, afterSeek: true, absorbed: 2, retries: 5 })).toBe(
      'reconnect',
    )
    // Resumed from a saved position, the same rule holds: a stop far from the end
    // is a short body, no matter how far into the film the viewer was.
    expect(endOfFilmAction({ watched: 5_700, duration: FILM, afterSeek: true, absorbed: 0, retries: 0 })).toBe(
      'restore',
    )
  })
})

describe('a seek that lands on a short byte range', () => {
  /** The element as it is at `ended`: currentTime pinned to the duration. */
  function endedFilm(duration: number) {
    const el = { currentTime: duration, plays: 0 }
    return { el, play: (target: typeof el) => void (target.plays += 1) }
  }

  it('steps back and restarts playback instead of leaving a still frame', () => {
    const { el, play } = endedFilm(FILM)
    resumeAfterShortRange(el, 1_234, FILM, play)
    expect(el.currentTime).toBe(1_234)
    // The element had already ended; setting the time alone left it paused there.
    expect(el.plays).toBe(1)
  })

  it('never restores a position at the end, which would end the film again', () => {
    for (const from of [FILM, FILM + 30, Number.POSITIVE_INFINITY]) {
      const { el, play } = endedFilm(FILM)
      resumeAfterShortRange(el, from, FILM, play)
      expect(el.currentTime).toBeLessThan(FILM)
      expect(el.plays).toBe(1)
    }
    const start = endedFilm(FILM)
    resumeAfterShortRange(start.el, 0, FILM, start.play)
    expect(start.el.currentTime).toBe(0)
    expect(start.el.plays).toBe(1)
  })
})
