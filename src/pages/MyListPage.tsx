import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PosterCard } from '../components/cards'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icons'
import { useCatalog } from '../store/catalog'
import { useLibrary } from '../store/library'
import type { Title } from '../types'

export default function MyListPage() {
  const navigate = useNavigate()
  const snapshot = useCatalog((s) => s.snapshot)
  const list = useLibrary((s) => s.list)
  const toggleList = useLibrary((s) => s.toggleList)
  const progress = useLibrary((s) => s.progress)
  const [filter, setFilter] = useState<'all' | 'movie' | 'series' | 'live'>('all')

  const titles = useMemo<Title[]>(() => {
    if (!snapshot) return []
    const pool = [...snapshot.movies, ...snapshot.series, ...snapshot.channels]
    return list
      .map((entry) => pool.find((t) => t.id === entry.contentId && t.kind === entry.contentType))
      .filter((t): t is Title => !!t)
      .filter((t) => filter === 'all' || t.kind === filter)
  }, [snapshot, list, filter])

  const resume = useMemo(() => Object.values(progress).filter((p) => p.progress > 20).sort((a, b) => b.lastWatched - a.lastWatched)[0], [progress])

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="border-b border-stroke bg-gradient-to-b from-layer-2/70 to-canvas">
        <div className="shell-x py-7">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-crimson">Your profile</p>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight md:text-3xl">My List</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {list.length} saved {list.length === 1 ? 'title' : 'titles'} · synced with this device profile
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(['all', 'movie', 'series', 'live'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-nav="true"
                className={`tab ${filter === f ? '!bg-layer-4 !text-white' : ''}`}
                aria-pressed={filter === f}
              >
                {f === 'all' ? 'Everything' : f === 'movie' ? 'Movies' : f === 'series' ? 'Series' : 'Channels'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shell-x pt-6">
        {resume ? (
          <button
            onClick={() => {
              navigate(
                resume.contentType === 'series'
                  ? `/watch/series/${resume.parentId ?? resume.contentId}?season=${resume.season ?? 1}&episode=${resume.episode ?? 1}`
                  : `/watch/${resume.contentType}/${resume.contentId}`,
              )
            }}
            className="mb-6 flex w-full items-center gap-3 rounded-lg border border-stroke bg-layer-1 p-3 text-left transition-colors hover:bg-layer-2"
            data-nav="true"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-crimson text-white">
              <Icon name="play" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-crimson">Continue watching</span>
              <span className="block truncate text-sm font-semibold">{resume.title}</span>
            </span>
            <Icon name="chevronRight" size={18} className="text-ink-mute" />
          </button>
        ) : null}

        {titles.length ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {titles.map((t) => (
              <div key={`${t.kind}-${t.id}`} className="group/item relative">
                <PosterCard title={t} />
                <button
                  onClick={() => toggleList(t)}
                  className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-[2px] bg-black/70 text-white opacity-0 transition-opacity hover:bg-crimson group-hover/item:opacity-100 focus:opacity-100"
                  aria-label={`Remove ${t.name} from My List`}
                  data-nav="true"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="heart"
            title={list.length ? 'Nothing in this filter' : 'Your list is empty'}
            body="Add movies, series and channels with the + button on any title."
            action={
              <button className="btn btn-primary" onClick={() => navigate('/movies')} data-nav="true">
                Browse movies
              </button>
            }
          />
        )}
      </div>
    </div>
  )
}
