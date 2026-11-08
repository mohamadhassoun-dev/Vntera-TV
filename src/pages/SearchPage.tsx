import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PosterCard } from '../components/cards'
import { Art } from '../components/Art'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icons'
import { SectionHeading } from '../components/Badges'
import { useCatalog } from '../store/catalog'
import {
  DEFAULT_FILTERS,
  groupChannelsByBrand,
  searchContent,
  trendingSearches,
  type SearchFilters,
} from '../lib/search'
import { localGet, localSet } from '../lib/storage'
import { useDebounced } from '../lib/hooks'
import type { Title } from '../types'

const SEARCH_KINDS = ['all', 'movie', 'series', 'live']
const SEARCH_QUALITIES = ['all', '4K', 'FHD', 'HD', 'SD']
const SEARCH_LANGUAGES = ['all', 'ar', 'en', 'fr']

/** Filters live in the address as well as in state: opening a channel and
 *  coming back restores the same search instead of an empty form. */
function readFilters(params: URLSearchParams): SearchFilters {
  const kind = params.get('kind') ?? 'all'
  const quality = params.get('quality') ?? 'all'
  const language = params.get('language') ?? 'all'
  return {
    kind: (SEARCH_KINDS.includes(kind) ? kind : 'all') as SearchFilters['kind'],
    quality: (SEARCH_QUALITIES.includes(quality) ? quality : 'all') as SearchFilters['quality'],
    language: (SEARCH_LANGUAGES.includes(language) ? language : 'all') as SearchFilters['language'],
    genre: params.get('genre') ?? 'all',
  }
}

const KINDS: Array<{ key: SearchFilters['kind']; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'movie', label: 'Movies' },
  { key: 'series', label: 'Series' },
  { key: 'live', label: 'Channels' },
]

