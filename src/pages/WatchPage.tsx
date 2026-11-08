import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Player, type EditionOption } from '../components/player/Player'
import { IntroPreroll } from '../components/player/IntroPreroll'
import { useCatalog } from '../store/catalog'
import { useDetails } from '../store/details'
import { useLibrary } from '../store/library'
import { useEpg } from '../store/epg'
import { useSettings } from '../store/settings'
import { streamUrl } from '../lib/xtream'
import { useOffline } from '../store/offline'
import { detectNetworkSpeed, lowerEdition, pickEdition } from '../lib/editions'
import { uniqueEditions } from '../lib/normalize'
import { nowPlaying } from '../lib/epg'
import type { RawEpisode, Title } from '../types'

const EMPTY_PROGRAMMES: never[] = []

export default function WatchPage() {
  const { kind: kindParam, id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const kind = (kindParam as 'movie' | 'series' | 'live') || 'movie'
  const numericId = Number(id)

  const snapshot = useCatalog((s) => s.snapshot)
  const settings = useSettings()
  const saveProgress = useLibrary((s) => s.saveProgress)
  const markWatched = useLibrary((s) => s.markWatched)
  const progress = useLibrary((s) => s.progress)

  const loadSeries = useDetails((s) => s.loadSeries)
  const seriesInfo = useDetails((s) => s.series[numericId])

  const offlineJobs = useOffline((s) => s.jobs)
  const setOfflinePlayback = useOffline((s) => s.setPlayback)

  // Movies and series open with the brand sting; live channels tune straight in.
  const [introDone, setIntroDone] = useState(kind === 'live')

  useEffect(() => {
    setIntroDone(kind === 'live')
  }, [kind])

  const season = Number(params.get('season') || 1)
  const episode = Number(params.get('episode') || 1)
  const editionParam = Number(params.get('edition')) || null
  // Details page hands over an explicit choice: resume without asking, or start at zero.
  const resumeNow = params.get('resume') === '1'
  const restart = params.get('restart') === '1'

  const title = useMemo<Title | undefined>(() => {
    if (!snapshot) return undefined
    const pool = kind === 'live' ? snapshot.channels : kind === 'series' ? snapshot.series : snapshot.movies
    return pool.find((t) => t.id === numericId)
  }, [snapshot, kind, numericId])

  useEffect(() => {
    if (kind === 'series') void loadSeries(numericId)
  }, [kind, numericId, loadSeries])

  const seasons = useMemo(() => {
    if (!seriesInfo) return []
    const eps = seriesInfo.episodes ?? {}
    return Object.keys(eps)
      .map((n) => ({ season: Number(n), episodes: eps[n] as RawEpisode[] }))
      .sort((a, b) => a.season - b.season)
  }, [seriesInfo])

  const currentSeason = seasons.find((s) => s.season === season)
  const currentEpisode = currentSeason?.episodes.find((e) => Number(e.episode_num) === episode)

  const nextEpisode = useMemo(() => {
    if (kind !== 'series' || !seasons.length) return undefined
    const idx = currentSeason?.episodes.findIndex((e) => Number(e.episode_num) === episode) ?? -1
    if (idx >= 0 && idx < (currentSeason?.episodes.length ?? 0) - 1) {
      return { season, episode: episode + 1, title: currentSeason?.episodes[idx + 1]?.title }
    }
    const nextSeason = seasons.find((s) => s.season === season + 1)
    if (nextSeason?.episodes[0]) {
      return { season: nextSeason.season, episode: 1, title: nextSeason.episodes[0].title }
    }
    return undefined
  }, [kind, seasons, currentSeason, season, episode])

  // Panel entries can repeat the same quality/language; show and switch each real
  // edition once. Live is the exception: two identical-looking entries there are
  // separate panel streams for the same channel, and one of them is often dead,
  // so all of them are kept as tuning candidates (the menu still shows one).
  const editions = useMemo(
    () => (kind === 'live' ? (title?.editions ?? []) : uniqueEditions(title?.editions ?? [])),
    [title, kind],
  )

  // The pinned quality wins; on "auto" a thin connection starts on a lighter
  // edition instead of stalling on the biggest file the panel offers.
  /** Live entries tried so far, so a dead duplicate can hand over to one that plays. */
  const [liveTry, setLiveTry] = useState(0)
  const liveTryRef = useRef(0)
  useEffect(() => {
    liveTryRef.current = 0
    setLiveTry(0)
  }, [numericId, kind])

  // A live channel's extra "editions" are duplicate panel entries for the same
  // channel, not lighter renditions of one stream. The newest provision is the
  // one to tune first; the rest are backups when that entry has gone dead.
  const liveOrder = useMemo(
    () => [...editions].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)),
    [editions],
  )
  // The player calls back long after mount, so the callback reads the current
  // list through a ref instead of a closure the first render captured.
  const liveOrderRef = useRef(liveOrder)
  useEffect(() => {
    liveOrderRef.current = liveOrder
  }, [liveOrder])

  const edition = useMemo(() => {
    const pinned = editions.find((e) => e.streamId === editionParam)
    if (pinned) return pinned
    if (kind === 'live') return liveOrder[Math.min(liveTry, Math.max(liveOrder.length - 1, 0))]
    return pickEdition(editions, settings.quality, detectNetworkSpeed(settings.dataSaver))
  }, [editions, editionParam, kind, liveTry, liveOrder, settings.quality, settings.dataSaver])

  /**
   * Every rendition of this entry failed: try the channel's next panel entry.
   *
   * Two spare entries are enough to find the one that still plays; walking the
   * whole list would keep a channel that is down upstream on "Tuning" for
   * minutes instead of saying so.
   */
  const tryAnotherLiveEntry = useCallback(() => {
    if (kind !== 'live' || editionParam) return false
    const order = liveOrderRef.current
    const next = liveTryRef.current + 1
    if (!order[next] || next > 2) return false
    liveTryRef.current = next
    setLiveTry(next)
    return true
  }, [kind, editionParam])

  const streamId =
    kind === 'series' ? Number(currentEpisode?.id ?? 0) : (edition?.streamId ?? title?.id ?? 0)
  const container = kind === 'series' ? currentEpisode?.container_extension : edition?.container

  const src = useMemo(() => {
    if (!title || !streamId) return ''
    if (kind === 'live') return streamUrl('live', streamId, { liveFormat: 'ts' })
    return streamUrl(kind === 'series' ? 'series' : 'movie', streamId, { container })
  }, [title, streamId, kind, container])

  const altSrc = useMemo(() => {
    if (kind !== 'live' || !streamId) return undefined
    return streamUrl('live', streamId, { liveFormat: 'm3u8' })
  }, [kind, streamId])

  // A finished download for exactly this edition plays from the device; the
  // network is not touched at all, which is what makes it work with it off.
  // The Downloads page names the job explicitly, so a finished edition is used
  // even when another quality would have been picked for this session.
  const localParam = params.get('local')
  const offlineCopy = useMemo(() => {
    if (kind === 'live') return undefined
    const named = localParam ? offlineJobs.find((job) => job.id === localParam) : undefined
    if (named && named.state === 'completed') return named
    return offlineJobs.find(
      (job) =>
        job.state === 'completed' &&
        !job.lookahead &&
        job.streamId === streamId &&
        job.titleId === numericId,
    )
  }, [offlineJobs, kind, streamId, numericId, localParam])
  const [localSrc, setLocalSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!offlineCopy) {
      setLocalSrc(null)
      return
    }
    let alive = true
    void useOffline
      .getState()
      .localUrl(offlineCopy)
      .then((url) => {
        if (alive) setLocalSrc(url)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [offlineCopy])

  const ensureEpg = useEpg((s) => s.ensure)
  const epg = useEpg((s) => (title ? s.cache[title.epgChannelId || String(title.id)]?.programmes ?? EMPTY_PROGRAMMES : EMPTY_PROGRAMMES))

  useEffect(() => {
    if (kind === 'live' && title) void ensureEpg({ channelId: title.epgChannelId, streamId: title.id, name: title.name, full: true })
  }, [kind, title, ensureEpg])

  const image = kind === 'series' ? currentEpisode?.info?.movie_image || title?.poster : title?.poster

  const handleProgress = useCallback(
    (seconds: number, duration: number) => {
      if (!title || kind === 'live' || !duration) return
      saveProgress({
        contentId: title.id,
        contentType: kind,
        title: kind === 'series' ? `${title.name} · S${season} E${episode}` : title.name,
        thumbnail: image,
        progress: seconds,
        duration,
        season: kind === 'series' ? season : undefined,
        episode: kind === 'series' ? episode : undefined,
        episodeTitle: kind === 'series' ? currentEpisode?.title : undefined,
        parentId: title.id,
        provider: title.provider,
      })
      if (kind === 'series' && duration > 0 && seconds / duration > 0.9) markWatched(title.id, season, episode)
    },
    [title, kind, season, episode, image, saveProgress, markWatched, currentEpisode?.title],
  )

  /** A stalling stream asks for a lighter edition before the player gives up. */
  const dropToOneLighterEdition = useCallback(() => {
    if (kind === 'live') return false
    const lower = lowerEdition(editions, edition)
    if (!lower) return false
    const query = new URLSearchParams()
    if (kind === 'series') {
      query.set('season', String(season))
      query.set('episode', String(episode))
    }
    query.set('edition', String(lower.streamId))
    navigate(`/watch/${kind}/${numericId}?${query.toString()}`, { replace: true })
    return true
  }, [kind, editions, edition, season, episode, navigate, numericId])

  // Leaving the player means leaving it: the old handler navigated to
  // /watch/<kind>/<id>, which is the page it was already on, so back and
  // "Go back" on the error panel looked like dead buttons. The place the
  // player was opened from is the title page (live channels have none).
  const exit = () => {
    // A channel opened from Home, from Search or from a rail must go back to
    // exactly that place — the live branch used to send everyone to /live, and
    // a search result lost the query it was found with.
    const depth = (window.history.state as { idx?: number } | null)?.idx
    if (typeof depth === 'number' && depth > 0) {
      navigate(-1)
      return
    }
    // Opened cold (a deep link or a notification): there is nothing to go back to.
    if (!title || kind === 'live') {
      navigate('/', { replace: true })
      return
    }
    navigate(`/title/${kind}/${title.id}`, { replace: true })
  }

  const editionOptions: EditionOption[] = []
  const savedProgress = title ? progress[`${kind}:${title.id}`]?.progress ?? 0 : 0
  const resumeAt = kind === 'live' || restart ? 0 : savedProgress
  const liveNow = nowPlaying(epg)

  // Titles only — no year/quality metadata overlay on the player.
  const subtitle = kind === 'series'
    ? `S${season} E${episode}${currentEpisode?.title ? ` · ${currentEpisode.title}` : ''}`
    : kind === 'live'
      ? `${title?.categoryName ?? ''}${title?.num ? ` · CH ${String(title.num).padStart(3, '0')}` : ''}`
      : ''

  // While a video is playing the queue is parked; a real pause starts a bounded
  // look-ahead so resuming after a slow patch does not refetch the opening.
  const hasPlayed = useRef(false)
  const handlePlayState = useCallback(
    (playing: boolean) => {
      setOfflinePlayback(playing)
      if (playing) {
        hasPlayed.current = true
        return
      }
      if (!hasPlayed.current || kind === 'live' || !title) return
      void useOffline.getState().addLookahead({
        titleId: title.id,
        kind: kind === 'series' ? 'series' : 'movie',
        streamId,
        title: title.name,
        subtitle,
        poster: image,
        season: kind === 'series' ? season : undefined,
        episode: kind === 'series' ? episode : undefined,
        url: src,
        mime: container ? `video/${container}` : 'video/mp4',
      })
    },
    [setOfflinePlayback, kind, title, streamId, subtitle, image, season, episode, src, container],
  )

  useEffect(() => {
    return () => {
      setOfflinePlayback(false)
      void useOffline.getState().dropLookahead(title?.id)
    }
  }, [setOfflinePlayback, title?.id])

  if (!title || !src) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="text-center">
          <p className="text-sm text-ink-mute">Stream unavailable.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      {/* The film buffers underneath the brand sting, muted, so the sting never
          costs the viewer a second download when it ends. */}
      <Player
        src={localSrc ?? src}
        srcAlt={localSrc ? undefined : altSrc}
        title={title.name}
        subtitle={subtitle}
        poster={image}
        isLive={kind === 'live'}
        startAt={resumeAt}
        askResume={!resumeNow && !restart}
        nextLabel={nextEpisode ? `Next · S${nextEpisode.season} E${nextEpisode.episode}` : undefined}
        onNext={
          nextEpisode
            ? () =>
                navigate(
                  `/watch/series/${title.id}?season=${nextEpisode.season}&episode=${nextEpisode.episode}&edition=${edition?.streamId ?? ''}`,
                  { replace: true },
                )
            : undefined
        }
        onExit={exit}
        onProgress={handleProgress}
        editions={settings.quality === 'auto' ? editionOptions : editionOptions}
        liveProgramme={liveNow ? { title: liveNow.title, start: liveNow.start, end: liveNow.end } : undefined}
        onStall={kind === 'live' || localSrc ? undefined : dropToOneLighterEdition}
        onTuneFail={kind === 'live' && !localSrc ? tryAnotherLiveEntry : undefined}
        muted={!introDone}
        onPlayingChange={handlePlayState}
      />
      {!introDone ? <IntroPreroll title={title.name} onDone={() => setIntroDone(true)} /> : null}
    </div>
  )
}
