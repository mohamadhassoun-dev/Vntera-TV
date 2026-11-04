import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PosterCard } from '../components/cards'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icons'
import { useCatalog } from '../store/catalog'
import { COLLECTIONS, collectionTitles, isCollectionSlug } from '../lib/collections'
import type { Title } from '../types'

const PAGE = 42

export default function CollectionPage() {
  const { slug } = useParams()
  const snapshot = useCatalog((s) => s.snapshot)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)

  const definition = isCollectionSlug(slug) ? COLLECTIONS[slug] : null

  const titles = useMemo<Title[]>(() => {
    if (!snapshot || !definition) return []
    const pool = collectionTitles([...snapshot.movies, ...snapshot.series], definition.slug)
    pool.sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name))
    const q = query.trim().toLowerCase()
    return q ? pool.filter((title) => title.name.toLowerCase().includes(q)) : pool
  }, [snapshot, definition, query])

  // Infinite scroll: load the next page as the end of the grid comes into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((value) => (value < titles.length ? value + PAGE : value))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [titles.length])

  if (!definition) return <Navigate to="/" replace />

  const shown = titles.slice(0, limit)

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="border-b border-stroke bg-gradient-to-b from-layer-2/70 to-canvas">
        <div className="shell-x py-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Link to="/" className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-crimson" data-nav="true">
                Shortcut channel
              </Link>
              <h1 className="mt-1.5 text-2xl font-black tracking-tight md:text-3xl">{definition.label}</h1>
            </div>
            <div className="relative w-full sm:w-72">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setLimit(PAGE)
                }}
                placeholder={`Search ${definition.label}`}
                className="field !py-2.5"
                aria-label={`Search ${definition.label}`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="shell-x pt-6">
        {shown.length ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
              {shown.map((title, index) => (
                <PosterCard key={`${title.kind}-${title.id}`} title={title} priority={index < 8} />
              ))}
            </div>
            {limit < titles.length ? <div ref={sentinel} className="h-16" aria-hidden="true" /> : null}
          </>
        ) : (
          <EmptyState
            icon="film"
            title={`No ${definition.label.toLowerCase()} titles found`}
            body={
              query
                ? 'Nothing matches that search in this collection.'
                : 'This collection has no matching category on Vntera.'
            }
            action={
              query ? (
                <button className="btn btn-ghost" onClick={() => setQuery('')}>
                  Clear search
                </button>
              ) : (
                <Link to="/" className="btn btn-ghost" data-nav="true">
                  Back to Home
                </Link>
              )
            }
          />
        )}
      </div>
    </div>
  )
}
