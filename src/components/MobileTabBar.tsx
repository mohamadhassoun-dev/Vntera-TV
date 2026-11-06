import type { CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icons'

const TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/live', label: 'Live TV', icon: 'tv' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/my-list', label: 'My List', icon: 'heart' },
  { to: '/downloads', label: 'Downloads', icon: 'download' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

const SLOT = 100 / TABS.length

function activeIndex(pathname: string): number {
  const index = TABS.findIndex((tab) =>
    tab.to === '/' ? pathname === '/' : pathname === tab.to || pathname.startsWith(`${tab.to}/`),
  )
  return index < 0 ? 0 : index
}

/**
 * Phone navigation: a floating pill with a notch that slides under the active
 * tab, which sits in a raised crimson badge above the bar.
 */
export function MobileTabBar() {
  const { pathname } = useLocation()
  const index = activeIndex(pathname)
  const active = TABS[index]

  return (
    <nav
      aria-label="Primary"
      className="mobile-tabbar fixed inset-x-3 z-50 md:hidden"
      // clamp keeps the cutout inside the bar's rounded corners on narrow phones
      style={{ '--notch-x': `clamp(2.2rem, ${SLOT * index + SLOT / 2}%, calc(100% - 2.2rem))` } as CSSProperties}
    >
      <div className="relative h-[4.25rem]">
        {/* Shadow sits outside the mask so the drop shadow follows the notch. */}
        <div aria-hidden className="mobile-tabbar__shadow absolute inset-0">
          <div className="mobile-tabbar__surface absolute inset-0 rounded-[1.625rem] border border-white/10 bg-[#0b0b0b]/92" />
        </div>

        <span
          key={active.to}
          aria-hidden
          data-tabbar-badge
          className="mobile-tabbar__badge pointer-events-none flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(160deg,#ff2a35,#b00710)] text-white ring-1 ring-white/20 shadow-[0_12px_26px_-10px_rgba(229,9,20,0.9)]"
        >
          <Icon name={active.icon} size={24} />
        </span>

        <div
          className="relative grid h-full"
          style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
        >
          {TABS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              data-nav="true"
              aria-label={item.label}
              className={({ isActive }) =>
                `group flex h-full flex-col items-center justify-between py-[0.6rem] transition-transform duration-200 active:scale-[0.92] ${
                  isActive ? 'text-white' : 'text-ink-mute'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* The badge carries the active icon. The slot keeps its height but
                      drops the icon outright: a fade left the tab showing two homes
                      while the badge was already sitting above it. */}
                  <span
                    aria-hidden
                    className={`flex h-[22px] w-[22px] items-center justify-center ${
                      isActive ? '' : 'transition-transform duration-150 group-hover:text-ink-soft group-active:scale-90'
                    }`}
                  >
                    {isActive ? null : <Icon name={item.icon} size={21} />}
                  </span>
                  <span
                    className={`text-[0.625rem] leading-none tracking-[0.01em] transition-all duration-300 ${
                      isActive ? 'font-bold text-white' : 'font-semibold group-hover:text-ink-soft'
                    }`}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
