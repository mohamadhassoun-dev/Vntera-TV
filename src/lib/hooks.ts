import { useCallback, useEffect, useRef, useState } from 'react'

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = () => setMatches(mql.matches)
    handler()
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return matches
}

export function useScrolledPast(threshold = 12): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return past
}

/** Pull-to-refresh for touch surfaces (content is cached, so this is a real
 *  provider refresh, not a page reload). */
export function usePullToRefresh(onRefresh: () => Promise<unknown>, enabled = true) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  /** Last painted pull distance, so a drag repaints in steps instead of per pixel. */
  const painted = useRef(0)
  const THRESHOLD = 72

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled || window.scrollY > 0 || refreshing) return
      startY.current = e.touches[0]?.clientY ?? null
    },
    [enabled, refreshing],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (startY.current == null || refreshing) return
      const delta = (e.touches[0]?.clientY ?? 0) - startY.current
      if (delta <= 0 || window.scrollY > 0) return
      const next = Math.min(120, delta * 0.55)
      // Re-rendering the whole page on every touchmove is what made the first
      // drag feel sticky; 8px steps are invisible but eight times cheaper.
      if (Math.abs(next - painted.current) < 8) return
      painted.current = next
      setPull(next)
    },
    [refreshing],
  )

  const onTouchEnd = useCallback(async () => {
    if (pull >= THRESHOLD) {
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    }
    setPull(0)
    painted.current = 0
    startY.current = null
  }, [onRefresh, pull])

  return { pull, refreshing, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}

export function useWakeLock(active: boolean) {
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null
    if (!active || !('wakeLock' in navigator)) return
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock
      ?.request('screen')
      .then((s) => {
        sentinel = s
      })
      .catch(() => undefined)
    return () => {
      void sentinel?.release().catch(() => undefined)
    }
  }, [active])
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
