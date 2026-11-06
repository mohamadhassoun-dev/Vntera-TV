import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ErrorData, Level, MediaPlaylist } from 'hls.js'
import type { Quality } from '../../types'
import { Icon } from '../Icons'
import { AudioOnlyAds } from './AudioOnlyAds'
import { detectNetworkSpeed, slowNetworkCap } from '../../lib/editions'
import { formatTimecode } from '../../lib/format'
import { canCastVideo, isNativeShell, startCast } from '../../lib/platform'
import { releaseOrientation, rotateLandscape, type RotateMode } from '../../lib/orientation'
import { pictureTurned } from '../../lib/playerLayout'
import { trackAxis, trackRatio } from '../../lib/seek'
import { useWakeLock } from '../../lib/hooks'
import { useSettings } from '../../store/settings'

export interface EditionOption {
  id: number
  label: string
  quality: Quality
  active: boolean
  onSelect: () => void
}

interface PlayerProps {
  src: string
  srcAlt?: string
  title: string
  subtitle?: string
  poster?: string
  isLive?: boolean
  startAt?: number
  /** Ask "resume or start over" when opening on a saved position. */
  askResume?: boolean
  introEnd?: number
  nextLabel?: string
  onNext?: () => void
  onExit: () => void
  onProgress?: (seconds: number, duration: number) => void
  editions?: EditionOption[]
  liveProgramme?: { title: string; start: number; end: number }
  /** Called when a VOD stream stalls; return true if a lower edition was picked. */
  onStall?: () => boolean
  /**
   * Called when a live channel failed every retry. Return true when another
   * panel entry for the same channel was switched to, so no error card is shown.
   */
  onTuneFail?: () => boolean
  /** Start silent (the brand sting is playing over a preloading picture). */
  startMuted?: boolean
  /** The sting has finished: reveal the picture and restore sound. */
  muted?: boolean
  /** Reports real playback, so the download queue can yield to the stream. */
  onPlayingChange?: (playing: boolean) => void
}

interface TrackOption {
  index: number
  label: string
}

const STREAM_STALL_MESSAGE =
  'This stream is taking too long to respond. Retry, or pick a lower quality in Settings.'
const TUNE_ERROR_MESSAGE =
  'This channel could not be tuned. The provider may be offline or the connection limit was reached.'
const DROP_ERROR_MESSAGE = 'This stream dropped. Check your connection and retry.'
const UNPLAYABLE_MESSAGE =
  'This stream could not be played. Retry, or pick a different version or quality.'
/**
 * Warnings that are only true while nothing is playing. Real playback clears them,
 * so a channel that recovered never keeps a blocking card over a live picture.
 */
const TRANSIENT_ERRORS = new Set<string>([STREAM_STALL_MESSAGE, TUNE_ERROR_MESSAGE, DROP_ERROR_MESSAGE])
const clearTransientError = (current: string | null) => (current && TRANSIENT_ERRORS.has(current) ? null : current)
/** How long a stalled stream waits before each rescue step, on a slow connection. */
const DOWNGRADE_AFTER_MS = 12_000
const RECOVER_AFTER_MS = 25_000
const GIVE_UP_AFTER_MS = 45_000
const LIVE_GIVE_UP_AFTER_MS = 25_000
/**
 * Gaps between automatic retunes of a live channel. Panels answer 503 while they
 * re-allocate a stream to another edge, so an instant error card was wrong there.
 */
const LIVE_TUNE_RETRY_DELAYS = [1_200, 2_500, 4_000, 6_000, 8_000]
/** Idle time before the live overlay clears itself, leaving only the picture. */
const LIVE_HIDE_DELAY_MS = 6_000
const HIDE_DELAY_MS = 3_600

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url)
}

type HlsCtor = typeof import('hls.js').default
type MpegtsLib = typeof import('mpegts.js').default

// The demuxers are ~900 KB together; fetching them only when a stream needs one
// keeps the player shell (and .ts channels, which use neither hls.js) instant.
let hlsPromise: Promise<HlsCtor> | null = null
let mpegtsPromise: Promise<MpegtsLib> | null = null
const loadHls = () => (hlsPromise ??= import('hls.js').then((mod) => mod.default))
const loadMpegts = () => (mpegtsPromise ??= import('mpegts.js').then((mod) => mod.default))

function isTsUrl(url: string): boolean {
  return /\.ts(\?|$)/i.test(url)
}

