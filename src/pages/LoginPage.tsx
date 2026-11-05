import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { PANEL_ORIGIN } from '../lib/config'
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

  useEffect(() => {
    if (status === 'authed') navigate('/', { replace: true })
  }, [status, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    const ok = await login(username, password, PANEL_ORIGIN)
    if (ok) navigate('/', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen flex-col">
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

      <main className="relative z-10 flex flex-1 items-center px-4 py-10 md:px-8">
        <div className="relative mx-auto w-full max-w-xl">
          <div className="p-6 sm:p-8">
            <img
              src="/logos/login-logo.webp"
              alt="Vntera"
              width={360}
              height={240}
              fetchPriority="high"
              decoding="async"
              className="mx-auto mb-7 block h-32 w-auto sm:h-40"
            />

            <div className="mb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black uppercase tracking-tight md:text-[28px]">Sign in</h1>
                  <span className="rounded-[2px] bg-crimson px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
                    TV
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  Live TV, movies and series in one place.
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                  Account
                </label>
                <div className="relative">
                  <Icon name="user" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
                  <input
                    id="username"
                    className="field"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                  Password
                </label>
                <div className="relative">
                  <Icon name="lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute" />
                  <input
                    id="password"
                    className="field !pr-12"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-mute hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
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

              <button type="submit" className="btn btn-primary w-full !py-3.5 uppercase tracking-wide" disabled={busy} data-nav="true">
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

            </form>

            <div className="mt-5">
              <span className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                <Icon name="tv" size={14} className="text-crimson" /> One sign in keeps all your devices active.
              </span>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex flex-col items-center justify-between gap-2 px-4 py-4 text-[10px] text-ink-mute sm:flex-row md:px-8">
        <span className="font-bold uppercase tracking-wider">Stream engine core v1.0</span>
        <Link to="/download" className="flex items-center gap-1.5 font-bold uppercase tracking-wider hover:text-white" data-nav="true">
          <Icon name="download" size={12} /> Get the Android app
        </Link>
        <span>© {new Date().getFullYear()} Vntera Media Networks</span>
      </footer>

    </div>
  )
}
