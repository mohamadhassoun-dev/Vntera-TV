// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatTimecode } from '../../lib/format'
import { Player } from './Player'

/**
 * The player, driven through a real media element stand-in.
 *
 * `playbackPosition` is unit-tested on its own, but the wiring between the
 * track's press, the `timeupdate` samples and the `ended` branch is where the
 * reported bug lived: a press at the far right must follow through to the
 * finished card, and a short body whose end is somewhere else must not.
 */

const FILM = 7_200

/** The element's transport, shared by the patched prototype accessors. */
const media = {
  time: 0,
  duration: FILM,
  paused: true,
  ended: false,
  srcSets: 0,
  plays: 0,
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const define = (name: string, descriptor: PropertyDescriptor) => {
    Object.defineProperty(HTMLVideoElement.prototype, name, { configurable: true, ...descriptor })
  }
  define('currentTime', {
    get: () => media.time,
    set: (value: number) => {
      media.time = value
    },
  })
  define('duration', { get: () => media.duration })
  define('paused', { get: () => media.paused })
  define('ended', { get: () => media.ended })
  define('seeking', { get: () => false })
  define('readyState', { get: () => 4 })
  define('src', {
    get: () => '',
    set: () => {
      media.srcSets += 1
    },
  })
  // A healthy cushion ahead of the playhead, so the deliberate refill hold never
  // pauses this film and confuses a restore with ordinary buffering.
  define('buffered', {
    get: () => ({ length: 1, start: () => 0, end: () => media.duration }),
  })

  HTMLMediaElement.prototype.play = function play() {
    media.plays += 1
    media.paused = false
    media.ended = false
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function pause() {
    media.paused = true
  }
  HTMLMediaElement.prototype.load = function load() {}
})

beforeEach(() => {
  media.time = 0
  media.duration = FILM
  media.paused = true
  media.ended = false
  media.srcSets = 0
  media.plays = 0

  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

interface Rendered {
  container: HTMLDivElement
  video: HTMLVideoElement
  slider: HTMLElement
  onProgress: ReturnType<typeof vi.fn>
  bar: () => number
  /** The panel handing over another source on the same element. */
  render: (src: string) => void
}

function mount(): Rendered {
  container = document.createElement('div')
  document.body.appendChild(container)
  const onProgress = vi.fn()
  const host = container
  root = createRoot(host)
  const render = (src: string) => {
    act(() => {
      root?.render(
        <Player src={src} title="A long film" onExit={() => {}} onProgress={onProgress} askResume={false} />,
      )
    })
  }
  render('https://panel.test/film.mp4')
  const video = host.querySelector('video')
  const slider = host.querySelector('[role="slider"][aria-label="Seek"]') as HTMLElement | null
  if (!video || !slider) throw new Error('player did not render a film seek bar')
  // jsdom has no layout, so the track reports its own width.
  slider.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 720, bottom: 24, width: 720, height: 24, x: 0, y: 0, toJSON: () => {} }) as DOMRect

  const bar = () => {
    const fill = slider.querySelector('.bg-crimson') as HTMLElement | null
    return fill ? Number.parseFloat(fill.style.width) : 0
  }
  return { container: host, video, slider, onProgress, bar, render }
}

const fire = (el: Element, type: string) => {
  act(() => {
    el.dispatchEvent(new Event(type))
  })
}

/** Open the film: metadata, a first frame, then samples as the clock advances. */
const openFilm = ({ video }: Rendered) => {
  fire(video, 'loadedmetadata')
  fire(video, 'durationchange')
  fire(video, 'playing')
}

/** Move the element's clock the way playback does: one second at a time. */
const playTo = ({ video }: Rendered, seconds: number, from: number) => {
  for (let at = from + 1; at <= seconds; at += 1) {
    media.time = at
    fire(video, 'timeupdate')
  }
}

/** A press on the track at `clientX` of its 720 px width. */
const pressTrack = (view: Rendered, clientX: number) => {
  act(() => {
    view.slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY: 12 }))
  })
  act(() => {
    view.slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY: 12 }))
  })
}