export function Player({
  src,
  srcAlt,
  title,
  subtitle,
  poster,
  isLive = false,
  startAt = 0,
  askResume = true,
  introEnd,
  nextLabel,
  onNext,
  onExit,
  onProgress,
  editions,
  liveProgramme,
  onStall,
  onTuneFail,
  muted: externallyMuted,
  onPlayingChange,
}: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<InstanceType<HlsCtor> | null>(null)
  const tsRef = useRef<ReturnType<MpegtsLib['createPlayer']> | null>(null)
  const hideTimer = useRef<number | null>(null)
  const lastSaved = useRef(0)
  /** Last position pushed into React state, so playback does not re-render constantly. */
  const lastPushedTime = useRef(0)
  /** Long-press repeat on the skip buttons, and whether the press already stepped. */
  const holdTimer = useRef<number | null>(null)
  const holdRepeat = useRef<number | null>(null)
  const heldLong = useRef(false)
  const triedAlt = useRef(false)
  /** A live channel that failed on raw TS retries on its HLS rendition first. */
  const preferAlt = useRef(false)
  /** Automatic re-attach attempts for a stalling VOD stream, and where to resume. */
  const autoRetries = useRef(0)
  const resumeAfterRecovery = useRef(0)
  /** True once this source has actually shown a frame, so a slow start is not a stall. */
  const hasPlayed = useRef(false)
  const recoveryTried = useRef(false)
  /** Live feeds that drop their segment stream get retuned instead of "Finished". */
  const liveRetunes = useRef(0)
  /** Automatic retunes of a live channel that never produced a frame, and after a stall. */
  const tuneRetries = useRef(0)
  /** When the current live attempt started, to tell a refusal from a slow tune. */
  const tuneStartedAt = useRef(0)
  const stallRetunes = useRef(0)
  const retuneTimer = useRef<number | null>(null)

  const settings = useSettings()
  const [playing, setPlaying] = useState(false)

  // Playback has priority over every background transfer.
  useEffect(() => {
    onPlayingChange?.(playing)
  }, [playing, onPlayingChange])
  const [buffering, setBuffering] = useState(true)
  /** Buffering is taking long enough that the viewer deserves a hint. */
  const [slowBuffer, setSlowBuffer] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  /** The picture keeps loading behind the brand sting, with the sound held off. */
  const silenceForIntro = Boolean(externallyMuted)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (silenceForIntro) video.muted = true
    else video.muted = volume === 0
  }, [silenceForIntro, volume])
  const [rate, setRate] = useState(1)
  const [levels, setLevels] = useState<Level[]>([])
  const [level, setLevel] = useState(-1)
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([])
  const [audioTrack, setAudioTrack] = useState(-1)
  const [subtitleTracks, setSubtitleTracks] = useState<TrackOption[]>([])
  const [subtitleTrack, setSubtitleTrack] = useState(-1)
  const [showControls, setShowControls] = useState(true)
  const [menu, setMenu] = useState<'none' | 'quality' | 'speed' | 'audio' | 'subtitles' | 'more'>('none')
  const [fullscreen, setFullscreen] = useState(false)
  /** In-app cinema mode: fills the screen and turns the picture landscape on phones. */
  const [cinema, setCinema] = useState(false)
  /** The turn the rotate control applied, so it can undo exactly that. */
  const [rotationMode, setRotationMode] = useState<RotateMode | null>(null)
  const [portrait, setPortrait] = useState(false)
  /** null follows the handset, true keeps the picture turned even when it is
   *  held upright, false keeps it upright. Driven by the rotate control. */
  const [turnOverride, setTurnOverride] = useState<boolean | null>(null)
  const [pipActive, setPipActive] = useState(false)
  const [audioOnly, setAudioOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumeOpen, setResumeOpen] = useState(askResume && startAt > 30)
  const [ended, setEnded] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /** A failure that does not stop the film (no PiP, no cast target) is a
   *  passing remark, not a reason to cover the picture. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Timeshift window of a live stream, so it can be paused and rewound. */
  const [liveWindow, setLiveWindow] = useState<{ start: number; end: number } | null>(null)

  const castable = useMemo(() => canCastVideo(videoRef.current), [src])
  /** A handset or the packaged app can lay the picture landscape; a desktop
   *  window rotates with the monitor instead. */
  const touchSurface = useMemo(
    () =>
      isNativeShell() ||
      (typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)),
    [],
  )

  useWakeLock(playing && !audioOnly)

  // Live channels get a little longer on screen, then everything but the video
  // goes away — including while paused or when the mouse never moves again.
  const armHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!document.querySelector('[data-player-menu="true"]')) {
        setShowControls(false)
        setMenu('none')
      }
    }, isLive ? LIVE_HIDE_DELAY_MS : HIDE_DELAY_MS)
  }, [isLive])

  const reveal = useCallback(() => {
    setShowControls(true)
    armHide()
  }, [armHide])

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    },
    [],
  )

  // Start the countdown on open, even if the browser blocks autoplay and the
  // play event never arrives.
  useEffect(() => {
    armHide()
  }, [armHide])

  const toggleAudioOnly = useCallback(() => {
    setAudioOnly((value) => !value)
    setMenu('none')
    setShowControls(true)
    armHide()
  }, [armHide])

  /**
   * Retunes the live source after a pause, alternating between the raw-TS and HLS
   * renditions so a codec or edge problem on one of them is skipped next time.
   */
  const retuneLive = useCallback(
    (delay: number) => {
      if (retuneTimer.current) window.clearTimeout(retuneTimer.current)
      if (srcAlt) preferAlt.current = !preferAlt.current
      setNotice('Reconnecting to the channel…')
      retuneTimer.current = window.setTimeout(() => {
        retuneTimer.current = null
        setReloadKey((key) => key + 1)
      }, delay)
    },
    [srcAlt],
  )

  /**
   * A live tune that failed before its first frame retries before the error card.
   *
   * A panel that answers 503 does it in a few hundred milliseconds, and waiting
   * the full eight seconds for a source that never opened is what left a dead
   * channel spinning on "Tuning" for a minute. An immediate failure retries on
   * the short ladder; a tune that ran for a while still gets the full one.
   */
  const retryFailedTune = useCallback(() => {
    const delay = LIVE_TUNE_RETRY_DELAYS[tuneRetries.current]
    if (!isLive || delay === undefined) return false
    const failedFast = performance.now() - tuneStartedAt.current < 2_000
    tuneRetries.current += 1
    retuneLive(failedFast ? Math.min(delay, 700) : delay)
    return true
  }, [isLive, retuneLive])

  // ------------------------------ source setup ------------------------------
  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    tuneStartedAt.current = performance.now()
    setError(null)
    setBuffering(true)
    setEnded(false)
    // A live tune that just failed on raw TS retries on the HLS rendition first.
    const startOnAlt = preferAlt.current && !!srcAlt
    preferAlt.current = false
    triedAlt.current = startOnAlt

    let hls: InstanceType<HlsCtor> | null = null
    let tsPlayer: ReturnType<MpegtsLib['createPlayer']> | null = null
    let cancelled = false
    const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== ''

    const attach = async (url: string) => {
      // Xtream live is normally raw MPEG-TS, which <video> cannot demux. Use
      // mpegts.js over MSE for .ts; HLS stays available as a fallback format.
      if (isLive && isTsUrl(url)) {
        const mpegts = await loadMpegts()
        if (cancelled) return
        const supportsMseTs = (() => {
          try {
            return mpegts.getFeatureList().mseLivePlayback
          } catch {
            return false
          }
        })()
        if (!supportsMseTs) {
          if (srcAlt) {
            triedAlt.current = true
            void attach(srcAlt)
            return
          }
          setError('Live playback is not supported in this browser.')
          setBuffering(false)
          return
        }
        // mpegts fetches inside a Web Worker, where a relative URL cannot be parsed.
        const absoluteUrl = new URL(url, window.location.href).toString()
        tsPlayer = mpegts.createPlayer(
          { type: 'mpegts', isLive: true, url: absoluteUrl },
          { enableWorker: true, liveBufferLatencyChasing: false, lazyLoad: false, enableStashBuffer: true },
        )
        tsRef.current = tsPlayer
        tsPlayer.attachMediaElement(video)
        tsPlayer.load()
        // mpegts.js reports errors it can recover from, and it keeps decoding while
        // it retries — so a running picture must not be hidden behind a failure card.
        let tsRecoveries = 0
        tsPlayer.on(mpegts.Events.ERROR, (type?: string) => {
          if (cancelled || !tsPlayer || tsRef.current !== tsPlayer) return
          // Still playing: the clock is the arbiter, and the stall watchdog below
          // is what speaks up if the picture really stops.
          if (!video.paused && video.readyState >= 2) return
          // A channel whose MPEG-TS carries a codec this browser cannot decode
          // (HEVC, for instance) is still served as HLS. The raw-TS failure used
          // to go straight to the "could not be tuned" card, so those channels
          // looked dead even though their .m3u8 played.
          if (srcAlt && !triedAlt.current) {
            triedAlt.current = true
            try {
              tsPlayer?.destroy()
            } catch {
              /* already torn down */
            }
            if (tsRef.current === tsPlayer) tsRef.current = null
            tsPlayer = null
            void attach(srcAlt)
            return
          }
          if (type !== mpegts.ErrorTypes.MEDIA_ERROR && tsRecoveries < 2) {
            tsRecoveries += 1
            try {
              if ((tsPlayer as { recover?: () => boolean }).recover?.()) return
            } catch {
              /* recover is best effort; fall through to the card */
            }
          }
          if (retryFailedTune()) return
          // Every rendition failed: a duplicate panel entry for the same channel
          // may still play, so the page gets a chance to switch to it.
          if (onTuneFail?.()) return
          setError(TUNE_ERROR_MESSAGE)
          setBuffering(false)
        })
        void video.play().catch(() => undefined)
        return
      }

      const nativeCanPlay = canNativeHls || !isHlsUrl(url)
      if (!nativeCanPlay) {
        const Hls = await loadHls()
        if (cancelled) return
        if (!Hls.isSupported()) {
          // No MSE: hand the URL to the browser and hope for native support.
          video.src = url
          void video.play().catch(() => undefined)
          return
        }
        // On a thin link start conservative: a big first segment is what turns
        // "slow internet" into an endless spinner.
        const slowLink = slowNetworkCap(detectNetworkSpeed(settings.dataSaver)) !== null
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Never fetch a rendition taller than the screen; it only wastes bandwidth.
          capLevelToPlayerSize: true,
          ...(slowLink ? { abrEwmaDefaultEstimate: 600_000, maxBufferLength: 20 } : { maxBufferLength: 30 }),
          // Keep enough history for a usable live timeshift window.
          backBufferLength: isLive ? 1800 : 60,
        })
        hlsRef.current = hls
        hls.loadSource(url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const parsedLevels = hls?.levels ?? []
          setLevels(parsedLevels)
          // Apply the profile preference (Auto stays ABR); data saver caps at 720p.
          const wanted =
            settings.quality === '4K' ? 2160 : settings.quality === 'FHD' ? 1080 : settings.quality === 'HD' ? 720 : settings.quality === 'SD' ? 480 : 0
          const cap = settings.dataSaver ? 720 : wanted
          if (cap > 0 && parsedLevels.length) {
            let best = -1
            parsedLevels.forEach((l, index) => {
              if (l.height <= cap && (best < 0 || l.height > parsedLevels[best].height)) best = index
            })
            if (best >= 0 && hls) hls.currentLevel = best
          }
          setAudioTracks((hls?.audioTracks ?? []).map((t, i) => ({ index: i, label: t.name || t.lang || `Audio ${i + 1}` })))
          setSubtitleTracks(
            (hls?.subtitleTracks ?? []).map((t, i) => ({ index: i, label: t.name || t.lang || `Subtitles ${i + 1}` })),
          )
          void video.play().catch(() => undefined)
        })
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrack(data.id))
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => setSubtitleTrack(data.id))
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setLevel(data.level))
        hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
          if (!data.fatal) return
          if (srcAlt && !triedAlt.current) {
            triedAlt.current = true
            hls?.destroy()
            hls = null
            void attach(srcAlt)
            return
          }
          // A manifest that 503s / 404s can be back a second later on a panel
          // that moves streams between edges, so retry before blaming the channel.
          if (retryFailedTune()) return
          if (onTuneFail?.()) return
          setError(
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
              ? 'Stream could not be reached. The provider may be offline or the connection limit was hit.'
              : `Playback error: ${data.details}`,
          )
          setBuffering(false)
        })
      } else {
        video.src = url
        void video.play().catch(() => undefined)
      }
    }

    void attach(startOnAlt && srcAlt ? srcAlt : src)

    if (startAt > 30) {
      const onMeta = () => {
        if (video.duration && startAt < video.duration - 20) video.currentTime = startAt
      }
      video.addEventListener('loadedmetadata', onMeta, { once: true })
    }

    // After an automatic recovery, continue exactly where the stall hit rather
    // than dropping the viewer back to the resume point from the last save.
    if (resumeAfterRecovery.current > 2) {
      const resumeAt = resumeAfterRecovery.current
      resumeAfterRecovery.current = 0
      const seekBack = () => {
        if (!video.duration || resumeAt < video.duration - 5) video.currentTime = resumeAt
        void video.play().catch(() => undefined)
      }
      if (video.readyState >= 1) seekBack()
      else video.addEventListener('loadedmetadata', seekBack, { once: true })
    }

    return () => {
      cancelled = true
      hls?.destroy()
      if (hlsRef.current === hls) hlsRef.current = null
      try {
        tsPlayer?.destroy()
      } catch {
        /* already torn down */
      }
      if (tsRef.current === tsPlayer) tsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, srcAlt, reloadKey, isLive])

  // A new source (another title or edition) gets its own recovery budget.
  useEffect(() => {
    autoRetries.current = 0
    hasPlayed.current = false
    recoveryTried.current = false
    liveRetunes.current = 0
    tuneRetries.current = 0
    stallRetunes.current = 0
  }, [src])

  // A pending retune must not fire into a player that is gone.
  useEffect(
    () => () => {
      if (retuneTimer.current) window.clearTimeout(retuneTimer.current)
      retuneTimer.current = null
    },
    [],
  )

  // ------------------------------ media events ------------------------------
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      // Labels show whole seconds, so half-second renders are wasted work.
      const next = video.currentTime
      if (Math.abs(next - lastPushedTime.current) < 0.5) return
      lastPushedTime.current = next
      setCurrent(next)
    }
    const onDur = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0)
      syncLiveWindow()
    }
    const syncLiveWindow = () => {
      if (!isLive) return
      if (!video.seekable.length) {
        setLiveWindow(null)
        return
      }
      const start = video.seekable.start(0)
      const end = video.seekable.end(video.seekable.length - 1)
      setLiveWindow(Number.isFinite(start) && Number.isFinite(end) && end - start > 1 ? { start, end } : null)
    }
    const onPlay = () => {
      setPlaying(true)
      setEnded(false)
      armHide()
    }
    const onPause = () => {
      setPlaying(false)
      setShowControls(true)
      // Paused live (timeshift) still clears itself, so the screen shows video only.
      armHide()
      if (onProgress && !isLive) onProgress(video.currentTime, video.duration || 0)
    }
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => {
      hasPlayed.current = true
      // A recovered channel gets its full retry budget back for the next drop.
      tuneRetries.current = 0
      stallRetunes.current = 0
      setBuffering(false)
      // The stream recovered: drop any warning that is no longer true.
      setError(clearTransientError)
    }
    const onError = () => {
      // Ignore the empty-src blip while a source is being torn down.
      if (!video.currentSrc && !video.getAttribute('src')) return
      const code = video.error?.code
      if (code === 1 || code === 0) return
      // The same channel is also published as HLS: try that before telling the
      // viewer the channel is offline.
      if (isLive && srcAlt && !triedAlt.current) {
        triedAlt.current = true
        preferAlt.current = true
        setReloadKey((key) => key + 1)
        return
      }
      // A source the browser refuses to decode will refuse again one second
      // later. Silently reloading it left a black player with no way out — the
      // viewer saw nothing happen and never got the Retry panel.
      const fatal = code === 3 || code === 4
      // A dropped connection, on the other hand, is worth one silent resume.
      // A live channel that drops before any picture is retried too: the panel
      // frees the dead socket and hands out a fresh edge within seconds.
      if (isLive && retryFailedTune()) return
      if (!fatal && !isLive && autoRetries.current < 1) {
        autoRetries.current += 1
        resumeAfterRecovery.current = video.currentTime
        setReloadKey((key) => key + 1)
        return
      }
      setBuffering(false)
      setError(fatal ? UNPLAYABLE_MESSAGE : DROP_ERROR_MESSAGE)
    }
    // An error can land before this listener exists (the source is attached in
    // the effect above), which used to leave the screen black and silent.
    if (video.error && video.error.code >= 2) queueMicrotask(onError)
    const onEnded = () => {
      if (isLive) {
        // A channel's segment buffer can run dry; that is not the end of the film.
        if (liveRetunes.current < 2) {
          liveRetunes.current += 1
          setReloadKey((key) => key + 1)
          return
        }
        setPlaying(false)
        setBuffering(false)
        setError('This channel went offline. Try another channel.')
        return
      }
      setPlaying(false)
      setEnded(true)
      setShowControls(true)
      if (settings.autoplayNext && onNext) onNext()
    }
    const onVolume = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const onBufferedProgress = () => syncLiveWindow()
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onBufferedProgress)
    video.addEventListener('seeked', onBufferedProgress)
    video.addEventListener('durationchange', onDur)
    video.addEventListener('loadedmetadata', onDur)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)

    video.addEventListener('canplay', () => setBuffering(false))
    video.addEventListener('ended', onEnded)
    video.addEventListener('volumechange', onVolume)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onBufferedProgress)
      video.removeEventListener('seeked', onBufferedProgress)
      video.removeEventListener('durationchange', onDur)
      video.removeEventListener('loadedmetadata', onDur)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('volumechange', onVolume)
    }
  }, [armHide, isLive, onNext, onProgress, settings.autoplayNext, retryFailedTune])

  // A slow line is not an error: only give up after every rescue step failed.
  // The check watches real progress, so a stream that keeps playing never trips.
  useEffect(() => {
    if (!src) return
    let lastPosition = -1
    let lastProgressAt = Date.now()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const progressed = video.currentTime !== lastPosition
      if (progressed) {
        lastPosition = video.currentTime
        lastProgressAt = Date.now()
      }
      // Paused on purpose or healthy playback: no stall warning.
      if (video.paused || video.readyState >= 3 || progressed) {
        lastProgressAt = Date.now()
        setError(clearTransientError)
        return
      }
      if (document.visibilityState !== 'visible') return

      const stalledFor = Date.now() - lastProgressAt
      const giveUpAfter = isLive ? LIVE_GIVE_UP_AFTER_MS : GIVE_UP_AFTER_MS
      if (stalledFor >= giveUpAfter) {
        // A live channel that stopped producing data is retuned before the card:
        // dropping the dead request is usually all the panel needs to recover.
        if (isLive && stallRetunes.current < 2) {
          stallRetunes.current += 1
          retuneLive(0)
          return
        }
        // Last resort for a live channel: another panel entry for it.
        if (isLive && onTuneFail?.()) return
        setBuffering(false)
        setError((current) => current ?? STREAM_STALL_MESSAGE)
        return
      }

      // 1. A lighter edition, when the title has one.
      if (!isLive && stalledFor >= DOWNGRADE_AFTER_MS && !recoveryTried.current) {
        recoveryTried.current = true
        if (onStall?.()) return
      }

      // 2. One silent re-attach on the same frame, for a dead socket or a stuck
      //    edge request. Never before the first frame: a slow start just needs time.
      if (!isLive && stalledFor >= RECOVER_AFTER_MS && hasPlayed.current && autoRetries.current < 1) {
        autoRetries.current += 1
        resumeAfterRecovery.current = video.currentTime
        setReloadKey((key) => key + 1)
      }
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [src, reloadKey, isLive, onStall, retuneLive, onTuneFail])

  useEffect(() => {
    if (!buffering) {
      setSlowBuffer(false)
      return
    }
    const timer = window.setTimeout(() => setSlowBuffer(true), 8000)
    return () => window.clearTimeout(timer)
  }, [buffering])

  // Progress persistence: every 30 s while playing.
  useEffect(() => {
    if (!onProgress || isLive) return
    const id = window.setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused) return
      if (Math.abs(video.currentTime - lastSaved.current) < 5) return
      lastSaved.current = video.currentTime
      onProgress(video.currentTime, video.duration || 0)
    }, 30_000)
    return () => window.clearInterval(id)
  }, [isLive, onProgress])

  // Leave with the position saved.
  useEffect(() => {
    const save = () => {
      const video = videoRef.current
      if (video && onProgress && !isLive && video.currentTime > 5) onProgress(video.currentTime, video.duration || 0)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onVisibility)
      save()
    }
  }, [isLive, onProgress])

  // ------------------------------ fullscreen --------------------------------
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Which way the handset is held, so cinema mode knows whether to turn the picture.
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const sync = () => setPortrait(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Leaving the player must never leave the app sideways.
  const rotationModeRef = useRef<RotateMode | null>(null)
  useEffect(() => {
    rotationModeRef.current = rotationMode
  }, [rotationMode])
  useEffect(() => () => void releaseOrientation(rotationModeRef.current), [])

  const expanded = cinema || fullscreen
  /** Whether the picture is landscape right now, however it got there. */
  const rotateActive = rotationMode !== null || (touchSurface && !portrait)
  /** A television is already landscape; a rotate control there is only a trap. */
  const canRotate = document.documentElement.dataset.formFactor !== 'tv'
  /** Whether the cinema surface turns the picture ninety degrees. */
  const rotated = pictureTurned(cinema, turnOverride, portrait)

  /**
   * A turned picture is laid out from the viewport measured in pixels: a WebView
   * whose chrome overhangs the page reports a taller `100vh` than it can show, and
   * sizing the surface from that leaves the picture half off screen.
   */
  const [turnedSize, setTurnedSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!rotated) {
      setTurnedSize(null)
      return
    }
    const sync = () => {
      const doc = document.documentElement
      const w = doc.clientWidth || window.innerWidth
      const h = doc.clientHeight || window.innerHeight
      setTurnedSize(w > 0 && h > 0 ? { w, h } : null)
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [rotated])

  /** "Make it big": real fullscreen when the host allows it. */
  const toggleFullscreen = useCallback(async () => {
    const node = containerRef.current
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
      return
    }
    if (cinema) {
      setCinema(false)
      setTurnOverride(null)
      return
    }
    if (document.fullscreenEnabled && node?.requestFullscreen) {
      try {
        // Some hosts (an embedded panel, a WebView whose fullscreen view is
        // suppressed) leave requestFullscreen() pending forever instead of
        // rejecting, which used to swallow the tap: nothing happened at all.
        // Give the platform a moment, then use the in-app surface.
        const applied = await Promise.race([
          node.requestFullscreen({ navigationUI: 'hide' }).then(() => true).catch(() => false),
          new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 900)),
        ])
        if (applied && document.fullscreenElement === node) {
          reveal()
          return
        }
      } catch {
        /* fall through to the in-app player surface */
      }
    }
    // Graceful fallback: a WebView or an iframe that refuses the Fullscreen API
    // still gets the whole screen, only without the browser's own chrome.
    setCinema(true)
    reveal()
  }, [cinema, reveal])

  /** "Turn it right": rotate the app itself, not just the picture. */
  const toggleRotation = useCallback(async () => {
    if (rotationMode) {
      setRotationMode(null)
      setTurnOverride(null)
      setCinema(false)
      await releaseOrientation(rotationMode)
      reveal()
      return
    }
    const mode = await rotateLandscape()
    setRotationMode(mode)
    if (mode === 'css') {
      // The host cannot rotate the viewport, so the picture is laid over.
      setCinema(true)
      setTurnOverride(true)
    } else {
      setTurnOverride(null)
    }
    reveal()
  }, [rotationMode, reveal])

  // Leaving the player also leaves cinema mode.
  useEffect(() => {
    if (!cinema) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCinema(false)
        setTurnOverride(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cinema])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video) return
    if (isLive) {
      if (!liveWindow) return
      // Stay inside the buffered timeshift window instead of jumping to live.
      video.currentTime = Math.max(
        liveWindow.start,
        Math.min(liveWindow.end - 0.5, video.currentTime + delta),
      )
      reveal()
      return
    }
    video.currentTime = Math.max(0, Math.min((video.duration || 0) - 1, video.currentTime + delta))
    reveal()
  }, [isLive, liveWindow, reveal])

  const endHold = useCallback(() => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    if (holdRepeat.current !== null) window.clearInterval(holdRepeat.current)
    holdTimer.current = null
    holdRepeat.current = null
  }, [])

  /**
   * A tap steps ten seconds; holding walks second by second, then by ten seconds,
   * then by whole minutes, which is the only way to land on an exact moment.
   */
  const startHold = useCallback(
    (direction: 1 | -1) => {
      heldLong.current = false
      endHold()
      holdTimer.current = window.setTimeout(() => {
        heldLong.current = true
        const started = Date.now()
        holdRepeat.current = window.setInterval(() => {
          const held = Date.now() - started
          seekBy(direction * (held < 1200 ? 1 : held < 3000 ? 10 : 60))
        }, 120)
      }, 280)
    },
    [endHold, seekBy],
  )

  const goLive = useCallback(() => {
    const video = videoRef.current
    if (!video || !liveWindow) return
    video.currentTime = Math.max(liveWindow.start, liveWindow.end - 0.5)
    if (video.paused) void video.play().catch(() => undefined)
    reveal()
  }, [liveWindow, reveal])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }, [])

  const togglePip = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setPipActive(false)
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture()
        setPipActive(true)
      } else {
        setNotice('Picture-in-Picture is not available for this stream.')
      }
    } catch {
      // The film is still playing; a fatal overlay here would be a lie, and its
      // Retry button could only reload a stream that is fine.
      setNotice('Picture-in-Picture is not available for this stream.')
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3600)
    return () => window.clearTimeout(t)
  }, [notice])

  // ------------------------------ keyboard ----------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          reveal()
          break
        case 'ArrowRight':
        case 'l':
          // Shift jumps a minute, matching the long-press ramp of the buttons.
          seekBy(e.shiftKey ? 60 : 10)
          break
        case 'ArrowLeft':
        case 'j':
          seekBy(e.shiftKey ? -60 : -10)
          break
        case 'ArrowUp':
          e.preventDefault()
          if (videoRef.current) videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1)
          reveal()
          break
        case 'ArrowDown':
          e.preventDefault()
          if (videoRef.current) videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1)
          reveal()
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          void toggleFullscreen()
          break
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen()
          break
        case 'n':
          if (onNext) onNext()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext, reveal, seekBy, toggleFullscreen, toggleMute, togglePlay])

  // ------------------------------ media session -----------------------------
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: subtitle || 'Vntera',
      album: 'Vntera',
      artwork: poster ? [{ src: poster, sizes: '512x512', type: 'image/jpeg' }] : [],
    })
    navigator.mediaSession.setActionHandler('play', () => void videoRef.current?.play())
    navigator.mediaSession.setActionHandler('pause', () => videoRef.current?.pause())
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10))
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10))
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
      } catch {
        /* unsupported action */
      }
    }
  }, [poster, seekBy, subtitle, title])

  const setSpeed = (value: number) => {
    setRate(value)
    if (videoRef.current) videoRef.current.playbackRate = value
    setMenu('none')
  }

  const chooseLevel = (index: number) => {
    setLevel(index)
    if (hlsRef.current) hlsRef.current.currentLevel = index
    setMenu('none')
  }

  const chooseAudio = (index: number) => {
    setAudioTrack(index)
    if (hlsRef.current) hlsRef.current.audioTrack = index
    setMenu('none')
  }

  const chooseSubtitle = (index: number) => {
    setSubtitleTrack(index)
    if (hlsRef.current) hlsRef.current.subtitleTrack = index
    if (index < 0 && hlsRef.current) hlsRef.current.subtitleDisplay = false
    if (index >= 0 && hlsRef.current) hlsRef.current.subtitleDisplay = true
    setMenu('none')
  }

  const retry = () => {
    setError(null)
    setBuffering(true)
    setReloadKey((key) => key + 1)
  }

  const progressPct = duration ? Math.min(100, (current / duration) * 100) : 0
  const bufferedPct = (() => {
    const video = videoRef.current
    if (!video || !video.buffered.length || !duration) return 0
    return Math.min(100, (video.buffered.end(video.buffered.length - 1) / duration) * 100)
  })()

  /**
   * Where along the track the finger is. Cinema mode rotates the whole player, so
   * the bar runs down the screen and only the vertical coordinate means anything.
   */
  const seekTo = (clientX: number, clientY: number, element: HTMLElement) => {
    const ratio = trackRatio(
      { x: clientX, y: clientY },
      element.getBoundingClientRect(),
      trackAxis(rotated),
    )
    const video = videoRef.current
    if (!video) return
    if (isLive) {
      if (!liveWindow) return
      video.currentTime = liveWindow.start + ratio * (liveWindow.end - liveWindow.start)
      return
    }
    if (duration) video.currentTime = ratio * duration
  }

  const liveEdge = liveWindow?.end ?? 0
  const behindLive = liveWindow ? Math.max(0, liveEdge - current) : 0
  const atLiveEdge = !liveWindow || behindLive < 12
  const livePct = liveWindow
    ? Math.min(100, Math.max(0, ((current - liveWindow.start) / (liveWindow.end - liveWindow.start)) * 100))
    : 0

  return (
    <div
      ref={containerRef}
      className={`group/player relative h-full w-full overflow-hidden bg-black ${
        showControls || menu !== 'none' ? 'cursor-auto' : 'cursor-none'
      }`}
      style={
        rotated
          ? {
              position: 'fixed',
              left: '50%',
              top: '50%',
              width: turnedSize ? turnedSize.h : '100vh',
              height: turnedSize ? turnedSize.w : '100vw',
              transform: 'translate(-50%, -50%) rotate(90deg) translateZ(0)',
              // A WebView composites the picture on its own layer; the transform
              // only reaches it when the surface is promoted too.
              willChange: 'transform',
              backfaceVisibility: 'hidden',
              zIndex: 90,
            }
          : cinema
            ? // Cinema fills the window even when the player was mounted in a smaller box.
              { position: 'fixed', inset: 0, zIndex: 80 }
            : undefined
      }
      onMouseMove={reveal}
      onTouchStart={reveal}
      data-player="true"
      data-spatial="off"
    >
      <video
        ref={videoRef}
        poster={poster}
        preload="auto"
        playsInline
        className={`h-full w-full object-contain ${audioOnly ? 'opacity-0' : 'opacity-100'} transition-opacity`}
        onClick={() => {
          // The faded chrome is not clickable, so a tap that was aimed at one of
          // its buttons used to land here and pause the film instead of opening
          // the controls. A tap on a bare picture only ever brings them back.
          if (!showControls) {
            reveal()
            return
          }
          setMenu('none')
          togglePlay()
          reveal()
        }}
        onDoubleClick={() => void toggleFullscreen()}
      />

      {/* audio-only: the empty video area becomes an in-house platform promo */}
      {audioOnly ? <AudioOnlyAds title={title} /> : null}

      {/* a passing remark: something was refused, the film is unaffected */}
      {notice ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-3 z-40 w-[min(92%,26rem)] -translate-x-1/2 rounded-[4px] border border-crimson/40 bg-black/85 px-3 py-2 text-center text-[12px] leading-snug text-white shadow-lg"
        >
          {notice}
        </div>
      ) : null}

      {/* buffering */}
      {buffering && !error ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-crimson" />
          <span className="text-center text-[11px] font-bold uppercase tracking-widest text-ink-soft">
            {isLive ? 'Tuning live stream' : slowBuffer ? 'Slow connection · still buffering' : 'Buffering'}
          </span>
          {slowBuffer && !isLive ? (
            <span className="text-[10px] text-ink-mute">Your connection is slower than this file — give it a moment.</span>
          ) : null}
        </div>
      ) : null}

      {/* error — above the controls layer, or its buttons would be dead taps */}
      {error ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
          <Icon name="alert" size={34} className="text-crimson" />
          <p className="max-w-md text-sm text-ink-soft">{error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-primary" onClick={retry} data-nav="true">
              <Icon name="refresh" size={16} /> Retry
            </button>
            <button type="button" className="btn btn-secondary" onClick={onExit} data-nav="true">
              Go back
            </button>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="rounded-[3px] border border-white/20 bg-black/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft hover:text-white"
              onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}
              data-nav="true"
            >
              <Icon name="sliders" size={13} className="mr-1 inline" /> Try another quality
            </button>
            <button
              type="button"
              className="rounded-[3px] border border-white/20 bg-black/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft hover:text-white"
              onClick={() => void togglePip()}
              data-nav="true"
            >
              <Icon name="pip" size={13} className="mr-1 inline" /> Keep watching in window
            </button>
          </div>
        </div>
      ) : null}

      {/* resume prompt */}
      {resumeOpen && !error ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-lg border border-stroke bg-layer-1/95 p-5 shadow-2xl">
            <button
              type="button"
              className="absolute right-2 top-2 rounded p-1.5 text-ink-mute transition-colors hover:text-white"
              aria-label="Close and play from the beginning"
              title="Play from the beginning"
              data-nav="true"
              onClick={() => {
                // Closing the prompt means "I'll just watch it" — from the top.
                setResumeOpen(false)
                if (videoRef.current) videoRef.current.currentTime = 0
                void videoRef.current?.play().catch(() => undefined)
                armHide()
              }}
            >
              <Icon name="close" size={16} />
            </button>
            <p className="text-[10px] font-bold uppercase tracking-widest text-crimson">Resume playback</p>
            <h3 className="mt-1 pr-8 text-lg font-bold">{title}</h3>
            <p className="mt-1 text-xs text-ink-soft">You stopped at {formatTimecode(startAt)}.</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                className="btn btn-primary"
                data-nav="true"
                onClick={() => {
                  setResumeOpen(false)
                  const video = videoRef.current
                  if (video) {
                    const go = () => {
                      video.currentTime = startAt
                      void video.play().catch(() => undefined)
                    }
                    if (video.readyState >= 1) go()
                    else video.addEventListener('loadedmetadata', go, { once: true })
                  }
                  armHide()
                }}
              >
                <Icon name="play" size={16} /> Resume from {formatTimecode(startAt)}
              </button>
              <button
                className="btn btn-secondary"
                data-nav="true"
                onClick={() => {
                  setResumeOpen(false)
                  if (videoRef.current) videoRef.current.currentTime = 0
                  void videoRef.current?.play().catch(() => undefined)
                  armHide()
                }}
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ended */}
      {ended && !nextLabel ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/80">
          <p className="text-lg font-bold">Finished</p>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => {
                const video = videoRef.current
                if (video) {
                  video.currentTime = 0
                  void video.play().catch(() => undefined)
                }
                setEnded(false)
              }}
            >
              Replay
            </button>
            <button className="btn btn-secondary" onClick={onExit}>
              Back to details
            </button>
          </div>
        </div>
      ) : null}

      {/* controls */}
      <div
        className={`absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-b from-black/75 via-transparent to-black/85 transition-opacity duration-300 ${
          showControls || menu !== 'none' ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* top bar */}
        <div className="flex items-start justify-between gap-3 p-3 md:p-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <button className="icon-btn mb-5 !h-9 !w-9" aria-label="Back" data-nav="true" onClick={onExit}>
              <Icon name="chevronLeft" size={18} />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold md:text-base">{title}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {castable && !isLive ? (
              <button
                className="icon-btn !h-9 !w-9"
                onClick={() => videoRef.current && startCast(videoRef.current).catch(() => setNotice('No cast device found.'))}
                data-nav="true"
                aria-label="Cast to TV"
                title="Cast (Chromecast / AirPlay)"
              >
                <Icon name="cast" size={17} />
              </button>
            ) : null}
            <button
              className={`icon-btn !h-9 !w-9 ${audioOnly ? '!border-crimson !bg-crimson/20' : ''}`}
              onClick={toggleAudioOnly}
              data-nav="true"
              aria-label="Audio only mode"
              title="Background audio"
            >
              <Icon name="headphones" size={17} />
            </button>
            <button className="icon-btn !h-9 !w-9" onClick={() => setMenu(menu === 'more' ? 'none' : 'more')} data-nav="true" aria-label="More options">
              <Icon name="more" size={18} />
            </button>
          </div>
        </div>

        {/* bottom controls */}
        <div className="px-3 pb-3 md:px-5 md:pb-4" onClick={(e) => e.stopPropagation()}>
          {isLive ? (
            <div className="mb-2">
              {liveWindow ? (
                <>
                  <div
                    className="group/seek relative flex h-6 cursor-pointer items-center"
                    onMouseDown={(e) => {
                      setScrubbing(true)
                      seekTo(e.clientX, e.clientY, e.currentTarget)
                    }}
                    onMouseMove={(e) => {
                      if (scrubbing) seekTo(e.clientX, e.clientY, e.currentTarget)
                    }}
                    onMouseUp={() => setScrubbing(false)}
                    onMouseLeave={() => setScrubbing(false)}
                    onTouchStart={(e) => seekTo(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget)}
                    onTouchMove={(e) => seekTo(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget)}
                    role="slider"
                    aria-label="Seek live TV"
                    aria-valuemin={Math.round(liveWindow.start)}
                    aria-valuemax={Math.round(liveWindow.end)}
                    aria-valuenow={Math.round(current)}
                    tabIndex={0}
                  >
                    <div className="relative h-1 w-full rounded-full bg-white/25">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-crimson" style={{ width: `${livePct}%` }} />
                      <span className="absolute -top-1 h-3 w-[2px] bg-live" style={{ left: 'calc(100% - 2px)' }} title="Live edge" />
                      <span
                        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover/seek:scale-125"
                        style={{ left: `${livePct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] tabular text-ink-soft">
                    <span>{formatTimecode(Math.max(0, current - liveWindow.start))}</span>
                    <span className="text-ink-mute">of {formatTimecode(liveWindow.end - liveWindow.start)} buffered</span>
                    <span className="ml-auto" />
                  </div>
                </>
              ) : null}
              <div className="flex items-center gap-2">
                {atLiveEdge ? (
                  <span className="badge badge-live h-[20px]"><span className="dot" />LIVE</span>
                ) : (
                  <span className="badge h-[20px] border-white/40 bg-white/10 text-white">-{formatTimecode(behindLive)}</span>
                )}
                {liveProgramme ? (
                  <p className="min-w-0 truncate text-[12px] text-ink-soft">
                    <span className="font-semibold text-white">{liveProgramme.title}</span>
                    {' · '}
                    {formatTimecode((liveProgramme.start % 86400000) / 1000).slice(0, 5)} –{' '}
                    {formatTimecode((liveProgramme.end % 86400000) / 1000).slice(0, 5)}
                  </p>
                ) : null}
                {!atLiveEdge ? (
                  <button
                    className="ml-auto flex shrink-0 items-center gap-1 rounded-[3px] bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-black"
                    onClick={goLive}
                    data-nav="true"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-live" /> Go live
                  </button>
                ) : (
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-live">
                    <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" /> Auto
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-2">
              <div
                className="group/seek relative flex h-6 cursor-pointer items-center"
                onMouseDown={(e) => {
                  setScrubbing(true)
                  seekTo(e.clientX, e.clientY, e.currentTarget)
                }}
                onMouseMove={(e) => {
                  if (scrubbing) seekTo(e.clientX, e.clientY, e.currentTarget)
                }}
                onMouseUp={() => setScrubbing(false)}
                onMouseLeave={() => setScrubbing(false)}
                onTouchStart={(e) => seekTo(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget)}
                onTouchMove={(e) => seekTo(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget)}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(current)}
                tabIndex={0}
              >
                <div className="relative h-1 w-full rounded-full bg-white/25">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-crimson" style={{ width: `${progressPct}%` }} />
                  {introEnd && duration > 0 ? (
                    <span
                      className="absolute -top-1 h-3 w-[2px] bg-gold/80"
                      style={{ left: `${(introEnd / duration) * 100}%` }}
                      title="Intro ends"
                    />
                  ) : null}
                  <span
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform group-hover/seek:scale-125"
                    style={{ left: `${progressPct}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-[11px] tabular text-ink-soft">
                <span>{formatTimecode(current)}</span>
                <span>-{formatTimecode(Math.max(0, duration - current))}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
            {!isLive || liveWindow ? (
              <button
                className="icon-btn !border-0 !bg-transparent"
                onPointerDown={() => startHold(-1)}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
                onClick={() => {
                  if (!heldLong.current) seekBy(-10)
                  heldLong.current = false
                }}
                data-nav="true"
                aria-label="Rewind 10 seconds, hold for second-by-second"
                title="Tap 10s · hold for 1s steps"
              >
                <Icon name="forward" size={19} className="-scale-x-100" />
              </button>
            ) : null}
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105"
              onClick={togglePlay}
              data-nav="true"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              <Icon name={playing ? 'pause' : 'play'} size={20} />
            </button>
            {!isLive || liveWindow ? (
              <button
                className="icon-btn !border-0 !bg-transparent"
                onPointerDown={() => startHold(1)}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
                onClick={() => {
                  if (!heldLong.current) seekBy(10)
                  heldLong.current = false
                }}
                data-nav="true"
                aria-label="Forward 10 seconds, hold for second-by-second"
                title="Tap 10s · hold for 1s steps"
              >
                <Icon name="forward" size={19} />
              </button>
            ) : null}

            {introEnd && current < introEnd && !isLive ? (
              <button
                className="ml-1 rounded-[3px] border border-white/30 bg-black/50 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide backdrop-blur hover:bg-white/15"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = introEnd
                }}
                data-nav="true"
              >
                Skip intro
              </button>
            ) : null}

            {nextLabel && onNext ? (
              <button className="btn btn-ghost ml-1 !py-1.5 !text-[11px] uppercase tracking-wide" onClick={onNext} data-nav="true">
                <Icon name="next" size={14} /> {nextLabel}
              </button>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <button className="icon-btn !border-0 !bg-transparent" onClick={toggleMute} data-nav="true" aria-label="Mute preview">
                <Icon name={muted || volume === 0 ? 'mute' : 'volume'} size={18} />
              </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (videoRef.current) {
                      videoRef.current.volume = v
                      videoRef.current.muted = v === 0
                    }
                  }}
                  className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/30 accent-crimson"
                  aria-label="Volume"
                />
              </div>

              <MenuButton
                active={menu === 'quality'}
                onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}
                icon="sliders"
                label={level >= 0 && levels[level] ? `${levels[level].height}p` : 'Auto'}
              />
              <MenuButton active={menu === 'speed'} onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')} icon="speed" label={`${rate}x`} />
              {audioTracks.length > 1 ? (
                <MenuButton active={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? 'none' : 'audio')} icon="audio" label="Audio" />
              ) : null}
              {subtitleTracks.length > 0 ? (
                <MenuButton
                  active={menu === 'subtitles' || subtitleTrack >= 0}
                  onClick={() => setMenu(menu === 'subtitles' ? 'none' : 'subtitles')}
                  icon="subtitles"
                  label="CC"
                />
              ) : null}
              {!isLive ? (
                <button className="icon-btn !border-0 !bg-transparent" onClick={() => void togglePip()} data-nav="true" aria-label="Picture in Picture" title="Picture-in-Picture">
                  <Icon name="pip" size={18} className={pipActive ? 'text-crimson' : ''} />
                </button>
              ) : null}
              {canRotate ? (
                <button
                  className="icon-btn !border-0 !bg-transparent"
                  onClick={() => void toggleRotation()}
                  data-nav="true"
                  aria-label={rotateActive ? 'Turn the picture back upright' : 'Turn the picture to landscape'}
                  title={rotateActive ? 'Rotate back to portrait' : 'Rotate to landscape'}
                  aria-pressed={rotateActive}
                >
                  <Icon name="rotate" size={18} className={rotateActive ? 'text-crimson' : ''} />
                </button>
              ) : null}
              <button
                className="icon-btn !border-0 !bg-transparent"
                onClick={() => void toggleFullscreen()}
                data-nav="true"
                aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'}
                title={expanded ? 'Exit fullscreen' : 'Fullscreen'}
                aria-pressed={expanded}
              >
                <Icon name={expanded ? 'minimize' : 'maximize'} size={18} />
              </button>
            </div>
          </div>

          {/* menus */}
          {menu !== 'none' ? (
            <div
              data-player-menu="true"
              className="absolute bottom-20 right-3 z-40 w-[15rem] overflow-hidden rounded-lg border border-stroke bg-layer-1/98 shadow-2xl backdrop-blur-xl md:right-5"
            >
              <div className="flex items-center justify-between border-b border-stroke px-3 py-2">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-ink-soft">
                  {menu === 'quality' ? 'Stream quality' : menu === 'speed' ? 'Playback speed' : menu === 'audio' ? 'Audio track' : menu === 'subtitles' ? 'Subtitles' : 'Playback options'}
                </span>
                <button className="text-ink-mute hover:text-white" onClick={() => setMenu('none')} aria-label="Close menu">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto py-1">
                {menu === 'quality' ? (
                  <>
                    {levels.length ? (
                      <>
                        <MenuRow active={level === -1} onClick={() => chooseLevel(-1)} label="Auto" meta={level >= 0 && levels[level] ? `${levels[level].height}p` : 'ABR'} />
                        {levels
                          .map((l, i) => ({ l, i }))
                          .sort((a, b) => b.l.height - a.l.height)
                          .map(({ l, i }) => (
                            <MenuRow
                              key={i}
                              active={level === i}
                              onClick={() => chooseLevel(i)}
                              label={`${l.height}p`}
                              meta={l.bitrate ? `${Math.round(l.bitrate / 1000)} kbps` : ''}
                            />
                          ))}
                      </>
                    ) : null}
                    {editions?.map((e) => (
                      <MenuRow key={e.id} active={e.active} onClick={e.onSelect} label={e.label} meta={e.active ? 'Playing' : 'Switch'} />
                    ))}
                    {!levels.length && !editions?.length ? <p className="px-3 py-2 text-xs text-ink-mute">Single rendition stream.</p> : null}
                  </>
                ) : null}
                {menu === 'speed' ? (
                  [0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                    <MenuRow key={s} active={rate === s} onClick={() => setSpeed(s)} label={`${s}x`} meta={s === 1 ? 'Normal' : ''} />
                  ))
                ) : null}
                {menu === 'audio' ? (
                  <>
                    {audioTracks.map((t) => (
                      <MenuRow key={t.index} active={audioTrack === t.index} onClick={() => chooseAudio(t.index)} label={t.label} />
                    ))}
                    {!audioTracks.length ? <p className="px-3 py-2 text-xs text-ink-mute">One audio track in this stream.</p> : null}
                  </>
                ) : null}
                {menu === 'subtitles' ? (
                  <>
                    <MenuRow active={subtitleTrack === -1} onClick={() => chooseSubtitle(-1)} label="Off" />
                    {subtitleTracks.map((t) => (
                      <MenuRow key={t.index} active={subtitleTrack === t.index} onClick={() => chooseSubtitle(t.index)} label={t.label} />
                    ))}
                    {!subtitleTracks.length ? <p className="px-3 py-2 text-xs text-ink-mute">No subtitle tracks in this stream.</p> : null}
                  </>
                ) : null}
                {menu === 'more' ? (
                  <>
                    <MenuRow active={audioOnly} onClick={toggleAudioOnly} label="Audio only" meta="Keep sound, drop video" />
                    {!isLive ? <MenuRow active={!!pipActive} onClick={() => void togglePip()} label="Picture-in-Picture" /> : null}
                    <MenuRow
                      active={fullscreen || cinema}
                      onClick={() => void toggleFullscreen()}
                      label="Fullscreen"
                    />
                    {canRotate ? (
                      <MenuRow
                        active={rotateActive}
                        onClick={() => void toggleRotation()}
                        label={rotateActive ? 'Turn back upright' : 'Turn the picture'}
                        meta={rotateActive ? 'Portrait' : 'Landscape'}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
      </div>
    </div>
  )
}

function MenuButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: 'sliders' | 'speed' | 'audio' | 'subtitles'
  label: string
}) {
  return (
    <button
      onClick={onClick}
      data-nav="true"
      className={`flex h-8 items-center gap-1 rounded-[3px] border px-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
        active ? 'border-white/60 bg-white/20 text-white' : 'border-white/20 bg-black/30 text-ink-soft hover:text-white'
      }`}
      aria-label={icon === 'subtitles' ? 'Subtitles' : label}
    >
      <Icon name={icon} size={14} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function MenuRow({ active, onClick, label, meta }: { active: boolean; onClick: () => void; label: string; meta?: string }) {
  return (
    <button
      onClick={onClick}
      data-nav="true"
      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-layer-3 ${
        active ? 'text-white' : 'text-ink-soft'
      }`}
    >
      <span className="flex items-center gap-2 truncate">
        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-crimson' : 'bg-transparent'}`} />
        {label}
      </span>
      {meta ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-mute">{meta}</span> : null}
    </button>
  )
}

export type { MediaPlaylist }
