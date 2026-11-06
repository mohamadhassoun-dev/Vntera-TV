import { NavLink, useNavigate } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { Icon, type IconName } from './Icons'

/** The same destinations the desktop header offers, as a television rail. */
export const RAIL_NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/live', label: 'Live TV', icon: 'tv' },
  { to: '/series', label: 'TV Shows', icon: 'film' },
  { to: '/movies', label: 'Movies', icon: 'grid' },
  { to: '/new', label: 'New & Popular', icon: 'sparkles' },
  { to: '/my-list', label: 'My List', icon: 'heart' },
  { to: '/downloads', label: 'Downloads', icon: 'download' },
]

function RailLink({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      data-nav="true"
      aria-label={label}
      className={({ isActive }) => `tv-rail-item${isActive ? ' is-active' : ''}`}
    >
      <Icon name={icon} size={24} />
      <span className="tv-rail-label">{label}</span>
    </NavLink>
  )
}

/** Icon rail that replaces the horizontal header on the ten-foot surface. */
export function TvRail({ collapsed = false }: { collapsed?: boolean }) {
  const navigate = useNavigate()
  const unread = useLibrary((s) => s.notifications.filter((n) => !n.read).length)

  return (
    <aside className={`tv-rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Browse">
      {/* The wordmark is decoration on the television, not a destination. */}
      <div className="tv-rail-logo">
        <img src="/logos/nav-logo.webp" alt="Vntera" width={279} height={170} />
      </div>

      <nav className="tv-rail-group">
        {RAIL_NAV.map((item) => (
          <RailLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="tv-rail-group tv-rail-foot">
        <button
          className="tv-rail-item"
          onClick={() => navigate('/search')}
          data-nav="true"
          aria-label="Search"
        >
          <Icon name="search" size={24} />
          <span className="tv-rail-label">Search</span>
        </button>
        <button
          className="tv-rail-item relative"
          onClick={() => navigate('/notifications')}
          data-nav="true"
          aria-label="Notifications"
        >
          <Icon name="bell" size={24} />
          <span className="tv-rail-label">Alerts</span>
          {unread ? (
            <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[9px] font-bold text-white">
              {unread}
            </span>
          ) : null}
        </button>
        <RailLink to="/profile" label="Profile" icon="user" />
      </div>
    </aside>
  )
}