/** Let fake time pass, flushing whatever the player's own timers do meanwhile. */
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Leave the player: what it hands the library on the way out is what is resumed. */
const leave = (view: Rendered) => {
  act(() => {
    root?.unmount()
  })
  root = null
  return view.onProgress.mock.calls.at(-1) as [number, number] | undefined
}

describe('a press at the far right of the progress track', () => {
  it('plays the last second out and finishes, without bouncing back', () => {
    const view = mount()
    openFilm(view)
    playTo(view, 300, 0)

    expect(view.bar()).toBeCloseTo((300 / FILM) * 100, 1)

    // The press itself: the track asks for one second short of the end.
    pressTrack(view, 720)
    expect(media.time).toBe(FILM - 1)

    // The element confirms the jump with one long step — this used to be dropped
    // as impossible progress, leaving the bar on 5:00.
    fire(view.video, 'timeupdate')
    expect(view.bar()).toBeCloseTo(((FILM - 1) / FILM) * 100, 1)
    expect(view.container.textContent).toContain(formatTimecode(FILM - 1))

    // The final second plays out and the file ends.
    playTo(view, FILM, FILM - 1)
    const savedAfterPress = view.onProgress.mock.calls.length
    media.ended = true
    fire(view.video, 'pause')
    fire(view.video, 'ended')

    expect(view.container.textContent).toContain('Finished')
    expect(view.onProgress.mock.calls.at(-1)?.[0]).toBe(FILM)

    // Nothing may undo the press in the following ten seconds: no restore to the
    // old second, no reconnect, no "Finished" that flickers away.
    wait(10_000)
    expect(media.time).toBe(FILM)
    expect(media.srcSets).toBe(1)
    expect(view.container.textContent).toContain('Finished')
    expect(view.container.querySelector('[role="status"]')).toBeNull()
    const laterSaves = view.onProgress.mock.calls.slice(savedAfterPress)
    for (const [seconds] of laterSaves) expect(seconds).toBeGreaterThanOrEqual(FILM - 1)

    // The position the viewer leaves on is the pressed one, not the old second.
    expect(leave(view)?.[0]).toBe(FILM)
  })

  it('finishes when the element confirms the press after a source switch cleared the credit', () => {
    const view = mount()
    openFilm(view)
    playTo(view, 300, 0)

    // The press asks for the last second and the player credits it there.
    pressTrack(view, 720)
    expect(media.time).toBe(FILM - 1)

    // The panel then answers the seek with another edition on the same element,
    // which starts the remembered progress from zero. The element lands on the
    // pressed second: that landing is the press being served, not a fake end, so the
    // bar follows it and the film finishes instead of being stepped back.
    view.render('https://panel.test/film-alt.mp4')
    fire(view.video, 'timeupdate')

    expect(view.bar()).toBeCloseTo(((FILM - 1) / FILM) * 100, 1)

    media.ended = true
    fire(view.video, 'ended')
    expect(view.container.textContent).toContain('Finished')

    // Nothing steps the picture back to the old second afterwards.
    wait(10_000)
    expect(media.time).toBe(FILM - 1)
    expect(view.bar()).toBeCloseTo(((FILM - 1) / FILM) * 100, 1)
    expect(view.container.textContent).toContain('Finished')
  })

  it('restores when the element lands somewhere other than the press', () => {
    const view = mount()
    openFilm(view)
    playTo(view, 300, 0)

    // A press at 50:00 on a body that stops early: the element pins to the full
    // duration instead, which is not where the viewer asked to be.
    pressTrack(view, 300)
    expect(media.time).toBe(3000)
    media.time = FILM
    fire(view.video, 'timeupdate')

    // The bar stays where the viewer was, and the end is not a finish.
    expect(view.bar()).toBeCloseTo((300 / FILM) * 100, 1)
    media.ended = true
    fire(view.video, 'ended')

    expect(view.container.textContent).not.toContain('Finished')

    // The range still gets its eight seconds to arrive before it is undone.
    wait(7_000)
    expect(media.time).toBe(FILM)
    wait(1_500)
    expect(media.time).toBe(300)
    expect(media.plays).toBeGreaterThan(1)
    expect(view.bar()).toBeCloseTo((300 / FILM) * 100, 1)
    expect(view.container.textContent).not.toContain('Finished')
  })
})
