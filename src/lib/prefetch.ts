/**
 * Route prefetching.
 *
 * Every page is a lazy chunk, so a tap on a card used to mean: download the
 * chunk, parse it, then paint. Hovering or focusing a link is a strong signal
 * that it is about to be opened, so we warm that chunk while the finger is
 * still moving. The player chunk is deliberately excluded — it is the heavy
 * one and only worth fetching once the user has actually committed to a click.
 */

type Loader = () => Promise<unknown>

const CHUNKS: Record<string, Loader> = {
  home: () => import('../pages/HomePage'),
  live: () => import('../pages/LivePage'),
  movies: () => import('../pages/MoviesPage'),
  series: () => import('../pages/SeriesPage'),
  fresh: () => import('../pages/NewPopularPage'),
  library: () => import('../pages/MyListPage'),
  details: () => import('../pages/DetailsPage'),
  watch: () => import('../pages/WatchPage'),
  search: () => import('../pages/SearchPage'),
  collection: () => import('../pages/CollectionPage'),
  profile: () => import('../pages/ProfilePage'),
  notifications: () => import('../pages/NotificationsPage'),
}

/** Chunks too heavy to fetch on a whim; they need a real press. */
const PRESS_ONLY = new Set(['watch'])

const warmed = new Set<string>()

function chunkFor(pathname: string): string | null {
  if (pathname === '/' || pathname === '') return 'home'
  const head = pathname.split('/')[1]
  switch (head) {
    case 'live':
      return 'live'
    case 'movies':
      return 'movies'
    case 'series':
      return 'series'
    case 'new':
      return 'fresh'
    case 'my-list':
      return 'library'
    case 'title':
      return 'details'
    case 'watch':
      return 'watch'
    case 'search':
      return 'search'
    case 'collection':
      return 'collection'
    case 'profile':
      return 'profile'
    case 'notifications':
      return 'notifications'
    default:
      return null
  }
}

function dataSaver(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

/** Fetch the chunk behind a URL. Safe to call repeatedly; idle users cost nothing. */
export function warmRoute(url: string, { force = false } = {}): void {
  if (!navigator.onLine || dataSaver()) return
  const path = url.startsWith('/') ? url : new URL(url, location.href).pathname
  const chunk = chunkFor(path)
  if (!chunk || warmed.has(chunk)) return
  if (!force && PRESS_ONLY.has(chunk)) return
  warmed.add(chunk)
  void CHUNKS[chunk]().catch(() => warmed.delete(chunk))
}

function linkFrom(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.dataset.noPrefetch) return null
  const href = anchor.getAttribute('href') || ''
  if (!href.startsWith('/') || href.startsWith('//')) return null
  return anchor
}

/**
 * Listen once for intent: pointer hover, keyboard focus, and the moment a touch
 * lands. Returns the uninstaller so the shell can drop it on unmount.
 */
export function installRoutePrefetch(): () => void {
  const onHover = (event: PointerEvent) => {
    const anchor = linkFrom(event.target)
    if (anchor) warmRoute(anchor.getAttribute('href') || '')
  }
  const onPress = (event: PointerEvent | KeyboardEvent) => {
    const anchor = linkFrom(event.target)
    if (anchor) warmRoute(anchor.getAttribute('href') || '', { force: true })
  }
  const onFocus = (event: FocusEvent) => {
    const anchor = linkFrom(event.target)
    if (anchor) warmRoute(anchor.getAttribute('href') || '')
  }

  document.addEventListener('pointerover', onHover, { passive: true })
  document.addEventListener('pointerdown', onPress, { passive: true })
  document.addEventListener('focusin', onFocus)
  document.addEventListener('keydown', onPress)

  // Once the shell is up, quietly pull every page chunk. A tap that has to
  // fetch, parse and mount a chunk first paints the loading skeleton instead of
  // the page, which is the "route is stuck" moment; these are small split
  // chunks, so warming them while nothing is happening removes that wait
  // entirely and changes no markup.
  const idle = (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200))) as (
    cb: () => void,
  ) => number
  idle(() => {
    for (const path of ['/', '/live', '/movies', '/series', '/new', '/my-list', '/downloads', '/search', '/profile', '/notifications', '/title/']) {
      warmRoute(path)
    }
    // Phones never hover, so without this the player chunk only starts loading
    // after the tap lands — the most noticeable delay in the app.
    warmRoute('/watch/movie/', { force: true })
  })

  return () => {
    document.removeEventListener('pointerover', onHover)
    document.removeEventListener('pointerdown', onPress)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('keydown', onPress)
  }
}
