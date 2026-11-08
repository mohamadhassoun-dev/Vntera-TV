import { createContext, memo, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProgressEntry, Provider, Title } from '../types'
import { Art, useInView } from './Art'
import { LiveBadge, ProgressBar, ProviderChip, QualityBadge, RatingBadge } from './Badges'
import { Icon } from './Icons'
import { nameWithoutYear, pct, relativeTime } from '../lib/format'
import { channelArtSrc } from '../lib/normalize'
import { musicChannelLabel } from '../lib/musicChannels'
import { nowPlaying, nextUp, programmeProgress, formatClock } from '../lib/epg'
import { useEpg } from '../store/epg'
import { useLibrary } from '../store/library'

const EMPTY_PROGRAMMES: never[] = []

/** Home hides release years and date suffixes without touching other pages. */
export const HideDatesContext = createContext(false)
/** Home shows artwork alone, Netflix-style, so captions are dropped there. */
export const HideCaptionsContext = createContext(false)
const stripYear = (name: string) =>
  name
    .replace(/\s*\((?:19|20)\d{2}\)/g, '')
    .replace(/\s*[-–]\s*(?:19\d{2}|20[0-2]\d)\s*$/, '')
    .replace(/\s+(?:19\d{2}|20[0-2]\d)(?:[.\-/]\d{1,2}){0,2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || name

export function detailsHref(t: Title): string {
  return `/title/${t.kind}/${t.id}`
}

export function watchHref(t: Title, extra?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(extra || {})) if (v !== undefined) params.set(k, String(v))
  const qs = params.toString()
  return `/watch/${t.kind}/${t.id}${qs ? `?${qs}` : ''}`
}

// ------------------------------- poster ------------------------------------

export const PosterCard = memo(function PosterCard({
  title,
  progress,
  badge,
  priority,
  onArtFail,
}: {
  title: Title
  progress?: ProgressEntry
  badge?: React.ReactNode
  priority?: boolean
  /** Lets a rail swap a broken poster for the next title in its line-up. */
  onArtFail?: () => void
}) {
  const inList = useLibrary((s) => s.isInList(title.kind === 'live' ? 'live' : title.kind, title.id))
  const hideDates = useContext(HideDatesContext)
  // Artwork that cannot load removes the card instead of showing a placeholder.
  const [artFailed, setArtFailed] = useState(false)
  if (artFailed) return null
  return (
    <Link
      to={detailsHref(title)}
      data-nav="true"
      className="poster-card group relative block focus-visible:outline-none"
      aria-label={`${title.name}${title.year ? `, ${title.year}` : ''}`}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-layer-2">
        <Art
          src={title.poster}
          title={title.name}
          seed={`${title.id}-${title.name}`}
          priority={priority}
          onFail={() => {
            setArtFailed(true)
            onArtFail?.()
          }}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-80" />

        <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
          {title.blockbuster && !badge ? <span className="badge border-crimson/70 text-crimson">TOP 10</span> : null}
          {badge}
          <ProviderChip title={title} />
        </div>

        <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          <QualityBadge quality={title.quality} />
          {inList ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-[2px] bg-black/65 text-white" title="In My List">
              <Icon name="check" size={12} />
            </span>
          ) : null}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
            {!hideDates && title.year ? <span className="tabular">{title.year}</span> : null}
            <RatingBadge rating={title.rating} />
            {title.kind === 'series' && title.seasons ? <span className="tabular">{title.seasons} SEASONS</span> : null}
          </div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-crimson/95 text-white shadow-[0_0_24px_rgba(229,9,20,0.6)]">
            <Icon name="play" size={20} />
          </span>
        </div>
      </div>
      {progress ? <ProgressBar value={pct(progress.progress, progress.duration)} /> : null}
    </Link>
  )
})

interface LogoArt {
  label: string
  tint: string
  /** Artwork shown as the tile background. */
  art?: string
  /** Animated artwork; overrides `art` and loops silently. */
  video?: string
  /** First frame, so a looping tile never starts on black. */
  poster?: string
  /** Tiny copy of `video` for the 90px story circles (a full-size clip per tile
   *  makes the whole row stutter on phones). */
  storyVideo?: string
}

