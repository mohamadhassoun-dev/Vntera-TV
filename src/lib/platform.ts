export type FormFactor = 'tv' | 'mobile' | 'tablet' | 'desktop'

const TV_UA = /(smart-?tv|smarttv|tizen|web0s|webos|netcast|hbbtv|appletv|googletv|android ?tv|bravia|roku|crkey|playstation|xbox|aft[bmst]|fire ?tv)/i
const TABLET_UA = /(ipad|tablet|playbook|silk|kindle)/i
const MOBILE_UA = /(iphone|ipod|android|blackberry|iemobile|opera mini|mobile)/i

function forcedForm(): FormFactor | null {
  try {
    const v = new URLSearchParams(window.location.search).get('form')
    return v === 'tv' || v === 'mobile' || v === 'tablet' || v === 'desktop' ? v : null
  } catch {
    return null
  }
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

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('hidden')) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(NAV_SELECTOR)).filter(isVisible)
}

type Direction = 'up' | 'down' | 'left' | 'right'

function center(el: Element) {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }
}

function pickNext(current: HTMLElement, dir: Direction): HTMLElement | null {
  const from = center(current)
  let best: { el: HTMLElement; score: number } | null = null

  for (const candidate of focusables()) {
    if (candidate === current || current.contains(candidate)) continue
    const to = center(candidate)
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

    // Text fields keep caret navigation.
    if (typing && (dir === 'left' || dir === 'right')) return

    const current = active?.matches(NAV_SELECTOR) ? active : focusables()[0]
    if (!current) return
    const next = current === active ? pickNext(current, dir) : current
    if (next) {
      event.preventDefault()
      next.focus({ preventScroll: false })
      next.classList.add('is-focused')
      next.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }

  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
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
