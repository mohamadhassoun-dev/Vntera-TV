import { Link } from 'react-router-dom'
import { PosterCard } from './cards'
import { Icon } from './Icons'
import type { Title } from '../types'

/** Two rows deep, twelve posters per row, so the line-up scrolls sideways. */
const PER_ROW = 12

/**
 * The homepage's only Horror section: the stage backdrop behind the posters,
 * two rows of twelve that carry the whole line-up and scroll sideways, and a
 * heading that opens the Movies page with the Horror genre filter already
 * applied (the existing catalogue filter, not a second page listing just these).
 */
export function HorrorBand({ titles }: { titles: Title[] }) {
  if (!titles.length) return null
  const rows = [titles.slice(0, PER_ROW), titles.slice(PER_ROW, PER_ROW * 2)].filter(
    (row) => row.length > 0,
  )

  return (
    <section className="rail-section min-w-0 rail-horror" aria-label="Horror Movies">
      <Link
        to="/movies?genre=Horror"
        className="horror-heading"
        data-nav="true"
        title="See every horror movie"
      >
        Horror Movies
        <Icon name="chevronRight" size={18} className="horror-heading-arrow" />
      </Link>
      <div className="horror-rows">
        {rows.map((row, index) => (
          <div key={index} className="rail no-scrollbar horror-rail">
            {row.map((movie) => (
              <PosterCard key={`${movie.key}-${movie.id}`} title={movie} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
