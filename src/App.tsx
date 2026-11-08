import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { PageSkeleton } from './components/Skeleton'
import { Splash } from './components/Splash'
import { applyFormFactor, detectFormFactor, installSpatialNavigation } from './lib/platform'
import { nativeOffline } from './lib/offline/native'
import { useOffline } from './store/offline'
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
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'))

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
  /** The launch intro has played out (or been skipped). */
  const [introDone, setIntroDone] = useState(false)
  /** Home's first screen is built, so the launch cover can hand over. */
  const [homeReady, setHomeReady] = useState(false)

  const catalogProgress = useCatalog((s) => s.progress)
  const catalogStatus = useCatalog((s) => s.status)
  const snapshot = useCatalog((s) => s.snapshot)

  // Pick the home page's rails while the intro is still playing, so the cover
  // lifts onto a finished first screen instead of a page whose rows are still
  // arriving one by one.
  useEffect(() => {
    if (status !== 'authed' && status !== 'reauth') return
    if (!snapshot || catalogStatus !== 'ready' || homeReady) return
    let cancelled = false
    void import('./pages/HomePage')
      .then((module) => module.prewarmHomeRows(snapshot))
      .then(() => {
        if (!cancelled) setHomeReady(true)
      })
      .catch(() => {
        if (!cancelled) setHomeReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [snapshot, catalogStatus, status, homeReady])

  useEffect(() => {
    void bootstrap()
    const t = window.setTimeout(() => setBooted(true), 700)
    return () => {
      window.clearTimeout(t)
    }
  }, [bootstrap])

  useEffect(() => {
    applyFormFactor(formFactor)
    document.documentElement.dataset.reduceMotion = String(false)
  }, [formFactor])

  // Home chooses eleven rails out of the whole library, which is a third of a
  // second on a 46k-title catalogue. Build them here, one rail per frame, while
  // the viewer is on some other page: the tap that opens Home then finds the
  // line-up already chosen instead of freezing while it is computed. The chunk is
  // imported lazily, so this costs nothing on a route that never loads Home.
  useEffect(() => {
    if (catalogStatus !== 'ready' || !snapshot || location.pathname === '/') return
    const idle = (
      window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 800))
    ) as (cb: () => void) => number
    let cancelled = false
    const handle = idle(() => {
      void import('./pages/HomePage')
        .then((module) => (cancelled ? undefined : module.prewarmHomeRows(snapshot)))
        .catch(() => undefined)
    })
    return () => {
      cancelled = true
      window.cancelIdleCallback?.(handle)
    }
  }, [catalogStatus, snapshot, location.pathname])

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

  // Offline queue: hydrated once, then it keeps itself in step with the native
  // Android service or, on the web, with IndexedDB.
  const initOffline = useOffline((s) => s.init)
  useEffect(() => {
    void initOffline()
  }, [initOffline])

  // A tap on the download notification opens the Downloads page, whether the
  // app was running or had been closed.
  useEffect(() => {
    const bridge = nativeOffline()
    if (!bridge) return
    let disposed = false
    let listener: { remove: () => Promise<void> } | undefined
    void bridge.initialRoute().then(({ route }) => {
      if (!disposed && route) navigate(route)
    })
    void bridge
      .addListener('openRoute', ({ route }) => navigate(route))
      .then((handle) => {
        if (disposed) void handle.remove()
        else listener = handle
      })
    return () => {
      disposed = true
      void listener?.remove()
    }
  }, [navigate])

  useEffect(() => {
    const uninstall = installSpatialNavigation({
      enabled: formFactor === 'tv',
      onBack: () => navigate(-1),
    })
    return uninstall
  }, [formFactor, navigate])

  // The intro covers the first moments while the route below it loads: the home
  // page (or the login form) is mounted and fetching behind the video, so the
  // splash never adds to the wait, it hides it.
  const booting = status === 'booting'
  const showIntro = booting || !(booted && introDone)

  // Signed in but the first screen is not built yet: the sting loops.
  const waitForFirstScreen = (status === 'authed' || status === 'reauth') && !homeReady

  if (booting) {
    return (
      <Splash
        progress={catalogProgress}
        intro
        waitFor={waitForFirstScreen}
        onDone={() => setIntroDone(true)}
      />
    )
  }

  let content: React.ReactNode

  // The app download page is public: it is how a phone gets the app in the first place.
  if (location.pathname === '/download') {
    content = (
      <Suspense fallback={<Splash />}>
        <DownloadPage />
      </Suspense>
    )
  } else if (status === 'anon') {
    content = (
      <Suspense fallback={<Splash />}>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    )
  } else {
    content = (
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
                    <Route path="/downloads" element={<DownloadsPage />} />
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
    </Suspense>
    )
  }

  return (
    <>
      {content}
      {showIntro ? (
        <Splash
          progress={catalogProgress}
          intro
          waitFor={waitForFirstScreen}
          onDone={() => setIntroDone(true)}
        />
      ) : null}
    </>
  )
}