export default function SearchPage() {
  const snapshot = useCatalog((s) => s.snapshot)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [picker, setPicker] = useState<{ name: string; channels: Title[] } | null>(null)
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const debounced = useDebounced(query, 300)
  const [filters, setFilters] = useState<SearchFilters>(() => readFilters(params))
  const [recent, setRecent] = useState<string[]>(() => localGet<string[]>('search:recent', []))
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Mirror the term and the filters into the address. Opening a title unmounts
  // this page, so the way back rebuilds the same search — typed text, chosen
  // kind, quality and language included — instead of starting blank.
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (query) next.set('q', query)
    else next.delete('q')
    for (const [key, value] of Object.entries(filters)) {
      if (value && value !== 'all') next.set(key, String(value))
      else next.delete(key)
    }
    if (next.toString() === params.toString()) return
    setParams(next, { replace: true })
  }, [query, filters, params, setParams])

  const results = useMemo(() => searchContent(snapshot, debounced, filters), [snapshot, debounced, filters])
  const trending = useMemo(() => trendingSearches(snapshot, 8), [snapshot])

  const media = results.filter((t) => t.kind !== 'live')
  const channels = results.filter((t) => t.kind === 'live')
  const channelGroups = useMemo(() => groupChannelsByBrand(channels), [channels])

  const remember = (term: string) => {
    const clean = term.trim()
    if (!clean) return
    const next = [clean, ...recent.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 10)
    setRecent(next)
    localSet('search:recent', next)
  }

  /** Remove one remembered term, leaving the rest of the history untouched. */
  const forget = (term: string) => {
    const next = recent.filter((entry) => entry !== term)
    setRecent(next)
    localSet('search:recent', next)
  }

  // A remote never presses Enter, and opening a title unmounts the page. Saving
  // the term on the way out is what actually fills the history.
  const latest = useRef({ query, remember })
  latest.current = { query, remember }
  useEffect(
    () => () => {
      const term = latest.current.query.trim()
      if (term) latest.current.remember(term)
    },
    [],
  )

  const hasCriteria =
    !!debounced || filters.kind !== 'all' || filters.quality !== 'all' || filters.language !== 'all' || filters.genre !== 'all'

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="sticky top-16 md:top-20 z-30 border-b border-stroke bg-canvas/95 backdrop-blur-xl">
        <div className="shell-x py-4">
          <div className="relative">
            <Icon name="search" size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') remember(query)
              }}
              placeholder="Movies, series, channels…"
              className="field !py-3.5 !text-[15px]"
              aria-label="Search the library"
              autoCapitalize="none"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <button onClick={() => setQuery('')} className="rounded p-1.5 text-ink-mute hover:text-white" aria-label="Clear">
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="no-scrollbar mt-3 flex items-center gap-1.5 overflow-x-auto">
            {KINDS.map((k) => (
              <button
                key={k.key}
                onClick={() => setFilters((f) => ({ ...f, kind: k.key }))}
                data-nav="true"
                aria-pressed={filters.kind === k.key}
                className={`tab shrink-0 ${filters.kind === k.key ? '!bg-layer-4 !text-white' : ''}`}
              >
                {k.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-stroke" />
            {(['4K', 'FHD', 'HD'] as const).map((q) => (
              <button
                key={q}
                onClick={() => setFilters((f) => ({ ...f, quality: f.quality === q ? 'all' : q }))}
                data-nav="true"
                aria-pressed={filters.quality === q}
                className={`tab shrink-0 ${filters.quality === q ? '!bg-layer-4 !text-gold' : ''}`}
              >
                {q}
              </button>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-stroke" />
            {(['ar', 'en', 'fr'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setFilters((f) => ({ ...f, language: f.language === l ? 'all' : l }))}
                data-nav="true"
                aria-pressed={filters.language === l}
                className={`tab shrink-0 ${filters.language === l ? '!bg-layer-4 !text-white' : ''}`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shell-x pt-5">
        {!hasCriteria ? (
          <div className="space-y-8">
            {recent.length ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <SectionHeading title="Recent searches" />
                  <button
                    onClick={() => {
                      setRecent([])
                      localSet('search:recent', [])
                    }}
                    className="text-[10px] font-bold uppercase tracking-wider text-ink-mute hover:text-white"
                    data-nav="true"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recent.map((r) => (
                    // Each term carries its own remove button, so one stale
                    // search can be dropped without clearing the rest.
                    <span
                      key={r}
                      className="flex items-center overflow-hidden rounded-full border border-stroke bg-layer-1 hover:border-white/30"
                    >
                      <button
                        onClick={() => {
                          setQuery(r)
                          remember(r)
                        }}
                        className="flex items-center gap-2 py-1.5 pl-3 pr-1 text-[12px] text-ink-soft hover:text-white"
                        data-nav="true"
                      >
                        <Icon name="clock" size={13} /> {r}
                      </button>
                      <button
                        onClick={() => forget(r)}
                        aria-label={`Remove ${r} from recent searches`}
                        className="px-2 py-1.5 text-ink-mute hover:text-crimson"
                        data-nav="true"
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <SectionHeading title="Trending searches" meta="Popular this week" />
              <div className="flex flex-wrap gap-1.5">
                {trending.map((t, i) => (
                  <button
                    key={`${t}-${i}`}
                    onClick={() => {
                      setQuery(t)
                      remember(t)
                    }}
                    className="flex items-center gap-2 rounded-full border border-stroke bg-layer-1 px-3 py-1.5 text-[12px] text-ink-soft hover:border-crimson/60 hover:text-white"
                    data-nav="true"
                  >
                    <span className="text-[10px] font-extrabold text-crimson">{i + 1}</span>
                    {t}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <SectionHeading title="Browse by genre" />
              <div className="flex flex-wrap gap-1.5">
                {['Action', 'Sci-Fi', 'Drama', 'Comedy', 'Crime', 'Horror', 'Sport', 'Romance', 'Documentary', 'Animation'].map((g) => (
                  <button
                    key={g}
                    onClick={() => setFilters((f) => ({ ...f, genre: g }))}
                    className="rounded-[3px] border border-stroke bg-layer-1 px-3 py-1.5 text-[12px] text-ink-soft hover:border-white/30 hover:text-white"
                    data-nav="true"
                  >
                    {g}
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : results.length ? (
          <div className="space-y-9">
            <p className="text-[11px] uppercase tracking-wider text-ink-mute">
              Results for “{debounced || 'filters'}” · best edition only
            </p>

            {media.length ? (
              <section>
                <SectionHeading title="Movies & series" />
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
                  {media.slice(0, 120).map((t: Title, i) => (
                    <PosterCard key={`${t.kind}-${t.id}`} title={t} priority={i < 6} />
                  ))}
                </div>
              </section>
            ) : null}

            {channelGroups.length ? (
              <section>
                <SectionHeading
                  title="Live channels"
                  meta={`${channelGroups.length} ${channelGroups.length === 1 ? 'network' : 'networks'}`}
                />
                <div className="grid gap-2 lg:grid-cols-2">
                  {channelGroups.slice(0, 60).map((group) => {
                    const first = group.channels[0]
                    return (
                      <button
                        key={group.key}
                        onClick={() => {
                          if (group.channels.length === 1) navigate(`/watch/live/${first.id}`)
                          else setPicker({ name: group.name, channels: group.channels })
                        }}
                        className="group flex items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 text-left transition-colors hover:bg-layer-2 focus-visible:outline-none"
                        data-nav="true"
                      >
                        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-[3px] bg-layer-2">
                          <Art
                            src={first.poster}
                            title={group.name}
                            kind="channel"
                            seed={group.name}
                            className="h-full w-full object-contain"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{group.name}</p>
                          <p className="truncate text-[11px] text-ink-mute">
                            {group.channels.length > 1
                              ? `${group.channels.length} channels · choose one`
                              : first.categoryName}
                          </p>
                        </div>
                        <Icon name="chevronRight" size={16} className="shrink-0 text-ink-mute" />
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {media.length > 120 ? (
              <p className="text-center text-[11px] uppercase tracking-wider text-ink-mute">
                Showing the 120 strongest matches · refine the query for more
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon="search"
            title="No matches"
            body={`Nothing in the cached library matches “${debounced}”. Channels or titles without artwork are still searchable.`}
            action={
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery('')
                  setFilters(DEFAULT_FILTERS)
                }}
              >
                Clear search
              </button>
            }
          />
        )}
      </div>

      {picker ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-3 sm:items-center"
          onClick={() => setPicker(null)}
          role="presentation"
        >
          <div
            className="max-h-[78vh] w-full max-w-lg overflow-y-auto rounded-lg border border-stroke bg-layer-1 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Choose a ${picker.name} channel`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{picker.name}</h2>
                <p className="text-[11px] uppercase tracking-wider text-ink-mute">Choose a channel</p>
              </div>
              <button
                onClick={() => setPicker(null)}
                className="icon-btn !h-8 !w-8"
                aria-label="Close channel list"
                data-nav="true"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {picker.channels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => {
                    setPicker(null)
                    navigate(`/watch/live/${channel.id}`)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[4px] border border-stroke bg-layer-2 p-2 text-left transition-colors hover:border-white/25"
                  data-nav="true"
                >
                  <span className="rounded-[2px] bg-black/60 px-1.5 py-1 text-[10px] font-bold uppercase text-gold">
                    {channel.quality}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{channel.name}</span>
                    <span className="block truncate text-[11px] text-ink-mute">
                      {channel.categoryName}
                      {channel.num ? ` · CH ${String(channel.num).padStart(3, '0')}` : ''}
                    </span>
                  </span>
                  <Icon name="play" size={16} className="shrink-0 text-crimson" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