const PROVIDER_LOGOS: Record<string, LogoArt> = {
  netflix: { label: 'Netflix', art: '/logos/netflix.jpg', tint: '#e50914' },
  prime: { label: 'Prime Video', art: '/logos/prime.jpg', tint: '#00a8e1' },
  shahid: { label: 'Shahid', art: '/logos/shahid.jpg', tint: '#00c8c8' },
  disney: { label: 'Disney+', art: '/logos/disney.webp', tint: '#4f7cff' },
  imdb: { label: 'IMDb', art: '/logos/imdb.jpg', tint: '#f5c518' },
  wwe: { label: 'WWE', art: '/logos/wwe.webp', tint: '#d7182a' },
  kids: { label: 'Kids', art: '/logos/kids.jpg', tint: '#2bb3c0' },
  anime: { label: 'Anime', art: '/logos/anime-poster.webp', tint: '#ff4d6d' },
  music: {
    label: 'Music',
    video: '/logos/music.mp4',
    poster: '/logos/music-poster.jpg',
    storyVideo: '/logos/music-story.mp4',
    tint: '#8b5cf6',
  },
}

/** Rows that open a curated page instead of a search. */
const COLLECTION_LOGOS = new Set(['kids', 'anime'])
/** Rows whose logo opens a whole tab rather than a filtered list. */
const LOGO_TABS: Record<string, string> = { music: '/live' }

/** Animated logo tile: plays whenever it is on screen, sleeps when it is not. */
function LogoVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const { ref, inView } = useInView<HTMLVideoElement>({ once: false })

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (!inView) {
      // Settle first: scrolling past the row should not stop it mid-frame.
      const timer = window.setTimeout(() => video.pause(), 800)
      return () => window.clearTimeout(timer)
    }
    // Browsers sometimes park an autoplay video right after it starts; retry
    // while the tile is on screen so the logo keeps moving.
    let cancelled = false
    const tryPlay = () => {
      if (!cancelled && video.isConnected) void video.play().catch(() => undefined)
    }
    const onPause = () => window.setTimeout(tryPlay, 400)
    tryPlay()
    video.addEventListener('pause', onPause)
    return () => {
      cancelled = true
      video.removeEventListener('pause', onPause)
    }
  }, [inView, ref])

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      disablePictureInPicture
      aria-label={`${label} logo`}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

/** Studio wordmark used as the first card of each provider rail. */
export function ProviderLogoCard({ provider }: { provider: Provider | 'imdb' | 'kids' | 'anime' | 'music' }) {
  const logo = PROVIDER_LOGOS[provider] ?? { label: provider, tint: '#333333' }
  const isCollection = COLLECTION_LOGOS.has(provider)
  const to =
    LOGO_TABS[provider] ??
    (isCollection ? `/collection/${provider}` : `/search?q=${encodeURIComponent(logo.label)}`)
  return (
    <Link
      to={to}
      data-nav="true"
      className="poster-card group relative block focus-visible:outline-none"
      data-logo-card="true"
      aria-label={`Browse ${logo.label}`}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden"
        style={{ background: `radial-gradient(circle at 50% 38%, ${logo.tint}55, #0a0a0f 72%)` }}
      >
        {logo.video ? (
          <LogoVideo src={logo.video} poster={logo.poster} label={logo.label} />
        ) : logo.art ? (
          <img
            src={logo.art}
            alt={`${logo.label} logo`}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0) 45%)' }}
        />
      </div>
    </Link>
  )
}

export const NumberedCard = memo(function NumberedCard({ title, rank }: { title: Title; rank: number }) {
  const [artFailed, setArtFailed] = useState(false)
  if (artFailed) return null
  return (
    <Link
      to={detailsHref(title)}
      data-nav="true"
      className="numbered-card group relative flex shrink-0 items-end gap-1 focus-visible:outline-none"
      aria-label={`Top 10 number ${rank}: ${title.name}`}
    >
      <span
        className="numbered-rank select-none font-black leading-none tabular text-transparent"
        style={{ WebkitTextStroke: '2px rgba(255,255,255,0.4)' }}
      >
        {rank}
      </span>
      <div className="numbered-art relative aspect-[2/3] w-[6.2rem] overflow-hidden rounded-[4px] border border-stroke md:w-[7.4rem]">
        <Art src={title.poster} title={title.name} seed={`${title.id}`} onFail={() => setArtFailed(true)} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute right-1 top-1">
          <QualityBadge quality={title.quality} />
        </div>
      </div>
    </Link>
  )
})

// ---------------------------- continue watching -----------------------------

