import { describe, expect, it } from 'vitest'
import {
  endOfFilmAction,
  finishedProperly,
  readProgressSample,
  resumeTarget,
  seekTarget,
} from './playbackPosition'

/**
 * These exercise the rules the player actually runs: `Player.tsx` calls
 * `readProgressSample`, `seekTarget`, `resumeTarget`, `finishedProperly` and
 * `endOfFilmAction` directly, so nothing here is a second copy of them. The moves
 * the player credits itself — a press on the track, a skip — are asserted through
 * the component test, where the real player makes them.
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
  for (const at of samples) {
    const update = readProgressSample({ at, duration, furthest, lastPushed })
    furthest = update.furthest
    if (update.publish === null) continue
    lastPushed = update.publish
    shown.push(update.publish)
  }
  return { furthest, shown }
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
    // A jump to the last second that no press is behind is still an end jump while
    // the viewer is mid-film, so the bar does not follow it either.
    expect(readProgressSample({ at: FILM - 1, duration: FILM, furthest: 100, lastPushed: 100 }).publish).toBeNull()
    // Once playback really is near the end — inside the same margin `ended` calls a
    // finish — that same position is accepted, so a film pressed to its end still
    // finishes the way it should.
    expect(readProgressSample({ at: FILM - 1, duration: FILM, furthest: FILM - 30, lastPushed: FILM - 90 }).publish).toBe(
      FILM - 1,
    )
    // Just outside the margin it is still a jump from where the viewer was.
    expect(readProgressSample({ at: FILM - 1, duration: FILM, furthest: FILM - 90, lastPushed: FILM - 90 }).publish).toBeNull()
    const nearEnd = watch(ramp(FILM - 90, FILM - 1, 0.25), FILM, FILM - 90)
    expect(Math.max(...nearEnd.shown)).toBe(FILM - 1)
    expect(finishedProperly(nearEnd.furthest, FILM)).toBe(true)
  })
})

describe('a sample pinned to the duration while the film is still mid-play', () => {
  it('is ignored on a fresh watch from the start', () => {
    const seen = watch([...ramp(0.25, 300, 0.25), FILM])
    // The bar stayed where the viewer was, not at the far end.
    expect(seen.shown).not.toContain(FILM)
    expect(Math.max(...seen.shown)).toBeLessThanOrEqual(300)
    expect(seen.furthest).toBeCloseTo(300, 3)
    // And no finished state follows: this is a short body, so the player reconnects.
    expect(finishedProperly(seen.furthest, FILM)).toBe(false)
  })

  it('is ignored on a watch resumed from a saved position, which used to stick at 0', () => {
    const seen = watch([...ramp(5_400, 5_700, 0.25), FILM], FILM, 5_400)
    expect(seen.shown).not.toContain(FILM)
    expect(Math.max(...seen.shown)).toBeLessThanOrEqual(5_700)
    // The saved position is real progress: without this the film reported 0 and
    // every later stop looked like a finish.
    expect(seen.furthest).toBeGreaterThan(5_000)
    expect(seen.furthest).toBeCloseTo(5_700, 3)
    expect(finishedProperly(seen.furthest, FILM)).toBe(false)
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
    expect(Math.max(...seen.shown)).toBeGreaterThan(FILM - 2)
    expect(seen.furthest).toBeCloseTo(FILM, 3)
    expect(finishedProperly(seen.furthest, FILM)).toBe(true)
  })

  it('still reports finished after playing from a resumed position', () => {
    const seen = watch([...ramp(6_000, FILM - 0.25, 0.25), FILM], FILM, 6_000)
    expect(Math.max(...seen.shown)).toBeGreaterThan(FILM - 2)
    expect(finishedProperly(seen.furthest, FILM)).toBe(true)
  })

  it('still reports finished when the last sample lands inside the margin', () => {
    // `timeupdate` is not guaranteed to deliver the exact final second.
    for (const last of [FILM - 1, FILM - 30, FILM - 60]) {
      const seen = watch(ramp(6_000, last, 0.25))
      expect(Math.max(...seen.shown)).toBe(last)
      expect(finishedProperly(seen.furthest, FILM)).toBe(true)
    }
  })

  it('still finishes a film shorter than the truncation margin', () => {
    // A 45-second clip can never be "60 s short of its end", so it must end.
    const short = 45
    const seen = watch(ramp(0.25, short, 0.25), short)
    expect(Math.max(...seen.shown)).toBe(short)
    expect(finishedProperly(seen.furthest, short)).toBe(true)
  })
})

describe('what `ended` means', () => {
  it('shows the finished card after a real play-through, whatever the counters say', () => {
    expect(
      endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: false, absorbed: 0, retries: 0, played: true }),
    ).toBe('finish')
    // A press on the track just before the end does not turn the end into a restore.
    expect(
      endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: true }),
    ).toBe('finish')
    // Nor do the reconnect counters, once they are exhausted, hold the card back.
    expect(
      endOfFilmAction({ watched: FILM, duration: FILM, afterSeek: false, absorbed: 2, retries: 12, played: true }),
    ).toBe('finish')
    // Playback that is genuinely near the end finishes too, not just the exact end.
    expect(
      endOfFilmAction({ watched: FILM - 30, duration: FILM, afterSeek: true, absorbed: 0, retries: 3, played: true }),
    ).toBe('finish')
  })

  it('never shows the finished card for a body that stopped short', () => {
    // The pinned-end sample was ignored, so progress is still mid-film.
    expect(endOfFilmAction({ watched: 300, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: true })).toBe(
      'restore',
    )
    expect(
      endOfFilmAction({ watched: 300, duration: FILM, afterSeek: false, absorbed: 0, retries: 0, played: true }),
    ).toBe('reconnect')
    // Even with the restore budget spent and a reconnect pending, it is not a finish.
    expect(endOfFilmAction({ watched: 300, duration: FILM, afterSeek: true, absorbed: 2, retries: 5, played: true })).toBe(
      'reconnect',
    )
    // Resumed from a saved position, the same rule holds: a stop far from the end
    // is a short body, no matter how far into the film the viewer was.
    expect(
      endOfFilmAction({ watched: 5_700, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: true }),
    ).toBe('restore')
  })

  it('asks again for a film that ended before it ever showed a frame', () => {
    // The source died on its first request: no frame, no progress, and the old
    // rule read that as the end of the film.
    expect(
      endOfFilmAction({ watched: 0, duration: FILM, afterSeek: false, absorbed: 0, retries: 0, played: false }),
    ).toBe('unplayed')
    // Same when the element never even reported a duration.
    expect(endOfFilmAction({ watched: 0, duration: 0, afterSeek: false, absorbed: 0, retries: 0, played: false })).toBe(
      'unplayed',
    )
    // Nothing restores a picture that never appeared: the press is asked for again
    // like any other first request.
    expect(
      endOfFilmAction({ watched: 0, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: false }),
    ).toBe('unplayed')
    // A film that did play is judged on its progress, even if the clock never
    // reported a sample before the end (a very short clip).
    expect(endOfFilmAction({ watched: 0, duration: 5, afterSeek: false, absorbed: 0, retries: 0, played: true })).toBe(
      'finish',
    )
  })
})

describe('the sample that lands after a press the player credited', () => {
  it('counts the landing as progress, so a press near the end plays out and finishes', () => {
    // `seekTo` credits the pressed position the moment the press happens, so the
    // element's landing arrives as a step of zero rather than a jump of an hour
    // that the step rule would drop — which used to leave the bar on the old second
    // and undo the end as a short body.
    const at = FILM - 1
    const land = readProgressSample({ at, duration: FILM, furthest: at, lastPushed: 1_200 })
    expect(land.furthest).toBe(at)
    expect(land.publish).toBe(at)
    // The end that follows is the viewer's own, so it finishes instead of restoring.
    expect(finishedProperly(land.furthest, FILM)).toBe(true)
    expect(
      endOfFilmAction({ watched: land.furthest, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: true }),
    ).toBe('finish')
  })

  it('credits a long forward press in the middle, then reads playback normally again', () => {
    const land = readProgressSample({ at: 5_000, duration: FILM, furthest: 5_000, lastPushed: 300 })
    expect(land.furthest).toBe(5_000)
    expect(land.publish).toBe(5_000)
    const next = readProgressSample({ at: 5_001, duration: FILM, furthest: land.furthest, lastPushed: 5_000 })
    expect(next.furthest).toBe(5_001)
    expect(next.publish).toBe(5_001)
  })

  it('still refuses the end when the element lands somewhere the press did not ask for', () => {
    // Pressed 1:23:20 on a body that only holds the first stretch: the element pins
    // to the film's full length instead of going there, and that is still a jump.
    const jump = readProgressSample({ at: FILM, duration: FILM, furthest: 5_000, lastPushed: 5_000 })
    expect(jump.furthest).toBe(5_000)
    expect(jump.publish).toBeNull()
    expect(
      endOfFilmAction({ watched: jump.furthest, duration: FILM, afterSeek: true, absorbed: 0, retries: 0, played: true }),
    ).toBe('restore')
  })
})

describe('a seek that lands on a short byte range', () => {
  it('puts the film back inside itself, never at its last instant', () => {
    expect(resumeTarget(1_234, FILM)).toBe(1_234)
    expect(resumeTarget(0, FILM)).toBe(0)
    // A saved position at or past the end would end the film the moment it was
    // restored, so it is pulled inside.
    for (const from of [FILM, FILM + 30, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(resumeTarget(from, FILM)).toBeLessThan(FILM)
    }
    // No duration yet: the saved second is all there is to go on.
    expect(resumeTarget(1_234, 0)).toBe(1_234)
  })
})
