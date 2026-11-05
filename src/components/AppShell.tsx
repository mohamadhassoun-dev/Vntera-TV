import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useCatalog } from '../store/catalog'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { useOnline, useScrolledPast } from '../lib/hooks'
import { installRoutePrefetch } from '../lib/prefetch'
import { useAutoAlerts } from '../lib/alerts'
import { ANDROID_RELEASE } from '../lib/release'
import { Icon, type IconName } from './Icons'
import { MobileTabBar } from './MobileTabBar'
import type { FormFactor } from '../lib/platform'

const NAV: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/live', label: 'Live TV', icon: 'tv' },
  { to: '/series', label: 'TV Shows', icon: 'film' },
  { to: '/movies', label: 'Movies', icon: 'grid' },
  { to: '/new', label: 'New & Popular', icon: 'sparkles' },
  { to: '/my-list', label: 'My List', icon: 'heart' },
  { to: '/profile', label: 'Profile', icon: 'user' },
]

export function Logo() {
  return (
    <img
      src="/logos/nav-logo.webp"
      alt="Vntera"
      width={279}
      height={170}
      className="h-12 w-auto sm:h-[3.75rem] md:translate-y-[4px]"
    />
  )
}

export function AppShell({ children, formFactor }: { children: React.ReactNode; formFactor: FormFactor }) {
  const location = useLocation()
  const navigate = useNavigate()
  const status = useAuth((s) => s.status)
  const offline = useCatalog((s) => s.offline)
  const online = useOnline()
  const unread = useLibrary((s) => s.notifications.filter((n) => !n.read).length)
  const { toasts, dismiss } = useUI()
  useAutoAlerts()
  const isTV = formFactor === 'tv'
  const scrolled = useScrolledPast(10)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMenuOpen(false)
  }, [location.pathname])

  // Warm page chunks as soon as a link is hovered or focused.
  useEffect(() => installRoutePrefetch(), [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-canvas pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300 ${
          scrolled ? 'bg-canvas/90 backdrop-blur-xl hairline' : 'bg-transparent border-b border-transparent'
        }`}
      >
        <div className={`flex h-16 items-center justify-between gap-4 md:h-20 ${isTV ? 'px-16' : 'shell-x'}`}>
          <div className="flex min-w-0 items-center gap-5 xl:gap-8">
            <Link to="/" className="shrink-0" data-nav="true" aria-label="Vntera home">
              <Logo />
            </Link>
            <nav className="app-nav hidden items-center gap-5 xl:flex">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-nav="true"
                  className={({ isActive }) =>
                    `relative py-1 text-[13px] transition-colors ${
                      isActive
                        ? 'font-bold text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-crimson'
                        : 'text-ink-soft hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 md:gap-2.5">
            {/* Phones keep Profile in the bottom bar, so the header copy only
                covers tablets, where that bar is gone. */}
            <button
              className="app-profile-icon icon-btn hidden md:flex xl:hidden"
              onClick={() => navigate('/profile')}
              data-nav="true"
              aria-label="Profile"
            >
              <Icon name="user" size={18} />
            </button>
            <button className="icon-btn" onClick={() => navigate('/search')} data-nav="true" aria-label="Search">
              <Icon name="search" size={18} />
            </button>
            <button
              className="icon-btn relative hidden xl:flex"
              onClick={() => navigate('/notifications')}
              data-nav="true"
              aria-label="Notifications"
            >
              <Icon name="bell" size={18} />
              {unread ? (
                <span className="absolute right-2 top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-crimson px-1 text-[9px] font-bold text-white">
                  {unread}
                </span>
              ) : null}
            </button>
            <button
              className="app-menu-toggle icon-btn xl:hidden"
              onClick={() => setMenuOpen(true)}
              data-nav="true"
              aria-label="Browse menu"
              aria-expanded={menuOpen}
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        </div>

        {status === 'reauth' ? (
          <div className="flex items-center justify-between gap-3 bg-crimson-deep/90 px-4 py-2 text-xs md:px-8">
            <span className="flex items-center gap-2 font-semibold text-white">
              <Icon name="alert" size={14} /> Vntera rejected this session. Sign in again to keep watching.
            </span>
            <Link to="/login" className="rounded-[3px] bg-black/40 px-2.5 py-1 font-bold uppercase tracking-wide text-white" data-nav="true">
              Re-authenticate
            </Link>
          </div>
        ) : null}

        {(!online || offline) && status !== 'reauth' ? (
          <div className="flex items-center gap-2 bg-layer-3 px-4 py-1.5 text-[11px] text-ink-soft md:px-8">
            <Icon name="cloud" size={13} />
            Offline — showing your cached library.
          </div>
        ) : null}
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[60] xl:hidden" role="dialog" aria-modal="true" aria-label="Browse">
          <button
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 left-0 w-[18rem] max-w-[86vw] overflow-y-auto border-r border-stroke bg-canvas px-4 pb-8 pt-3 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <Link to="/" data-nav="true" aria-label="Vntera home">
                <Logo />
              </Link>
              <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu" data-nav="true">
                <Icon name="close" size={18} />
              </button>
            </div>
            <nav className="flex flex-col">
              {NAV.filter((item) => item.to !== '/profile').map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-nav="true"
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-[4px] px-2.5 py-3 text-[14px] font-semibold transition-colors ${
                      isActive ? 'bg-layer-2 text-white' : 'text-ink-soft hover:bg-layer-2 hover:text-white'
                    }`
                  }
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </NavLink>
              ))}
              <NavLink
                to="/notifications"
                data-nav="true"
                className={({ isActive }) =>
                  `mt-1 flex items-center gap-3 rounded-[4px] px-2.5 py-3 text-[14px] font-semibold transition-colors ${
                    isActive ? 'bg-layer-2 text-white' : 'text-ink-soft hover:bg-layer-2 hover:text-white'
                  }`
                }
              >
                <Icon name="bell" size={18} />
                Notifications
                {unread ? (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-crimson px-1.5 text-[10px] font-bold text-white">
                    {unread}
                  </span>
                ) : null}
              </NavLink>
            </nav>
          </div>
        </div>
      ) : null}

      <main className="min-w-0">{children}</main>

      <footer className="border-t border-stroke bg-canvas px-4 pb-24 pt-8 md:px-8 md:pb-8">
        <div className={`mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between ${isTV ? 'px-8' : ''}`}>
          <div className="max-w-md">
            <h2 className="text-[13px] font-extrabold uppercase tracking-widest text-white">Get Vntera on every screen</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
              Version {ANDROID_RELEASE.version} for Android phones, Android TV and Windows —{' '}
              the same sign-in, library and watchlist everywhere.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={ANDROID_RELEASE.file}
                download={`vntera-${ANDROID_RELEASE.version}.apk`}
                className="btn btn-primary !px-4 !py-2.5 text-[12px] uppercase tracking-wide"
                data-nav="true"
              >
                <Icon name="download" size={16} /> Android APK
              </a>
              <Link to="/download?platform=tv" className="btn btn-secondary !px-4 !py-2.5 text-[12px]" data-nav="true">
                <Icon name="tv" size={15} /> TV build
              </Link>
              <Link to="/download?platform=desktop" className="btn btn-secondary !px-4 !py-2.5 text-[12px]" data-nav="true">
                <Icon name="grid" size={15} /> Windows
              </Link>
              <Link
                to="/download"
                className="px-1 text-[12px] font-bold uppercase tracking-wide text-ink-soft hover:text-white"
                data-nav="true"
              >
                Install help
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              to="/download"
              data-nav="true"
              aria-label="Scan the QR code to install Vntera on a phone, TV or PC"
              className="flex items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 pr-4 transition-colors hover:border-white/25"
            >
              <img
                src="/media/qr-phone.png"
                alt="QR code that opens the Vntera download page"
                width={96}
                height={96}
                loading="lazy"
                decoding="async"
                className="h-24 w-24 rounded-[3px] bg-white p-1"
              />
              <span className="text-[11px] leading-snug text-ink-soft">
                <span className="block font-bold uppercase tracking-wider text-white">Scan to install</span>
                Point your phone camera here, or tap for the download page.
              </span>
            </Link>
            <Link
              to="/download?platform=tv"
              data-nav="true"
              aria-label="Scan the QR code for the Android TV build"
              className="hidden items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 pr-4 transition-colors hover:border-white/25 sm:flex"
            >
              <img
                src="/media/qr-tv.png"
                alt="QR code that opens the Vntera Android TV download"
                width={96}
                height={96}
                loading="lazy"
                decoding="async"
                className="h-24 w-24 rounded-[3px] bg-white p-1"
              />
              <span className="text-[11px] leading-snug text-ink-soft">
                <span className="block font-bold uppercase tracking-wider text-white">Android TV</span>
                Scan for the TV build.
              </span>
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-7 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-stroke pt-4 text-[11px] text-ink-mute">
          <span>© {new Date().getFullYear()} Vntera</span>
          <span className="font-bold uppercase tracking-wider">Build {ANDROID_RELEASE.version}</span>
        </div>
      </footer>

      <MobileTabBar />

      <div className="pointer-events-none fixed bottom-24 left-1/2 z-[95] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2 md:bottom-8">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto rounded-[4px] border px-4 py-2.5 text-left text-[13px] shadow-2xl backdrop-blur-md ${
              t.tone === 'error'
                ? 'border-crimson/50 bg-crimson/20 text-white'
                : t.tone === 'success'
                  ? 'border-live/40 bg-live/15 text-white'
                  : 'border-stroke bg-layer-2/95 text-white'
            }`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </div>
  )
}
