import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChannelCard } from '../components/cards'
import { ChannelFamilyCard, ChannelFamilyDialog } from '../components/ChannelFamily'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icons'
import { SectionHeading } from '../components/Badges'
import { useCatalog, categoriesWithCounts } from '../store/catalog'
import { matchesQuality } from '../lib/normalize'
import { useDebounced } from '../lib/hooks'
import { groupChannelFamilies, type ChannelFamily } from '../lib/channelFamilies'
import type { Title } from '../types'
import type { Quality } from '../types'

const QUALITIES: Array<Quality | 'all'> = ['all', '4K', 'FHD', 'HD']
const PAGE = 48

export default function LivePage() {
  const snapshot = useCatalog((s) => s.snapshot)
  const status = useCatalog((s) => s.status)
  const error = useCatalog((s) => s.error)
  const phase = useCatalog((s) => s.phase)
  const load = useCatalog((s) => s.load)
  const [params, setParams] = useSearchParams()
  const paramCategory = params.get('category') ?? 'all'
  const [category, setCategory] = useState(paramCategory)
  const [query, setQuery] = useState('')
  const [quality, setQuality] = useState<Quality | 'all'>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [limit, setLimit] = useState(PAGE)
  const [openFamily, setOpenFamily] = useState<ChannelFamily | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const debounced = useDebounced(query, 300)

  useEffect(() => setCategory(paramCategory), [paramCategory])

  const selectCategory = (id: string) => {
    setCategory(id)
    const next = new URLSearchParams(params)
    if (id === 'all') next.delete('category')
    else next.set('category', id)
    setParams(next, { replace: true })
  }

  const categories = useMemo(() => categoriesWithCounts(snapshot, 'live'), [snapshot])

  const filtered = useMemo<Title[]>(() => {
    if (!snapshot) return []
    const q = debounced.trim().toLowerCase()
    return snapshot.channels.filter((c) => {
      if (category !== 'all' && c.categoryId !== category) return false
      if (!matchesQuality(c, quality)) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.categoryName.toLowerCase().includes(q)
    })
  }, [snapshot, category, quality, debounced])

  useEffect(() => setLimit(PAGE), [category, quality, debounced])

  // One card per brand: Al Jazeera, Al Jazeera 2, Al Jazeera World … collapse
  // into a single card that opens the feed picker.
  const families = useMemo(() => groupChannelFamilies(filtered), [filtered])
  const shown = families.slice(0, limit)

  // Infinite scroll: the next page loads as soon as the end of the grid appears.
  useEffect(() => {
    const node = sentinel.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((value) => (value < families.length ? value + PAGE : value))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [families.length])

  if (status === 'error' && !snapshot) {
    return (
      <div className="shell-x pb-24 pt-28">
        <EmptyState
          icon="alert"
          title="Could not load your channels"
          body={error ?? 'Vntera did not return a library. Check your session and try again.'}
          action={
            <button className="btn btn-primary" onClick={() => void load({ force: true })} data-nav="true">
              <Icon name="refresh" size={16} /> Retry sync
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="pb-24 pt-16 md:pt-20">
      {/* header */}
      <div className="relative overflow-hidden border-b border-stroke bg-gradient-to-b from-layer-2 via-layer-1 to-canvas">
        <div className="absolute inset-0 opacity-40">
          <div className="absolute -left-20 top-0 h-64 w-64 rounded-full bg-crimson/25 blur-[100px]" />
          <div className="absolute right-0 top-10 h-56 w-72 rounded-full bg-azure/15 blur-[100px]" />
        </div>
        <div className="shell-x relative py-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="badge badge-live h-[20px]">
                  <span className="dot" /> Live now
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Live TV</h1>
              <p className="mt-1 text-sm text-ink-soft">
                {snapshot ? 'Live channels' : phase || 'Loading channels'} · EPG enabled
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-[4px] border border-stroke">
                <button
                  className={`flex h-9 w-9 items-center justify-center ${view === 'grid' ? 'bg-layer-4 text-white' : 'bg-layer-1 text-ink-mute'}`}
                  onClick={() => setView('grid')}
                  data-nav="true"
                  aria-label="Grid view"
                >
                  <Icon name="grid" size={16} />
                </button>
                <button
                  className={`flex h-9 w-9 items-center justify-center ${view === 'list' ? 'bg-layer-4 text-white' : 'bg-layer-1 text-ink-mute'}`}
                  onClick={() => setView('list')}
                  data-nav="true"
                  aria-label="List view"
                >
                  <Icon name="list" size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="field !py-2.5"
                placeholder="Search channels, categories or numbers"
                aria-label="Search channels"
              />
              {query ? (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-mute hover:text-white"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`tab ${quality === q ? '!bg-layer-4 !text-white' : ''}`}
                  aria-pressed={quality === q}
                  data-nav="true"
                >
                  {q === 'all' ? 'Any quality' : q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="shell-x pt-5">
        <div className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto pb-1">
          {categories.slice(0, 26).map((c) => (
            <button
              key={c.id}
              onClick={() => selectCategory(c.id)}
              data-nav="true"
              aria-pressed={category === c.id}
              className={`shrink-0 rounded-[3px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                category === c.id
                  ? 'border-crimson bg-crimson text-white'
                  : 'border-stroke bg-layer-1 text-ink-soft hover:border-white/30 hover:text-white'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <SectionHeading
          title={category === 'all' ? 'All channels' : categories.find((c) => c.id === category)?.name ?? 'Channels'}
        />

        {status === 'loading' && !snapshot ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i}>
                <div className="skeleton aspect-video w-full" />
                <div className="skeleton mt-2 h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : !shown.length ? (
          <EmptyState
            icon="search"
            title="No channels match"
            body="Try a different category or clear the quality filter."
            action={
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery('')
                  selectCategory('all')
                  setQuality('all')
                }}
              >
                Reset filters
              </button>
            }
          />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {shown.map((family) =>
              family.members.length > 1 ? (
                <ChannelFamilyCard key={family.key} family={family} onOpen={setOpenFamily} />
              ) : (
                <ChannelCard key={family.key} channel={family.primary} />
              ),
            )}
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((family) =>
              family.members.length > 1 ? (
                <ChannelFamilyCard key={family.key} family={family} view="list" onOpen={setOpenFamily} />
              ) : (
                <ChannelCard key={family.key} channel={family.primary} view="list" />
              ),
            )}
          </div>
        )}

        {openFamily ? <ChannelFamilyDialog family={openFamily} onClose={() => setOpenFamily(null)} /> : null}

        {limit < families.length ? <div ref={sentinel} className="h-16" aria-hidden="true" /> : null}
      </div>
    </div>
  )
}
