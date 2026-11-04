import { useMemo, useState } from 'react'
import { PosterCard, ContinueCard } from '../components/cards'
import { Icon } from '../components/Icons'
import { EmptyState } from '../components/Feedback'
import { useCatalog, popular, recentlyAdded, trending } from '../store/catalog'
import { useLibrary } from '../store/library'
import type { ProgressEntry } from '../types'

type Tab = 'new' | 'popular' | 'trending'

const TABS: Array<{ key: Tab; label: string; icon: 'sparkles' | 'flame' | 'layers'; blurb: string }> = [
  { key: 'new', label: 'New', icon: 'sparkles', blurb: 'Added in the last 7 days' },
  { key: 'popular', label: 'Popular', icon: 'flame', blurb: 'Most watched on this profile' },
  { key: 'trending', label: 'Trending', icon: 'layers', blurb: 'Rising titles this week' },
]

export default function NewPopularPage() {
  const snapshot = useCatalog((s) => s.snapshot)
  const progress = useLibrary((s) => s.progress)
  const [tab, setTab] = useState<Tab>('new')

  const titles = useMemo(() => {
    if (tab === 'new') return recentlyAdded(snapshot, 7, 90)
    if (tab === 'popular') return popular(snapshot, 90)
    return trending(snapshot, 90)
  }, [snapshot, tab])

  const inProgress = useMemo<ProgressEntry[]>(
    () =>
      Object.values(progress)
        .filter((p) => p.progress > 20)
        .sort((a, b) => b.lastWatched - a.lastWatched)
        .slice(0, 6),
    [progress],
  )

  const active = TABS.find((t) => t.key === tab)!

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="border-b border-stroke bg-gradient-to-b from-layer-2/70 to-canvas">
        <div className="shell-x py-7">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-crimson">Discovery</p>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight md:text-3xl">New & Popular</h1>
          <div className="mt-4 flex gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                role="tab"
                aria-selected={tab === t.key}
                data-nav="true"
                className={`flex items-center gap-1.5 rounded-[3px] border px-3.5 py-2 text-[12px] font-bold transition-colors ${
                  tab === t.key
                    ? 'border-white/20 bg-layer-4 text-white'
                    : 'border-transparent bg-layer-1 text-ink-soft hover:text-white'
                }`}
              >
                <Icon name={t.icon} size={14} className={tab === t.key ? 'text-crimson' : ''} />
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-xs text-ink-mute">{active.blurb}</p>
        </div>
      </div>

      <div className="shell-x pt-6">
        {!titles.length ? (
          <EmptyState icon="sparkles" title="Nothing here yet" body="New titles appear as the provider updates the panel." />
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
            {titles.map((t, i) => (
              <PosterCard
                key={`${t.kind}-${t.id}`}
                title={t}
                priority={i < 8}
                badge={
                  tab === 'popular' && t.watchCount ? (
                    <span className="badge border-crimson/60 text-crimson">{t.watchCount} plays</span>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}

        {inProgress.length ? (
          <section className="mt-10">
            <h2 className="section-title mb-3">Pick up where you left off</h2>
            <div className="rail no-scrollbar">
              {inProgress.map((e) => (
                <ContinueCard key={`${e.contentType}:${e.contentId}`} entry={e} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
