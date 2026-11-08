export type FormFactor = 'tv' | 'mobile' | 'tablet' | 'desktop'

const TV_UA = /(smart-?tv|smarttv|tizen|web0s|webos|netcast|hbbtv|appletv|googletv|android ?tv|bravia|roku|crkey|playstation|xbox|aft[bmst]|fire ?tv)/i
const TABLET_UA = /(ipad|tablet|playbook|silk|kindle)/i
const MOBILE_UA = /(iphone|ipod|android|blackberry|iemobile|opera mini|mobile)/i

/** The Android TV build bakes its form factor in: a TV WebView reports a
 *  generic "Linux; Android 12" agent that is indistinguishable from a phone. */
const BUILD_FORM = import.meta.env.VITE_FORCE_FORM as FormFactor | undefined

const FORM_KEY = 'vntera:form'
const FORMS: string[] = ['tv', 'mobile', 'tablet', 'desktop']

function asForm(value: string | null): FormFactor | null {
  return value && FORMS.includes(value) ? (value as FormFactor) : null
}

/**
 * A `?form=tv` link is how a television browser — which reports a phone user
 * agent — asks for the ten-foot layout. It used to last only until the first
 * route change, because the query is dropped on navigation and the next
 * detection called the same device a desktop: the hero lost its shortlist and
 * the shortcut column reappeared on the right. An explicit choice is remembered.
 */
function forcedForm(): FormFactor | null {
  if (BUILD_FORM === 'tv' || BUILD_FORM === 'mobile' || BUILD_FORM === 'tablet' || BUILD_FORM === 'desktop') {
    return BUILD_FORM
  }
  try {
    const asked = asForm(new URLSearchParams(window.location.search).get('form'))
    if (asked) {
      try {
        window.localStorage.setItem(FORM_KEY, asked)
      } catch {
        /* private mode: the address still works for this page */
      }
      return asked
    }
    return asForm(window.localStorage.getItem(FORM_KEY))
  } catch {
    return null
  }
}

/**
 * The form factor the shell has already applied.
 *
 * Components used to call detectFormFactor() themselves, which re-reads the URL
 * and the user agent. A TV that arrived on `/?form=tv` loses that query when it
 * signs in, so Home re-detected a desktop while the shell still painted the TV
 * layout — and the shortcut rail was hidden behind `lg:hidden`. Everything now
 * reads the applied value, so the whole page agrees with the shell.
 */
export function currentFormFactor(): FormFactor {
  if (typeof document !== 'undefined') {
    const applied = document.documentElement.dataset.formFactor
    if (applied === 'tv' || applied === 'mobile' || applied === 'tablet' || applied === 'desktop') {
      return applied
    }
  }
  return detectFormFactor()
}

export function detectFormFactor(): FormFactor {
  const forced = forcedForm()
  if (forced) return forced
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (TV_UA.test(ua)) return 'tv'
  if (TABLET_UA.test(ua)) return 'tablet'
  if (MOBILE_UA.test(ua)) return 'mobile'
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  if (touch && Math.min(window.innerWidth, window.innerHeight) >= 600) return 'tablet'
  if (touch) return 'mobile'
  return 'desktop'
}

export function applyFormFactor(form: FormFactor): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.formFactor = form
  document.documentElement.dataset.input = form === 'tv' ? 'spatial' : 'pointer'
}

export function isTVEnvironment(): boolean {
  return detectFormFactor() === 'tv'
}

/** True inside the packaged app shell (Capacitor's WebView), not a normal browser. */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; platform?: string; getPlatform?: () => string }
    }
  ).Capacitor
  if (!capacitor) return false
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform()
  const platform = capacitor.platform ?? capacitor.getPlatform?.()
  return platform === 'android' || platform === 'ios'
}

/** True when the container can hand playback off to a remote device. */
export function canCastVideo(video: HTMLVideoElement | null): boolean {
  if (!video) return false
  return 'remote' in video || 'webkitShowPlaybackTargetPicker' in video
}

export async function startCast(video: HTMLVideoElement): Promise<void> {
  const remote = (video as HTMLVideoElement & { remote?: { prompt: () => Promise<void> } }).remote
  if (remote?.prompt) {
    await remote.prompt()
    return
  }
  const webkit = video as HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }
  if (webkit.webkitShowPlaybackTargetPicker) {
    webkit.webkitShowPlaybackTargetPicker()
    return
  }
  throw new Error('Casting is unavailable in this container.')
}

// ---------------------------------------------------------------------------
// D-pad spatial navigation for TV / 10-foot surfaces.
// Arrow keys move focus to the geometrically nearest focusable element; the
// layout never shifts because the ring is a shadow transform.
// ---------------------------------------------------------------------------

const NAV_SELECTOR = '[data-nav="true"]:not([disabled]):not([aria-hidden="true"])'

interface NavItem {
  el: HTMLElement
  rect: DOMRect
}

/**
 * One pass over the page per key press is what made a remote feel slow. A TV
 * home page carries a few hundred targets, and every one of them used to cost a
 * getBoundingClientRect plus a getComputedStyle — a forced style recalc — before
 * the nearest one could even be scored. The list and its geometry are measured
 * once and reused until something moves: the page scrolls, a rail mounts cards,
 * or a route changes.
 */
let navCache: { at: number; x: number; y: number; items: NavItem[] } | null = null
/** Geometry goes stale on scroll; the clock only bounds a page that never moves. */
const NAV_CACHE_MS = 1_500

export function invalidateSpatialCache(): void {
  navCache = null
}

