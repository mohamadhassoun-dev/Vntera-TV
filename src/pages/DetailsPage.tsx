import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Art } from '../components/Art'
import { Icon } from '../components/Icons'
import { EmptyState } from '../components/Feedback'
import { LiveBadge, QualityBadge, RatingBadge } from '../components/Badges'
import { PosterRail } from '../components/Rails'
import { DownloadButton } from '../components/DownloadButton'
import { Select } from '../components/Select'
import { streamUrl } from '../lib/xtream'
import { useCatalog } from '../store/catalog'
import { useDetails } from '../store/details'
import { useLibrary } from '../store/library'
import { useEpg } from '../store/epg'
import { useSettings } from '../store/settings'
import { detectNetworkSpeed, pickEdition } from '../lib/editions'
import { formatClock, nowPlaying, nextUp, programmeProgress } from '../lib/epg'
import { formatRuntime, formatTimecode, nameWithoutYear, relativeTime } from '../lib/format'
import { QUALITY_LABELS } from '../lib/config'
import type { RawEpisode, Title } from '../types'

type Kind = 'movie' | 'series' | 'live'

const EMPTY_PROGRAMMES: never[] = []

export default function DetailsPage() {
  const { kind: kindParam, id } = useParams()
  const navigate = useNavigate()
  const numericId = Number(id)
  const kind = (kindParam as Kind) || 'movie'

  const snapshot = useCatalog((s) => s.snapshot)
  const settings = useSettings()
  const list = useLibrary((s) => s.list)
  const toggleList = useLibrary((s) => s.toggleList)
  const progress = useLibrary((s) => s.progress)
  const watched = useLibrary((s) => s.watched)

  const loadSeries = useDetails((s) => s.loadSeries)
  const loadVod = useDetails((s) => s.loadVod)
  const seriesInfo = useDetails((s) => s.series[numericId])
  const seriesLoading = useDetails((s) => s.loading[`s${numericId}`])
  const seriesError = useDetails((s) => s.error[`s${numericId}`])
  const vodInfo = useDetails((s) => s.vod[numericId])

  const title = useMemo<Title | undefined>(() => {
    if (!snapshot) return undefined
    const pool = kind === 'live' ? snapshot.channels : kind === 'series' ? snapshot.series : snapshot.movies
    return pool.find((t) => t.id === numericId)
  }, [snapshot, kind, numericId])

  const [editionId, setEditionId] = useState<number | null>(null)
  const [season, setSeason] = useState(1)
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null)

  useEffect(() => {
    if (kind === 'series') void loadSeries(numericId)
    if (kind === 'movie') void loadVod(numericId)
  }, [kind, numericId, loadSeries, loadVod])

  const ensureEpg = useEpg((s) => s.ensure)
  const epg = useEpg((s) => (title ? s.cache[title.epgChannelId || String(title.id)]?.programmes ?? EMPTY_PROGRAMMES : EMPTY_PROGRAMMES))

  useEffect(() => {
    if (kind === 'live' && title) void ensureEpg({ channelId: title.epgChannelId, streamId: title.id, name: title.name, full: true })
  }, [kind, title, ensureEpg])

  const seasons = useMemo(() => {
    if (!seriesInfo) return []
    const episodes = seriesInfo.episodes ?? {}
    const keys = seriesInfo.seasons?.length
      ? seriesInfo.seasons.map((s) => Number(s.season_number))
      : Object.keys(episodes).map(Number)
    return keys
      .map((n) => ({ number: n, episodes: (episodes[String(n)] ?? []) as RawEpisode[] }))
      .filter((s) => s.episodes.length)
      .sort((a, b) => a.number - b.number)
  }, [seriesInfo])

  useEffect(() => {
    if (!seasons.length) return
    const entry = progress[`series:${numericId}`]
    const target = entry?.season && seasons.some((s) => s.number === entry.season) ? entry.season : seasons[seasons.length - 1].number
    setSeason(target)
  }, [seasons, progress, numericId])

  const inList = title ? list.some((l) => l.contentId === title.id && l.contentType === (title.kind === 'live' ? 'live' : title.kind)) : false
  const seriesProgress = progress[`series:${numericId}`]
  const movieProgress = progress[`movie:${numericId}`]
  // Resume/start-over replaces Play only for a real, unfinished position.
  // The player itself prompts above 30 s, so shorter positions just start over.
  const canResume = Boolean(
    kind === 'movie' &&
      movieProgress &&
      movieProgress.progress > 30 &&
      (!movieProgress.duration || movieProgress.progress < movieProgress.duration - 30),
  )

  // Two panel streams can be identical editions (same quality + language);
  // show one selectable version per real edition.
  const uniqueEditions = useMemo(() => {
    const map = new Map<string, Title['editions'][number]>()
    for (const e of title?.editions ?? []) {
      const langs = e.languages.filter((l) => l && l !== 'und')
      const label = `${e.quality}|${langs.join(',')}`
      if (!map.has(label)) map.set(label, e)
    }
    return [...map.values()]
  }, [title])

  const currentSeason = seasons.find((s) => s.number === season)

  const similar = useMemo<Title[]>(() => {
    if (!snapshot || !title) return []
    if (title.kind === 'live') return snapshot.channels.filter((c) => c.categoryId === title.categoryId && c.id !== title.id).slice(0, 14)
    const pool = title.kind === 'movie' ? snapshot.movies : snapshot.series
    const byGenre = pool.filter((t) => t.id !== title.id && t.hasArtwork && t.genres.some((g) => title.genres.includes(g)))
    return (byGenre.length ? byGenre : pool.filter((t) => t.id !== title.id && t.hasArtwork)).slice(0, 14)
  }, [snapshot, title])

  if (!title) {
    return (
      <div className="shell-x pb-24 pt-28">
        <EmptyState
          icon="film"
          title="Title not available"
          body="This entry is no longer in the cached library. Try refreshing your catalog."
          action={<Link to="/" className="btn btn-primary">Back home</Link>}
        />
      </div>
    )
  }

  // A version picked here wins; otherwise "auto" starts on the lightest edition
  // the connection can carry, so a slow line does not open straight into a 4K file.
  const activeEdition =
    uniqueEditions.find((e) => e.streamId === editionId) ??
    pickEdition(uniqueEditions, settings.quality, detectNetworkSpeed(settings.dataSaver)) ??
    uniqueEditions[0] ??
    title.editions[0]

  const plot = (vodInfo?.info?.plot || title.plot || '').trim()
  const castList = (vodInfo?.info?.cast || title.cast.join(', ') || '').trim()
  const director = (vodInfo?.info?.director || title.director || '').trim()
  const country = (vodInfo?.info?.country || title.country || '').trim()
  const languageLabel = title.languages
    .filter((l) => l !== 'und')
    .map((l) => l.toUpperCase())
    .join(', ')
  const genreList = (vodInfo?.info?.genre ? vodInfo.info.genre.split(/[,/]/) : title.genres)
    .map((g) => g.trim())
    .filter(Boolean)

  const liveNow = nowPlaying(epg)
  const liveNext = nextUp(epg)

  const play = (opts?: { season?: number; episode?: number; resume?: boolean; restart?: boolean }) => {
    if (title.kind === 'live') {
      navigate(`/watch/live/${title.id}?edition=${activeEdition.streamId}`)
    } else if (title.kind === 'movie') {
      const query = new URLSearchParams({ edition: String(activeEdition.streamId) })
      if (opts?.resume) query.set('resume', '1')
      if (opts?.restart) query.set('restart', '1')
      navigate(`/watch/movie/${title.id}?${query.toString()}`)
    } else {
      const s = opts?.season ?? seriesProgress?.season ?? seasons[0]?.number ?? 1
      const ep = opts?.episode ?? (seriesProgress?.season === s ? seriesProgress.episode : undefined) ?? 1
      navigate(`/watch/series/${title.id}?season=${s}&episode=${ep}&edition=${activeEdition.streamId}`)
    }
  }

  const backdrop = vodInfo?.info?.backdrop_path
  const backdropUrl = Array.isArray(backdrop) ? backdrop[0] : backdrop

  return (
    <div className="pb-24">
      {/* hero */}
      <section className="relative">
        <div className="absolute inset-0 h-[68vh] min-h-[460px] overflow-hidden">
          <Art
            src={title.backdrop || backdropUrl || title.poster}
            title={title.name}
            kind="backdrop"
            seed={`${title.id}-detail`}
            priority
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/70 to-canvas/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/50 to-transparent" />
        </div>

        <div className="shell-x relative z-10 pt-24 md:pt-28">

          <div className="flex flex-col gap-6 md:flex-row md:items-end">
            <div className="hidden w-[11rem] shrink-0 overflow-hidden rounded-[4px] border border-stroke shadow-2xl md:block">
              <Art src={title.poster} title={title.name} seed={`${title.id}`} className="aspect-[2/3] w-full object-cover" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {title.kind === 'live' ? <LiveBadge /> : null}
                {title.vnteraOriginal ? (
                  <span className="rounded-[2px] bg-white/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-crimson">
                    Vntera Original
                  </span>
                ) : null}
                {title.provider !== 'other' ? (
                  <span className="rounded-[2px] bg-black/50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-ink-soft">
                    {title.provider}
                  </span>
                ) : null}
                <span className="rounded-[2px] bg-layer-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-ink-soft">
                  {title.categoryName}
                </span>
              </div>

              <h1 className="mt-2 text-3xl font-black leading-[1.02] tracking-[-0.03em] md:text-5xl">
                {title.year ? nameWithoutYear(title.name) : title.name}
              </h1>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
                {title.year ? <span className="tabular font-bold text-white">{title.year}</span> : null}
                {title.kind === 'series' && title.seasons ? <span>{title.seasons} seasons</span> : null}
                {title.durationSec ? <span>{formatRuntime(title.durationSec)}</span> : null}
                {title.ageRating ? <span className="rounded-[2px] bg-layer-3 px-1.5 py-0.5 text-[10px]">{title.ageRating}</span> : null}
                <RatingBadge rating={title.rating} />
                <QualityBadge quality={title.quality} size="md" />
                {title.kind === 'live' && title.tvArchive ? (
                  <span className="badge border-azure/50 text-azure-soft">{title.tvArchive}d catch-up</span>
                ) : null}
              </div>

              {plot ? (
                <p className="mt-4 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft md:text-sm">{plot}</p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {canResume && movieProgress ? (
                  <>
                    <button className="btn btn-primary" onClick={() => play({ resume: true })} data-nav="true">
                      <Icon name="play" size={20} /> Resume from {formatTimecode(movieProgress.progress)}
                    </button>
                    <button className="btn btn-secondary" onClick={() => play({ restart: true })} data-nav="true">
                      <Icon name="refresh" size={17} /> Start over
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={() => play()} data-nav="true">
                    <Icon name="play" size={20} />
                    {title.kind === 'series' && seriesProgress ? `Resume S${seriesProgress.season} E${seriesProgress.episode}` : 'Play'}
                  </button>
                )}
                {title.kind === 'movie' ? (
                  <DownloadButton
                    target={{
                      titleId: title.id,
                      kind: 'movie',
                      streamId: activeEdition.streamId,
                      title: title.name,
                      poster: title.poster,
                      url: streamUrl('movie', activeEdition.streamId, { container: activeEdition.container }),
                      mime: `video/${activeEdition.container || 'mp4'}`,
                    }}
                  />
                ) : null}
                {title.trailer ? (
                  <a
                    href={title.trailer}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary"
                    data-nav="true"
                  >
                    <Icon name="film" size={17} /> Trailer
                  </a>
                ) : null}
                <button
                  className="btn btn-ghost"
                  onClick={() => toggleList(title)}
                  data-nav="true"
                >
                  <Icon name={inList ? 'check' : 'plus'} size={17} /> {inList ? 'In My List' : 'My List'}
                </button>
                {title.trailer || true ? (
                  <button
                    className="icon-btn"
                    onClick={() => {
                      const url = `${window.location.origin}/title/${title.kind}/${title.id}`
                      if (navigator.share) void navigator.share({ title: title.name, url }).catch(() => undefined)
                      else void navigator.clipboard?.writeText(url)
                    }}
                    aria-label="Share title"
                    data-nav="true"
                  >
                    <Icon name="share" size={17} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="shell-x relative z-10 mt-8 space-y-9">
        {/* live: now & next */}
        {title.kind === 'live' ? (
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-stroke px-4 py-2.5">
              <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-ink-soft">Programme guide</h2>
              <span className="text-[10px] uppercase tracking-wider text-ink-mute">{title.epgChannelId || 'No EPG id'}</span>
            </div>
            {liveNow ? (
              <div className="border-b border-stroke px-4 py-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-live">
                  <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" /> On now
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold">{liveNow.title}</p>
                  <p className="tabular text-[11px] text-ink-soft">
                    {formatClock(liveNow.start)} – {formatClock(liveNow.end)}
                  </p>
                </div>
                <div className="mt-2 h-[3px] w-full bg-white/15">
                  <div className="h-full bg-crimson" style={{ width: `${programmeProgress(liveNow)}%` }} />
                </div>
                {liveNow.description ? <p className="mt-2 text-xs text-ink-soft">{liveNow.description}</p> : null}
              </div>
            ) : (
              <p className="px-4 py-4 text-xs text-ink-mute">Guide data is still loading for this channel.</p>
            )}
            {epg
              .filter((p) => p.start > Date.now())
              .slice(0, 4)
              .map((p) => (
                <div key={p.start} className="flex items-center gap-3 border-b border-stroke/60 px-4 py-2 text-xs last:border-0">
                  <span className="tabular w-12 shrink-0 text-ink-mute">{formatClock(p.start)}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="tabular shrink-0 text-[10px] text-ink-mute">{formatClock(p.end)}</span>
                </div>
              ))}
            {liveNext ? null : <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-ink-mute">Next: guide pending</div>}
          </section>
        ) : null}

        {/* editions */}
        <section>
          <h2 className="mb-2 text-[11px] font-extrabold uppercase tracking-widest text-ink-soft">Available versions</h2>
          <div className="flex flex-wrap gap-1.5">
            {uniqueEditions.map((e) => (
              <button
                key={e.streamId}
                onClick={() => setEditionId(e.streamId)}
                data-nav="true"
                className={`flex items-center gap-2 rounded-[3px] border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeEdition.streamId === e.streamId
                    ? 'border-white/60 bg-white/10 text-white'
                    : 'border-stroke bg-layer-1 text-ink-soft hover:border-white/30'
                }`}
              >
                <span className={e.quality === '4K' ? 'text-gold' : 'text-ink-soft'}>{QUALITY_LABELS[e.quality]}</span>
                {e.languages.filter((l) => l !== 'und').length ? (
                  <span className="text-ink-mute">
                    {e.languages.filter((l) => l !== 'und').map((l) => l.toUpperCase()).join('/')}
                  </span>
                ) : null}
                {activeEdition.streamId === e.streamId ? <Icon name="check" size={12} className="text-crimson" /> : null}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Container" value={(activeEdition.container || 'm3u8').toUpperCase()} />
            <Meta label="Stream ID" value={String(activeEdition.streamId)} />
            <Meta label="Added" value={activeEdition.addedAt ? relativeTime(activeEdition.addedAt * 1000) : '—'} />
            <Meta label="Source" value={title.provider === 'other' ? 'Vntera' : title.provider} />
          </div>
        </section>

        {/* series episodes */}
        {title.kind === 'series' ? (
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title">Episodes</h2>
              <div className="flex items-center gap-2">
                <Select
                  label="Season"
                  value={String(season)}
                  onChange={(value) => setSeason(Number(value))}
                  align="right"
                  compact
                  className="min-w-[9.5rem]"
                  options={seasons.map((s) => ({
                    value: String(s.number),
                    label: `Season ${s.number}`,
                    meta: `${s.episodes.length} ep`,
                  }))}
                />
              </div>
            </div>

            {seriesLoading && !seasons.length ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-24 w-full" />
                ))}
              </div>
            ) : seasons.length ? (
              <div className="overflow-hidden rounded-lg border border-stroke">
                {(currentSeason?.episodes ?? []).map((ep) => {
                  const epNum = Number(ep.episode_num)
                  const isCurrent = seriesProgress?.season === season && seriesProgress?.episode === epNum
                  const isWatched = !!watched[`${title.id}:${season}:${epNum}`]
                  const expanded = expandedEpisode === epNum
                  return (
                    <div key={String(ep.id)} className="border-b border-stroke last:border-0">
                      <div className="flex items-stretch gap-3 bg-layer-1 p-2.5 transition-colors hover:bg-layer-2">
                        <button
                          onClick={() => play({ season, episode: epNum })}
                          className="relative w-[7.5rem] shrink-0 overflow-hidden rounded-[3px] bg-layer-2 sm:w-[9.5rem]"
                          aria-label={`Play episode ${epNum}`}
                          data-nav="true"
                        >
                          <Art
                            src={ep.info?.movie_image}
                            title={`${title.name} S${season}E${epNum}`}
                            kind="backdrop"
                            seed={`${title.id}-${season}-${epNum}`}
                            className="aspect-video h-full w-full object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity hover:opacity-100">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black">
                              <Icon name="play" size={14} />
                            </span>
                          </span>
                          <span className="absolute bottom-1 right-1 rounded-[2px] bg-black/75 px-1 py-0.5 text-[9px] font-bold tabular">
                            {ep.info?.duration || formatTimecode(ep.info?.duration_secs ?? 0)}
                          </span>
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              onClick={() => setExpandedEpisode(expanded ? null : epNum)}
                              className="min-w-0 text-left"
                              data-nav="true"
                            >
                              <div className="flex items-center gap-2">
                                <span className="tabular text-[11px] font-bold text-ink-mute">{epNum}</span>
                                <p className="truncate text-[13px] font-semibold">{ep.title}</p>
                              </div>
                              {ep.info?.plot ? (
                                <p className={`mt-0.5 text-[11px] text-ink-soft ${expanded ? '' : 'line-clamp-1'}`}>
                                  {ep.info.plot}
                                </p>
                              ) : null}
                            </button>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              {isCurrent ? (
                                <span className="badge border-crimson/60 text-crimson">WATCHING</span>
                              ) : isWatched ? (
                                <span className="badge border-live/50 text-live">WATCHED</span>
                              ) : null}
                              <DownloadButton
                                compact
                                target={{
                                  titleId: title.id,
                                  kind: 'series',
                                  streamId: Number(ep.id),
                                  title: title.name,
                                  subtitle: `S${season} E${epNum}${ep.title ? ` · ${ep.title}` : ''}`,
                                  poster: ep.info?.movie_image || title.poster,
                                  season,
                                  episode: epNum,
                                  url: streamUrl('series', Number(ep.id), { container: ep.container_extension }),
                                  mime: `video/${ep.container_extension || 'mp4'}`,
                                }}
                              />
                              <button
                                className="icon-btn !h-8 !w-8"
                                onClick={() => play({ season, episode: epNum })}
                                aria-label={`Play episode ${epNum}`}
                                data-nav="true"
                              >
                                <Icon name="play" size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon="film"
                title="Episodes unavailable"
                body={seriesError || 'Vntera did not return the episode tree for this series.'}
              />
            )}
          </section>
        ) : null}

        {/* about */}
        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            {plot || castList || director || country ? (
              <>
                <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-ink-soft">Synopsis &amp; cast</h2>
                {plot ? <p className="mt-2 text-sm leading-relaxed text-ink-soft">{plot}</p> : null}
              </>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {genreList.map((g) => (
                <Link
                  key={g}
                  to={`/${title.kind === 'series' ? 'series' : 'movies'}?genre=${encodeURIComponent(g.trim())}`}
                  className="rounded-full border border-stroke bg-layer-1 px-2.5 py-1 text-[11px] text-ink-soft hover:border-white/30 hover:text-white"
                  data-nav="true"
                >
                  {g.trim()}
                </Link>
              ))}
            </div>
            <div className="mt-4 space-y-1.5 text-[12px]">
              {castList ? (
                <p className="text-ink-mute">
                  <span className="font-semibold text-ink-soft">Cast · </span>
                  {castList}
                </p>
              ) : null}
              {director ? (
                <p className="text-ink-mute">
                  <span className="font-semibold text-ink-soft">Director · </span>
                  {director}
                </p>
              ) : null}
              {country ? (
                <p className="text-ink-mute">
                  <span className="font-semibold text-ink-soft">Country · </span>
                  {country}
                </p>
              ) : null}
              {vodInfo?.info?.bitrate ? (
                <p className="text-ink-mute">
                  <span className="font-semibold text-ink-soft">Bitrate · </span>
                  {Math.round(vodInfo.info.bitrate / 1000)} kbps
                </p>
              ) : null}
            </div>
          </div>

          <div className="panel p-4">
            <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">Technical</h3>
            <dl className="mt-3 space-y-2 text-[12px]">
              <Row k="Best quality" v={QUALITY_LABELS[title.quality]} />
              <Row k="Editions" v={String(uniqueEditions.length)} />
              {languageLabel ? <Row k="Languages" v={languageLabel} /> : null}
              <Row k="Category" v={title.categoryName} />
              <Row k="Catalog id" v={String(title.id)} />
              <Row k="Playback" v={title.kind === 'series' ? 'Episode stream' : title.kind === 'live' ? 'Live HLS' : 'VOD stream'} />
            </dl>
          </div>
        </section>

        {similar.length ? (
          <PosterRail title="More like this" titles={similar} action={<Link to="/search" className="text-[10px] font-bold uppercase tracking-widest text-ink-mute hover:text-white">Explore</Link>} />
        ) : null}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[4px] border border-stroke bg-layer-1 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-ink-mute">{label}</p>
      <p className="truncate text-[12px] font-semibold capitalize">{value}</p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-mute">{k}</dt>
      <dd className="truncate text-right font-semibold text-ink-soft">{v}</dd>
    </div>
  )
}
