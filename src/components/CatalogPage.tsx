import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PosterCard } from './cards'
import { EmptyState } from './Feedback'
import { Icon } from './Icons'
import { SectionHeading } from './Badges'
import { useCatalog } from '../store/catalog'
import { matchesQuality } from '../lib/normalize'
import { matchesGenre } from '../lib/horror'
import { BANDS, matchesBandGenre } from '../lib/genreBands'
import { Select } from './Select'
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

/** Genres the app curates itself, so they are always offered. */
const CANONICAL_GENRES = ['Action', 'Drama', 'Horror'] as const
const BAND_LIST = Object.values(BANDS)

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

  // Every facet in the header comes out of one pass over the library. Three
  // separate loops (each allocating a Set per title) over 46k movies was most of
  // the Movies page's first paint.
  const facets = useMemo(() => {
    const counts = new Map<string, number>()
    const seenLabels: string[] = []
    const yearSet = new Set<number>()
    const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1)
    for (const t of pool) {
      seenLabels.length = 0
      for (const g of t.genres) {
        const label = g.trim()
        if (!label) continue
        const key = label.toLowerCase()
        if (seenLabels.includes(key)) continue
        seenLabels.push(key)
        bump(label)
      }
      for (const band of BAND_LIST) {
        const key = band.genre.toLowerCase()
        if (seenLabels.includes(key)) continue
        if (matchesBandGenre(t, band.genre)) {
          seenLabels.push(key)
          bump(band.genre)
        }
      }
      if (t.year) yearSet.add(t.year)
    }
    for (const name of CANONICAL_GENRES) {
      if (![...counts.keys()].some((key) => key.toLowerCase() === name.toLowerCase())) counts.set(name, 0)
    }
    return { counts, years: [...yearSet].sort((a, b) => b - a) }
  }, [pool])

  // Genre options carry a count, and always offer the one the page was opened
  // with so a genre link never lands on an unselectable filter.
  const genres = useMemo(() => {
    const list = [...facets.counts.entries()]
      .filter(([name, count]) => count > 0 || name.toLowerCase() === genre.toLowerCase())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name)
    const requested = genre !== 'all' && !list.some((g) => g.toLowerCase() === genre.toLowerCase())
    return requested ? [genre, ...list] : list
  }, [facets, genre])

  const genreCounts = facets.counts
  const years = facets.years

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = pool.filter((t) => {
      if (!matchesGenre(t, genre)) return false
      if (year !== 'all' && String(t.year) !== year) return false
      if (!matchesQuality(t, quality)) return false
      if (language !== 'all' && !t.languages.includes(language)) return false
      // A search should find a title by its name, its section, its genre or
      // someone in the cast, not only by the first of those.
      if (q) {
        const haystack = `${t.name} ${t.categoryName} ${t.genres.join(' ')} ${t.cast.join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
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

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Select
              label="Genre"
              value={genre}
              onChange={setGenre}
              compact
              options={[
                { value: 'all', label: 'All genres', meta: pool.length ? `${pool.length}` : undefined },
                ...genres.map((g) => ({
                  value: g,
                  label: g,
                  meta: genreCounts.get(g.toLowerCase()) ? `${genreCounts.get(g.toLowerCase())}` : undefined,
                })),
              ]}
            />
            <Select
              label="Year"
              value={year}
              onChange={setYear}
              compact
              options={[{ value: 'all', label: 'Any year' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
            />
            <Select
              label="Quality"
              value={quality}
              onChange={setQuality}
              compact
              options={[
                { value: 'all', label: 'Any quality' },
                { value: '4K', label: '4K UHD' },
                { value: 'FHD', label: 'Full HD' },
                { value: 'HD', label: 'HD' },
              ]}
            />
            <Select
              label="Language"
              value={language}
              onChange={setLanguage}
              compact
              options={[
                { value: 'all', label: 'Any language' },
                { value: 'en', label: 'English' },
                { value: 'ar', label: 'Arabic' },
                { value: 'fr', label: 'French' },
                { value: 'tr', label: 'Turkish' },
              ]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              compact
              align="right"
              className="col-span-2 sm:col-span-1"
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            />
          </div>
          {(genre !== 'all' || year !== 'all' || quality !== 'all' || language !== 'all' || query) && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-ink-mute">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'title' : 'titles'}
              </p>
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
                Reset filters
              </button>
            </div>
          )}
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
