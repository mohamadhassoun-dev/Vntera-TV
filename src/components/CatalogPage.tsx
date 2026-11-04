import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PosterCard } from './cards'
import { EmptyState } from './Feedback'
import { Icon } from './Icons'
import { SectionHeading } from './Badges'
import { useCatalog } from '../store/catalog'
import { matchesQuality } from '../lib/normalize'
import type { Title } from '../types'

type Kind = 'movie' | 'series'
type SortKey = 'added' | 'name' | 'year' | 'rating'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'added', label: 'Recently added' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'year', label: 'Newest year' },
  { key: 'rating', label: 'Highest rated' },
]

const PAGE = 42

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="relative flex shrink-0 items-center gap-1.5 rounded-[3px] border border-stroke bg-layer-1 pl-2.5 pr-1 text-[11px] text-ink-soft">
      <span className="font-bold uppercase tracking-wider text-ink-mute">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[9.5rem] cursor-pointer appearance-none bg-transparent py-2 pr-5 text-[12px] font-semibold text-white"
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-layer-2 text-white">
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute right-1.5 text-ink-mute" />
    </label>
  )
}

export function CatalogPage({ kind }: { kind: Kind }) {
  const snapshot = useCatalog((s) => s.snapshot)
  const status = useCatalog((s) => s.status)
  const [params] = useSearchParams()
  const urlGenre = params.get('genre')
  const [genre, setGenre] = useState(urlGenre || 'all')
  const [year, setYear] = useState('all')
  const [quality, setQuality] = useState('all')
  const [language, setLanguage] = useState('all')
  const [sort, setSort] = useState<SortKey>('added')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)

  const pool = useMemo<Title[]>(() => (snapshot ? (kind === 'movie' ? snapshot.movies : snapshot.series) : []), [snapshot, kind])

  useEffect(() => {
    if (urlGenre) setGenre(urlGenre)
  }, [urlGenre])

  const genres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of pool) for (const g of t.genres) if (g) counts.set(g, (counts.get(g) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([g]) => g)
  }, [pool])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const t of pool) if (t.year) set.add(t.year)
    return [...set].sort((a, b) => b - a).slice(0, 24)
  }, [pool])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = pool.filter((t) => {
      if (genre !== 'all' && !t.genres.some((g) => g.toLowerCase() === genre.toLowerCase())) return false
      if (year !== 'all' && String(t.year) !== year) return false
      if (!matchesQuality(t, quality)) return false
      if (language !== 'all' && !t.languages.includes(language)) return false
      if (q && !t.name.toLowerCase().includes(q)) return false
      return true
    })
    list.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'year':
          return (b.year ?? 0) - (a.year ?? 0)
        case 'rating':
          return (b.rating ?? 0) - (a.rating ?? 0)
        default:
          return b.addedAt - a.addedAt
      }
    })
    return list
  }, [pool, genre, year, quality, language, sort, query])

  useEffect(() => {
    setLimit(PAGE)
  }, [genre, year, quality, language, sort, query, kind])

  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((v) => (v < filtered.length ? v + PAGE : v))
    })
    io.observe(node)
    return () => io.disconnect()
  }, [filtered.length])

  const label = kind === 'movie' ? 'Movies' : 'TV Shows'
  const shown = filtered.slice(0, limit)

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="border-b border-stroke bg-gradient-to-b from-layer-2/70 to-canvas">
        <div className="shell-x py-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-crimson">
                {kind === 'movie' ? 'Cinema library' : 'Episodic library'}
              </p>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight md:text-3xl">{label}</h1>
              <p className="mt-1 text-sm text-ink-soft">Browse the full library, one best edition per title.</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
                className="field !py-2.5"
                aria-label={`Search ${label}`}
              />
            </div>
          </div>

          <div className="no-scrollbar mt-5 flex items-center gap-1.5 overflow-x-auto pb-1">
            <FilterSelect
              label="Genre"
              value={genre}
              onChange={setGenre}
              options={[{ value: 'all', label: 'All genres' }, ...genres.map((g) => ({ value: g, label: g }))]}
            />
            <FilterSelect
              label="Year"
              value={year}
              onChange={setYear}
              options={[{ value: 'all', label: 'Any year' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
            />
            <FilterSelect
              label="Quality"
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'all', label: 'Any quality' },
                { value: '4K', label: '4K UHD' },
                { value: 'FHD', label: 'Full HD' },
                { value: 'HD', label: 'HD' },
              ]}
            />
            <FilterSelect
              label="Language"
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'all', label: 'Any language' },
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'Arabic' },
                { value: 'fr', label: 'French' },
                { value: 'tr', label: 'Turkish' },
              ]}
            />
            <FilterSelect
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            />
            {(genre !== 'all' || year !== 'all' || quality !== 'all' || language !== 'all' || query) && (
              <button
                className="tab !text-crimson"
                onClick={() => {
                  setGenre('all')
                  setYear('all')
                  setQuality('all')
                  setLanguage('all')
                  setQuery('')
                }}
                data-nav="true"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="shell-x pt-6">
        <SectionHeading title={query ? `Results for “${query}”` : 'Browse all'} />

        {status === 'loading' && !pool.length ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[2/3] w-full" />
            ))}
          </div>
        ) : shown.length ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
              {shown.map((t, i) => (
                <PosterCard
                  key={`${t.kind}-${t.id}`}
                  title={t}
                  priority={i < 8}
                  badge={
                    kind === 'series' && t.seasons ? (
                      <span className="badge border-white/20 text-white/80">{t.seasons} S</span>
                    ) : t.quality === '4K' ? (
                      <span className="badge badge-4k">4K</span>
                    ) : undefined
                  }
                />
              ))}
            </div>
            <div ref={sentinel} className="h-12" />
            {limit < filtered.length ? null : (
              <p className="pb-4 text-center text-[11px] uppercase tracking-wider text-ink-mute">
                You&apos;re all caught up
              </p>
            )}
          </>
        ) : (
          <EmptyState
            icon="film"
            title={`No ${label.toLowerCase()} match these filters`}
            body="Try widening the year or quality filter."
            action={
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setGenre('all')
                  setYear('all')
                  setQuality('all')
                  setLanguage('all')
                  setQuery('')
                }}
              >
                Clear filters
              </button>
            }
          />
        )}
      </div>
    </div>
  )
}
