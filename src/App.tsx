import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { PageSkeleton } from './components/Skeleton'
import { SPLASH_MAX_MS, Splash } from './components/Splash'
import { applyFormFactor, detectFormFactor, installSpatialNavigation } from './lib/platform'
import { REFRESH_INTERVAL_MS } from './lib/config'
import { useAuth } from './store/auth'
import { useCatalog } from './store/catalog'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const DownloadPage = lazy(() => import('./pages/DownloadPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const LivePage = lazy(() => import('./pages/LivePage'))
const MoviesPage = lazy(() => import('./pages/MoviesPage'))
const SeriesPage = lazy(() => import('./pages/SeriesPage'))
const NewPopularPage = lazy(() => import('./pages/NewPopularPage'))
const MyListPage = lazy(() => import('./pages/MyListPage'))
const DetailsPage = lazy(() => import('./pages/DetailsPage'))
const WatchPage = lazy(() => import('./pages/WatchPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const CollectionPage = lazy(() => import('./pages/CollectionPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))

function Protected({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status)
  if (status === 'anon') return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const status = useAuth((s) => s.status)
  const session = useAuth((s) => s.session)
  const bootstrap = useAuth((s) => s.bootstrap)
  const loadCatalog = useCatalog((s) => s.load)

  const [formFactor, setFormFactor] = useState(() => detectFormFactor())
  const [booted, setBooted] = useState(false)
  /** The smiley loader has had its turn; a slow catalogue shows the page itself. */
  const [splashSpent, setSplashSpent] = useState(false)
  const catalogReady = useCatalog((s) => s.snapshot !== null)
  const catalogProgress = useCatalog((s) => s.progress)

  useEffect(() => {
    void bootstrap()
    const t = window.setTimeout(() => setBooted(true), 1600)
    // The loader covers the first page pull, never longer than its twenty seconds.
    const cap = window.setTimeout(() => setSplashSpent(true), SPLASH_MAX_MS)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(cap)
    }
  }, [bootstrap])

  useEffect(() => {
    applyFormFactor(formFactor)
    document.documentElement.dataset.reduceMotion = String(false)
  }, [formFactor])

  useEffect(() => {
    const onResize = () => setFormFactor(detectFormFactor())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Catalog: account snapshot (cached 6 h, offline-first).
  useEffect(() => {
    if ((status === 'authed' || status === 'reauth') && session) void loadCatalog({ account: session.username })
  }, [status, session, loadCatalog])

  // Background refresh every six hours.
  useEffect(() => {
    if (!session) return
    const id = window.setInterval(() => {
      void loadCatalog({ force: true, account: session.username })
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [session, loadCatalog])

  useEffect(() => {
    const uninstall = installSpatialNavigation({
      enabled: formFactor === 'tv',
      onBack: () => navigate(-1),
    })
    return uninstall
  }, [formFactor, navigate])

  // Until the first catalogue page is in, the smiley is the only thing on screen,
  // so nobody watches an empty shell with a skeleton in it.
  const catalogPending = (status === 'authed' || status === 'reauth') && !catalogReady && !splashSpent
  if (status === 'booting' || !booted || catalogPending) return <Splash progress={catalogProgress} />

  // The app download page is public: it is how a phone gets the app in the first place.
  if (location.pathname === '/download') {
    return (
      <Suspense fallback={<Splash />}>
        <DownloadPage />
      </Suspense>
    )
  }

  if (status === 'anon') {
    return (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    )
  }

  const isWatchRoute = location.pathname.startsWith('/watch/')

  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route
          path="/watch/:kind/:id"
          element={
            <Protected>
              <WatchPage />
            </Protected>
          }
        />
        <Route
          path="/*"
          element={
            <Protected>
              <AppShell formFactor={formFactor}>
                <Suspense fallback={<PageSkeleton />}>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/live" element={<LivePage />} />
                    <Route path="/movies" element={<MoviesPage />} />
                    <Route path="/series" element={<SeriesPage />} />
                    <Route path="/new" element={<NewPopularPage />} />
                    <Route path="/my-list" element={<MyListPage />} />
                    <Route path="/title/:kind/:id" element={<DetailsPage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/collection/:slug" element={<CollectionPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </AppShell>
            </Protected>
          }
        />
      </Routes>
      {isWatchRoute ? null : null}
    </Suspense>
  )
}