function collectNav(): NavItem[] {
  const at = performance.now()
  const x = window.scrollX
  const y = window.scrollY
  if (navCache && navCache.x === x && navCache.y === y && at - navCache.at < NAV_CACHE_MS) {
    return navCache.items
  }

  const items: NavItem[] = []
  for (const el of document.querySelectorAll<HTMLElement>(NAV_SELECTOR)) {
    // Floating layers (toasts) sit on top of the page and vanish on their own;
    // the remote must be able to pass beneath them without stopping.
    if (el.closest('[data-nav-ignore="true"]')) continue
    if (el.hasAttribute('hidden')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= 0.05) continue
    items.push({ el, rect })
  }

  navCache = { at, x, y, items }
  return items
}

function focusables(): HTMLElement[] {
  return collectNav().map((item) => item.el)
}

type Direction = 'up' | 'down' | 'left' | 'right'

function center(el: Element) {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }
}

function pickNext(current: HTMLElement, dir: Direction, items: NavItem[] = collectNav()): HTMLElement | null {
  const from = center(current)
  let best: { el: HTMLElement; score: number } | null = null

  for (const entry of items) {
    const candidate = entry.el
    if (candidate === current || current.contains(candidate)) continue
    const to = { x: entry.rect.left + entry.rect.width / 2, y: entry.rect.top + entry.rect.height / 2, r: entry.rect }
    const dx = to.x - from.x
    const dy = to.y - from.y

    let primary: number
    let secondary: number
    switch (dir) {
      case 'right':
        if (dx <= 4) continue
        primary = dx
        secondary = Math.abs(dy)
        break
      case 'left':
        if (dx >= -4) continue
        primary = -dx
        secondary = Math.abs(dy)
        break
      case 'down':
        if (dy <= 4) continue
        primary = dy
        secondary = Math.abs(dx)
        break
      case 'up':
        if (dy >= -4) continue
        primary = -dy
        secondary = Math.abs(dx)
        break
    }

    // Prefer elements aligned with the current axis; penalise diagonal jumps.
    const overlap =
      dir === 'left' || dir === 'right'
        ? Math.max(0, Math.min(from.r.bottom, to.r.bottom) - Math.max(from.r.top, to.r.top))
        : Math.max(0, Math.min(from.r.right, to.r.right) - Math.max(from.r.left, to.r.left))
    const score = primary + secondary * 2.4 - overlap * 0.8
    if (!best || score < best.score) best = { el: candidate, score }
  }
  return best?.el ?? null
}

function markFocused(el: HTMLElement | null) {
  document.querySelectorAll('.is-focused').forEach((n) => n.classList.remove('is-focused'))
  el?.classList.add('is-focused')
}

export interface SpatialOptions {
  enabled: boolean
  onBack: () => void
}

export function installSpatialNavigation(opts: SpatialOptions): () => void {
  if (typeof document === 'undefined') return () => undefined

  const onFocusIn = (e: FocusEvent) => {
    // Only the 10-foot surface paints a focus ring; a tap on a phone must not.
    if (document.documentElement.dataset.formFactor !== 'tv') return
    const target = e.target as HTMLElement | null
    if (target?.matches?.(NAV_SELECTOR)) markFocused(target)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    markFocused(document.activeElement as HTMLElement | null)

    if (event.key === 'Escape' || (event.key === 'Backspace' && !(event.target as HTMLElement)?.matches('input, textarea'))) {
      const modal = document.querySelector('[data-modal="true"]')
      if (modal) {
        event.preventDefault()
        ;(modal as HTMLElement).dispatchEvent(new CustomEvent('vntera:close', { bubbles: true }))
        return
      }
      if (!opts.enabled) return
      event.preventDefault()
      opts.onBack()
      return
    }

    if (!opts.enabled) return

    const active = document.activeElement as HTMLElement | null
    const typing = active?.matches('input, textarea, select, [contenteditable="true"]')

    if (event.key === 'Enter') {
      if (active && !typing && active.matches(NAV_SELECTOR)) {
        event.preventDefault()
        active.click()
      }
      return
    }

    const dirMap: Record<string, Direction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const dir = dirMap[event.key]
    if (!dir) return

    // Text fields keep caret navigation — except at the edge of the value. A
    // remote has no pointer, so "Show password" beside the field was
    // unreachable: every horizontal press inside the field only moved the caret.
    if (typing && (dir === 'left' || dir === 'right')) {
      const field = active as HTMLInputElement | HTMLTextAreaElement | null
      const caret = field?.selectionStart ?? 0
      const end = field?.selectionEnd ?? 0
      const length = field?.value?.length ?? 0
      const atEdge = dir === 'left' ? caret === 0 && end === 0 : caret === length && end === length
      // Not at the edge: let the caret move, which is what typing expects.
      if (!atEdge) return
    }

    const current = active?.matches(NAV_SELECTOR) ? active : focusables()[0]
    if (!current) return
    const next = current === active ? pickNext(current, dir) : current
    if (next) {
      event.preventDefault()
      next.focus({ preventScroll: false })
      next.classList.add('is-focused')
      // Instant, not smooth: a smooth scroll paints over several frames and the
      // remote then feels like it lags behind every press.
      next.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
      invalidateSpatialCache()
    }
  }

  // Anything that can move a target drops the measured list.
  const onScroll = () => invalidateSpatialCache()
  const observer = new MutationObserver(() => invalidateSpatialCache())
  observer.observe(document.body, { childList: true, subtree: true })

  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', onScroll, true)
  return () => {
    observer.disconnect()
    window.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('keydown', onKeyDown, true)
  }
}

export function focusFirstNav(): void {
  const first = focusables()[0]
  if (first) {
    first.focus({ preventScroll: true })
    markFocused(first)
  }
}

export function scrollRail(node: HTMLElement, direction: 1 | -1): void {
  const amount = Math.max(240, node.clientWidth * 0.78)
  node.scrollBy({ left: amount * direction, behavior: 'smooth' })
}
