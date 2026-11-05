import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Player, type EditionOption } from '../components/player/Player'
import { IntroPreroll } from '../components/player/IntroPreroll'
import { useCatalog } from '../store/catalog'
import { useDetails } from '../store/details'
import { useLibrary } from '../store/library'
import { useEpg } from '../store/epg'
import { useSettings } from '../store/settings'
import { streamUrl } from '../lib/xtream'
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

  // Panel entries can repeat the same quality/language; show and switch each real edition once.
  const editions = useMemo(() => uniqueEditions(title?.editions ?? []), [title])

  // The pinned quality wins; on "auto" a thin connection starts on a lighter
  // edition instead of stalling on the biggest file the panel offers.
  const edition = useMemo(
    () =>
      editions.find((e) => e.streamId === editionParam) ??
      pickEdition(editions, settings.quality, detectNetworkSpeed(settings.dataSaver)),
    [editions, editionParam, settings.quality, settings.dataSaver],
  )

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
    if (!title) {
      navigate(-1)
      return
    }
    if (kind === 'live') {
      navigate('/live', { replace: true })
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

  if (!title || !src) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="text-center">
          <p className="text-sm text-ink-mute">Stream unavailable.</p>
        </div>
      </div>
    )
  }

  if (!introDone) return <IntroPreroll title={title.name} onDone={() => setIntroDone(true)} />

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <Player
        src={src}
        srcAlt={altSrc}
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
        onStall={kind === 'live' ? undefined : dropToOneLighterEdition}
      />
    </div>
  )
}