export function ContinueCard({ entry }: { entry: ProgressEntry }) {
  const hideDates = useContext(HideDatesContext)
  const hideCaptions = useContext(HideCaptionsContext)
  const resume = pct(entry.progress, entry.duration)
  // Movies open their details page first, where resume/start-over is offered.
  const href =
    entry.contentType === 'series'
      ? `/watch/series/${entry.parentId ?? entry.contentId}?season=${entry.season ?? 1}&episode=${entry.episode ?? 1}`
      : entry.contentType === 'live'
        ? `/watch/live/${entry.contentId}`
        : `/title/movie/${entry.contentId}`
  return (
    <Link
      to={href}
      data-nav="true"
      className="wide-card group relative block focus-visible:outline-none"
      aria-label={`${entry.title} details`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-layer-2">
        <Art src={entry.thumbnail} title={entry.title} kind="backdrop" seed={`${entry.contentId}`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-black">
            <Icon name="play" size={22} />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          {hideCaptions ? null : (
            <p className="truncate text-[13px] font-semibold">
              {hideDates ? stripYear(entry.title) : entry.title}
            </p>
          )}
          <p className="text-[11px] text-ink-soft">
            {entry.contentType === 'series'
              ? `S${entry.season ?? 1} E${entry.episode ?? 1} · ${Math.round(resume)}% watched`
              : `${Math.round(resume)}% watched`}
          </p>
        </div>
        <div className="absolute right-2 top-2">
          <QualityBadge quality="HD" />
        </div>
      </div>
      <ProgressBar value={resume} />
    </Link>
  )
}

// ------------------------------- channel -----------------------------------

export const ChannelCard = memo(function ChannelCard({
  channel,
  view = 'grid',
  hideMeta,
  compact,
  displayName,
}: {
  channel: Title
  view?: 'grid' | 'list'
  hideMeta?: boolean
  /** Shortcut cards keep only artwork, name, quality and LIVE. */
  compact?: boolean
  /** Requested shortcut label; playback still uses the original channel id. */
  displayName?: string
}) {
  const hideDates = useContext(HideDatesContext)
  const [artFailed, setArtFailed] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>()
  const programmes = useEpg((s) => s.cache[channel.epgChannelId || String(channel.id)]?.programmes ?? EMPTY_PROGRAMMES)
  const ensure = useEpg((s) => s.ensure)

  useEffect(() => {
    if (!inView) return
    void ensure({ channelId: channel.epgChannelId, streamId: channel.id, name: channel.name })
  }, [inView, channel.epgChannelId, channel.id, channel.name, ensure])

  const now = nowPlaying(programmes)
  const next = nextUp(programmes)

  if (artFailed) return null

  if (view === 'list') {
    return (
      <Link
        to={`/watch/live/${channel.id}`}
        data-nav="true"
        className="group flex items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 transition-colors hover:bg-layer-2 focus-visible:outline-none"
      >
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-[3px] bg-layer-2">
          <Art src={channelArtSrc(channel)} title={channel.name} kind="channel" seed={channel.name} onFail={() => setArtFailed(true)} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {compact ? null : (
              <span className="tabular text-[11px] font-bold text-ink-mute">{String(channel.num ?? channel.id).padStart(3, '0')}</span>
            )}
            <p className="truncate text-sm font-semibold">
              {displayName ?? (hideDates ? stripYear(channel.name) : channel.name)}
            </p>
            <QualityBadge quality={channel.quality} />
            <LiveBadge />
          </div>
          {compact ? null : (
            <>
              <p className="mt-0.5 truncate text-xs text-ink-soft">{now ? now.title : 'Guide loading…'}</p>
              <p className="truncate text-[11px] text-ink-mute">
                {next ? `Next · ${formatClock(next.start)} ${next.title}` : channel.categoryName}
              </p>
            </>
          )}
        </div>
        <span className="icon-btn shrink-0 !h-9 !w-9 !rounded-full text-white group-hover:bg-crimson group-hover:border-crimson">
          <Icon name="play" size={14} />
        </span>
      </Link>
    )
  }

  return (
    <div ref={ref}>
      <Link
        to={`/watch/live/${channel.id}`}
        data-nav="true"
        className="group block overflow-hidden rounded-[4px] border border-stroke bg-layer-1 transition-colors hover:border-white/30 focus-visible:outline-none"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-layer-2 to-canvas">
          <Art src={channelArtSrc(channel)} title={channel.name} kind="channel" seed={channel.name} onFail={() => setArtFailed(true)} className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-105" />
          <div className="absolute left-1.5 top-1.5 flex gap-1">
            <LiveBadge />
          </div>
          <div className="absolute right-1.5 top-1.5 flex gap-1">
            <QualityBadge quality={channel.quality} />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent px-2 pb-1.5 pt-6">
            {now ? (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-white">{now.title}</span>
                <span className="tabular shrink-0 text-[10px] text-ink-soft">{formatClock(now.start)}</span>
              </div>
            ) : null}
            {now ? (
              <div className="mt-1 h-[2px] w-full bg-white/20">
                <div className="h-full bg-crimson" style={{ width: `${programmeProgress(now)}%` }} />
              </div>
            ) : null}
          </div>
        </div>
        <div className="p-2">
          <p className="truncate text-[13px] font-semibold">
            {displayName ?? (hideDates ? stripYear(channel.name) : channel.name)}
          </p>
          {hideMeta || compact ? null : (
            <p className="truncate text-[11px] text-ink-mute">
              {channel.categoryName}
              {channel.tvArchive ? ' · 7d catch-up' : ''}
            </p>
          )}
        </div>
      </Link>
    </div>
  )
})

export function ChannelTile({ channel }: { channel: Title }) {
  return <ChannelCard channel={channel} view="list" />
}

/** The Instagram-style ring shared by the music lead and the artist tiles. */
function StoryRing({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <span className="relative flex h-[4.9rem] w-[4.9rem] items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#f9ce34,#ee2a7b,#6228d7,#f9ce34)] p-[2.5px] transition-transform duration-300 group-hover:scale-[1.04] group-focus-visible:scale-[1.04] md:h-[5.6rem] md:w-[5.6rem]">
      <span className="flex h-full w-full items-center justify-center rounded-full bg-canvas p-[2.5px]">
        <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-black">
          {children}
        </span>
      </span>
      {live ? (
        <span
          aria-hidden="true"
          className="absolute bottom-1 right-1 h-3 w-3 rounded-full border-2 border-canvas bg-live shadow-[0_0_6px_rgba(0,230,118,0.55)]"
        />
      ) : null}
    </span>
  )
}

const STORY_LABEL =
  'line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight text-ink-soft transition-colors group-hover:text-white'
const STORY_TILE = 'group flex w-[5.6rem] shrink-0 flex-col items-center gap-2 focus-visible:outline-none md:w-[6.4rem]'

/**
 * Plays the loop only while the tile is actually on screen. Fifty mounted
 * videos saturate the decoder, so off-screen tiles keep just the poster frame.
 */
function StoryVideo({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>({ once: false, rootMargin: '250px' })
  return (
    <span ref={ref} className="absolute inset-0 block">
      {inView ? (
        <LogoVideo src={src} poster={poster} label={label} />
      ) : poster ? (
        <img src={poster} alt="" aria-hidden="true" draggable={false} className="h-full w-full object-cover" />
      ) : null}
    </span>
  )
}

/** Instagram-story style music tile: every story plays the same music clip. */
export const ChannelStoryCard = memo(function ChannelStoryCard({ channel }: { channel: Title }) {
  const label = musicChannelLabel(channel.name)
  const logo = PROVIDER_LOGOS.music
  return (
    <Link
      to={`/watch/live/${channel.id}`}
      data-nav="true"
      aria-label={`${label}, live music`}
      className={STORY_TILE}
    >
      <StoryRing live>
        <StoryVideo src={logo.storyVideo!} poster={logo.poster} label={label} />
      </StoryRing>
      <span className={STORY_LABEL}>{label}</span>
    </Link>
  )
})

// -------------------------------- hero -------------------------------------

/** How long each featured movie stays on the billboard. */
/** The featured lineup turns over every ten minutes, as requested. */
export const HERO_SLIDE_MS = 10 * 60 * 1000

export function Hero({
  title,
  rank,
  synopsis,
  onPlay,
  inList,
  onToggleList,
  slideCount = 1,
  slideIndex = 0,
  onSlideChange,
}: {
  title: Title
  rank?: number
  synopsis?: string
  onPlay: () => void
  inList: boolean
  onToggleList: () => void
  slideCount?: number
  slideIndex?: number
  onSlideChange?: (index: number) => void
}) {
  // The hero always advances to the next featured movie on its own. The dot
  // progress bar is driven by the same duration, so they stay in step.
  useEffect(() => {
    if (slideCount <= 1 || !onSlideChange) return
    const timer = window.setInterval(() => onSlideChange((slideIndex + 1) % slideCount), HERO_SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [slideCount, slideIndex, onSlideChange])

  const artSrc = title.backdrop || title.poster

  return (
    <section className="relative w-full overflow-hidden">
      {/* One full-height, full-width artwork, sharp: the panel's portrait
          posters are cover-fitted across the whole hero. */}
      <div className="absolute inset-0 overflow-hidden">
        <Art
          src={artSrc}
          title={title.name}
          kind="backdrop"
          seed={`${title.id}-hero`}
          priority
          className="h-full w-full object-cover object-center"
        />
        {/* Light left-to-right scrim: the artwork stays visible across the whole
            hero while the copy keeps its contrast. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0.7) 38%, rgba(10,10,10,0.3) 68%, rgba(10,10,10,0.08) 100%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      <div className="relative z-10 flex min-h-[88svh] flex-col justify-end px-4 pb-24 pt-32 sm:min-h-[94svh] md:px-8 md:pb-28 lg:min-h-[100svh] xl:px-14">
        <div key={title.id} className="max-w-3xl animate-rise">
          {rank || title.vnteraOriginal ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {rank ? (
                <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-crimson px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
                  <Icon name="flame" size={12} /> TOP 10 #{rank} TODAY
                </span>
              ) : null}
              {title.vnteraOriginal ? (
                <span className="rounded-[2px] bg-white/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-crimson backdrop-blur">
                  Vntera Original
                </span>
              ) : null}
            </div>
          ) : null}

          <h1 className="text-[2rem] font-black uppercase leading-[0.94] tracking-[-0.03em] drop-shadow-2xl sm:text-[3rem] xl:text-[3.75rem]">
            {nameWithoutYear(title.name)}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-ink-soft">
            {title.ageRating ? <span className="rounded-[2px] bg-layer-3 px-1.5 py-0.5 text-[11px]">{title.ageRating}</span> : null}
            {title.durationSec ? <span>{Math.floor(title.durationSec / 3600)}h {Math.floor((title.durationSec % 3600) / 60)}m</span> : null}
            {title.seasons ? <span>{title.seasons} Seasons</span> : null}
            <QualityBadge quality={title.quality} size="md" />
            {title.kind === 'series' && title.latestEpisode ? <span className="text-ink-mute">{title.latestEpisode}</span> : null}
          </div>

          {synopsis || title.plot ? (
            <p className="mt-4 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft sm:text-base line-clamp-3">
              {synopsis || title.plot}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button onClick={onPlay} className="btn btn-primary !px-3.5 !py-2" data-nav="true">
              <Icon name="play" size={16} />
              <span className="text-[12.5px] font-bold">Play Now</span>
            </button>
            <Link to={detailsHref(title)} className="btn btn-secondary !px-3 !py-2" data-nav="true">
              <Icon name="info" size={15} />
              <span className="text-[12.5px] font-semibold">More Info</span>
            </Link>
            <button onClick={onToggleList} className="icon-btn !h-9 !w-9" data-nav="true" aria-label={inList ? 'Remove from My List' : 'Add to My List'}>
              {/* A heart says "save"; the plus sign read as "zoom in". */}
              <Icon name="heart" size={17} className={inList ? 'text-crimson' : undefined} />
            </button>
          </div>

          {slideCount > 1 ? (
            <div className="mt-7 flex items-center gap-1.5" aria-label="Featured movies">
              {Array.from({ length: slideCount }, (_, i) => (
                <button
                  key={i}
                  onClick={() => onSlideChange?.(i)}
                  data-nav="true"
                  aria-label={`Show featured movie ${i + 1}`}
                  aria-current={i === slideIndex ? 'true' : undefined}
                  className={`relative h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300 ease-out ${
                    i === slideIndex ? 'w-7 bg-white/25' : 'w-1.5 bg-white/35 hover:bg-white/70'
                  }`}
                >
                  {/* The dot fills over the slide's whole duration instead of
                      just jumping to the next one. */}
                  {i === slideIndex ? (
                    <span
                      key={slideIndex}
                      aria-hidden="true"
                      className="hero-dot-fill absolute inset-y-0 left-0 w-full rounded-full bg-crimson"
                      style={{ animationDuration: `${HERO_SLIDE_MS}ms` }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function RailEmpty({ label }: { label: string }) {
  return <p className="py-3 text-xs text-ink-mute">{label}</p>
}

export function LastWatchedLabel({ ts }: { ts: number }) {
  return <span className="text-[10px] text-ink-mute">{relativeTime(ts)}</span>
}
