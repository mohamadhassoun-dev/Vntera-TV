import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { PANEL_ORIGIN } from '../lib/config'
import { focusFirstNav, isTVEnvironment } from '../lib/platform'
import { useAuth } from '../store/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuth((s) => s.login)
  const busy = useAuth((s) => s.busy)
  const error = useAuth((s) => s.error)
  const clearError = useAuth((s) => s.clearError)
  const status = useAuth((s) => s.status)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const onTV = useMemo(() => isTVEnvironment(), [])

  useEffect(() => {
    if (status === 'authed') navigate('/', { replace: true })
  }, [status, navigate])

  // A remote that lands on a page with nothing focused does nothing when the
  // first arrow is pressed. Put the ring on Account so the first key press
  // either types or moves on, with the field visibly selected.
  useEffect(() => {
    if (!onTV) return
    const t = window.setTimeout(() => focusFirstNav(), 200)
    return () => window.clearTimeout(t)
  }, [onTV])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    const ok = await login(username, password, PANEL_ORIGIN)
    if (ok) navigate('/', { replace: true })
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Poster-wall backdrop, softened and darkened so the form stays readable. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/media/login-backdrop.webp"
          alt=""
          aria-hidden="true"
          width={1100}
          height={576}
          decoding="async"
          className="h-full w-full scale-105 object-cover opacity-80 blur-[1px]"
        />
        <div className="absolute inset-0 bg-canvas/60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#13131300_10%,#131313_82%)]" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-crimson/12 blur-[150px]" />
      </div>

      {/* The sign-in surface is a real card: on a TV the wallpaper behind it is
          busy, and floating fields read as broken markup. It is also a two-pane
          layout from `md` up, so the whole form fits a 540px-tall TV viewport
          instead of pushing the button below the screen. */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-4 md:px-8 md:py-4">
        <div className="panel w-full max-w-3xl p-5 sm:p-6 md:p-7 lg:px-10 lg:py-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-8 lg:gap-12">
            <div className="shrink-0 md:w-[17rem] lg:w-[21rem]">
              <img
                src="/logos/login-logo.webp"
                alt="Vntera"
                width={360}
                height={240}
                fetchPriority="high"
                decoding="async"
                className="mx-auto mb-4 block h-20 w-auto sm:h-24 md:mx-0 md:mb-5 md:h-24 lg:h-28"
              />

              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black uppercase tracking-tight md:text-2xl">Sign in</h1>
                <span className="rounded-[2px] bg-crimson px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
                  TV
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-ink-soft md:text-sm">
                Live TV, movies and series in one place.
              </p>

              <span className="mt-3 hidden items-center gap-1.5 text-[11px] text-ink-soft md:flex">
                <Icon name="tv" size={14} className="shrink-0 text-crimson" /> One sign in keeps all
                your devices active.
              </span>
            </div>

            <form onSubmit={submit} className="min-w-0 flex-1 space-y-3 sm:space-y-4">
              <div>
                <label
                  htmlFor="username"
                  className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink-soft"
                >
                  Account
                </label>
                <div className="relative">
                  <Icon
                    name="user"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
                  />
                  <input
                    id="username"
                    className="field"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    data-nav="true"
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink-soft"
                >
                  Password
                </label>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute"
                  />
                  <input
                    id="password"
                    className="field !pr-12"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    data-nav="true"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-mute hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    data-nav="true"
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                  </button>
                </div>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-[4px] border border-crimson/40 bg-crimson/10 px-3 py-2 text-[12px] text-white">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-crimson" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                className="btn btn-primary w-full !py-3 uppercase tracking-wide"
                disabled={busy}
                data-nav="true"
              >
                {busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Authenticating
                  </>
                ) : (
                  <>
                    <Icon name="play" size={18} />
                    Sign in
                  </>
                )}
              </button>

              {onTV ? (
                <div className="flex items-center gap-2 rounded-[4px] border border-stroke/70 bg-black/35 px-2.5 py-1.5">
                  <kbd className="shrink-0 rounded-[3px] border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    OK
                  </kbd>
                  <span className="text-[11px] leading-tight text-ink-soft">
                    Press OK on the remote to type. Arrows move between the fields.
                  </span>
                </div>
              ) : null}

              <span className="flex items-center gap-1.5 pt-0.5 text-[11px] text-ink-soft md:hidden">
                <Icon name="tv" size={14} className="shrink-0 text-crimson" /> One sign in keeps all
                your devices active.
              </span>
            </form>
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex shrink-0 flex-col items-center justify-between gap-1.5 px-4 py-3 text-[10px] text-ink-mute sm:flex-row md:px-8">
        <span className="font-bold uppercase tracking-wider">Stream engine core v1.0</span>
        <Link
          to="/download"
          className="flex items-center gap-1.5 font-bold uppercase tracking-wider hover:text-white"
          data-nav="true"
        >
          <Icon name="download" size={12} /> Get the Android app
        </Link>
        <span className="hidden sm:inline">© {new Date().getFullYear()} Vntera Media Networks</span>
      </footer>
    </div>
  )
}
