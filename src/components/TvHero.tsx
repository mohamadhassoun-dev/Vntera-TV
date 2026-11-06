import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Title } from '../types'
import { Art } from './Art'
import { RatingBadge } from './Badges'
import { HERO_SLIDE_MS, PosterCard, detailsHref } from './cards'
import { Icon } from './Icons'
import { formatRuntime, nameWithoutYear } from '../lib/format'

/** Wall clock for the top right of the hero, like a set-top box would show. */
function TvClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="text-right">
      <p className="tabular text-[0.86rem] font-bold leading-tight text-white">
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="mt-0.5 text-[0.5rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
        {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}

/**
 * Ten-foot home hero: the featured title sits on its artwork on the left, with
 * a shortlist of what to watch next on the right. The actions are the same
 * three the desktop hero offers — Play Now, More Info, My List — only laid out
 * for a remote.
 */
export function TvHero({
  title,
  picks,
  onPlay,
  inList,
  onToggleList,
  slideCount = 1,
  slideIndex = 0,
  onSlideChange,
}: {
  title: Title
  picks: Title[]
  onPlay: () => void
  inList: boolean
  onToggleList: () => void
  slideCount?: number
  slideIndex?: number
  onSlideChange?: (index: number) => void
}) {
  // Same auto-advance as the desktop hero, so both surfaces rotate together.
  useEffect(() => {
    if (slideCount <= 1 || !onSlideChange) return
    const timer = window.setInterval(() => onSlideChange((slideIndex + 1) % slideCount), HERO_SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [slideCount, slideIndex, onSlideChange])

  const runtime = formatRuntime(title.durationSec)
  const genre = title.genres?.[0]

  return (
    <section className="tv-hero">
      <div className="relative min-h-[34rem] overflow-hidden rounded-[10px] border border-stroke">
        <Art
          src={title.backdrop || title.poster}
          title={title.name}
          kind="backdrop"
          seed={`${title.id}-tv-hero`}
          priority
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(8,8,8,0.96) 0%, rgba(8,8,8,0.78) 40%, rgba(8,8,8,0.34) 78%, rgba(8,8,8,0.12) 100%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas via-canvas/55 to-transparent" />

        <div className="relative flex h-full flex-col p-9">
          {/* The signed-in profile stays out of the artwork; only the clock sits here. */}
          <div className="flex items-start justify-end gap-6">
            <TvClock />
          </div>

          <div key={title.id} className="mt-auto max-w-[44rem] pb-2 pt-12">
            {title.vnteraOriginal ? (
              <span className="mb-2 inline-block rounded-[2px] bg-white/10 px-2 py-1 text-[0.48rem] font-extrabold uppercase tracking-[0.14em] text-crimson backdrop-blur">
                Vntera Original
              </span>
            ) : null}

            <h1 className="text-[2.25rem] font-black uppercase leading-[0.95] tracking-[-0.03em] text-white drop-shadow-2xl">
              {nameWithoutYear(title.name)}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] font-semibold text-ink-soft">
              <span>{title.kind === 'series' ? 'Series' : 'Movie'}</span>
              {title.year ? <span>· {title.year}</span> : null}
              {runtime ? <span>· {runtime}</span> : null}
              {genre ? <span className="truncate">· {genre}</span> : null}
              {title.ageRating ? (
                <span className="rounded-[2px] border border-stroke px-1.5 py-0.5 text-[0.5rem]">{title.ageRating}</span>
              ) : null}
              {title.rating ? (
                <span className="flex items-center gap-1">
                  · <RatingBadge rating={title.rating} />
                </span>
              ) : null}
            </div>

            {title.plot ? (
              <p className="mt-3.5 max-w-[38rem] text-[0.75rem] leading-relaxed text-ink-soft line-clamp-4">{title.plot}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button onClick={onPlay} className="btn btn-primary !px-6 !py-3" data-nav="true">
                <Icon name="play" size={18} />
                <span className="text-[0.72rem] font-bold">Play Now</span>
              </button>
              <Link to={detailsHref(title)} className="btn btn-secondary !px-6 !py-3" data-nav="true">
                <Icon name="info" size={17} />
                <span className="text-[0.72rem] font-bold">More Info</span>
              </Link>
              <button
                onClick={onToggleList}
                className="icon-btn !h-10 !w-10"
                data-nav="true"
                aria-label={inList ? 'Remove from My List' : 'Add to My List'}
              >
                <Icon name={inList ? 'check' : 'plus'} size={18} />
              </button>
            </div>

            {slideCount > 1 ? (
              <div className="mt-6 flex items-center gap-1.5" aria-label="Featured movies">
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
      </div>

      {picks.length ? (
        <aside className="tv-hero-side">
          <h2 className="text-[0.8rem] font-bold text-white">You might also like this</h2>
          <div className="tv-hero-picks">
            {picks.slice(0, 6).map((pick) => (
              <PosterCard key={`${pick.key}-${pick.id}`} title={pick} />
            ))}
          </div>
        </aside>
      ) : null}
    </section>
  )
}
