import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { PosterCard } from './cards'
import { Icon } from './Icons'
import type { Title } from '../types'

/** Two rows deep, twelve posters per row, so the line-up scrolls sideways. */
const PER_ROW = 12
const VISIBLE = PER_ROW * 2

/**
 * A curated homepage band: stage artwork behind two rows of twelve posters and
 * a heading that opens the Movies page with its genre filter already applied.
 * Horror, Action and Drama share this shape so they read as one family.
 *
 * The caller hands over a few spare titles. A poster whose artwork fails to
 * load is dropped, and the next spare keeps the wall at two full rows instead
 * of leaving a hole in it.
 */
export function GenreBand({
  label,
  titles,
  href,
  background,
  accent,
  className = '',
}: {
  label: string
  titles: Title[]
  href: string
  background: string
  accent: string
  className?: string
}) {
  const [failed, setFailed] = useState<number[]>([])
  if (!titles.length) return null
  const shown = titles.filter((title) => !failed.includes(title.id)).slice(0, VISIBLE)
  const rows = [shown.slice(0, PER_ROW), shown.slice(PER_ROW, VISIBLE)].filter((row) => row.length > 0)

  return (
    <section
      className={`rail-section min-w-0 rail-band ${className}`}
      aria-label={label}
      style={{ '--band-art': `url('${background}')`, '--band-accent': accent } as CSSProperties}
    >
      <Link to={href} className="band-heading" data-nav="true" title={`See every ${label.toLowerCase()}`}>
        {label}
        <Icon name="chevronRight" size={18} className="band-heading-arrow" />
      </Link>
      <div className="horror-rows">
        {rows.map((row, index) => (
          <div key={index} className="rail no-scrollbar horror-rail">
            {row.map((movie) => (
              <PosterCard
                key={`${movie.key}-${movie.id}`}
                title={movie}
                onArtFail={() => setFailed((ids) => (ids.includes(movie.id) ? ids : [...ids, movie.id]))}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
