/**
 * Flexbox `gap` for engines that never applied it (Chrome < 84).
 *
 * The compatibility stylesheet can lower almost everything, but `gap` has no CSS
 * equivalent: emulating it with margins needs the flex direction, which CSS
 * cannot ask for. On those engines every row the design spaces with a gap
 * collapses — the play icon touches "Sign in", the remote hint runs into its key
 * cap — so the spacing is applied here instead.
 *
 * Those engines still *parse* `gap` and report it from `getComputedStyle`, they
 * simply do not honour it, which means the exact value is available: margins are
 * applied from the computed gap, for every flex container, including the ones
 * spaced by component CSS rather than a utility class. A text node cannot carry
 * a margin, so an element followed by text gets the space as a trailing margin
 * instead. Only runs on the legacy path, and only where a measurement shows the
 * property is not honoured.
 */

const OWNED = new WeakMap<HTMLElement, { prop: 'marginLeft' | 'marginTop' | 'marginRight'; value: number }>()

/** True only when a flex row with `gap` really separates its children. */
function flexGapWorks(): boolean {
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:0;display:flex;gap:17px;width:200px;height:20px'
  const a = document.createElement('i')
  const b = document.createElement('i')
  a.style.cssText = b.style.cssText = 'display:block;width:20px;height:20px'
  host.append(a, b)
  document.body.appendChild(host)
  const separated = b.getBoundingClientRect().left - a.getBoundingClientRect().right > 15
  host.remove()
  return separated
}

const PROPS = { marginLeft: 'margin-left', marginTop: 'margin-top', marginRight: 'margin-right' } as const

function clearOwned(child: HTMLElement) {
  const owned = OWNED.get(child)
  if (!owned) return
  child.style.setProperty(PROPS[owned.prop], '')
  OWNED.delete(child)
}

function space(child: HTMLElement, prop: keyof typeof PROPS, value: number) {
  const owned = OWNED.get(child)
  if (owned && owned.prop !== prop) clearOwned(child)
  if (value <= 0) {
    clearOwned(child)
    return
  }
  if (!OWNED.has(child)) {
    // A child the page already spaced itself (auto margins, explicit offsets) is
    // not ours to move.
    const current = getComputedStyle(child)[prop]
    if (current !== '0px') return
  }
  child.style.setProperty(PROPS[prop], `${value}px`)
  OWNED.set(child, { prop, value })
}

/** Text that is actually rendered, so whitespace-only nodes are ignored. */
function hasText(node: Node | null): boolean {
  return Boolean(node && node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim())
}

/**
 * Every flex container in the app is either spaced by a Tailwind `flex`
 * utility or by one of the component classes above (`.rail` sets its gap in
 * index.css). Scanning only these keeps the pass cheap with 300 posters on
 * screen; anything else is picked up through its parent when it mounts.
 */
const CONTAINERS =
  '[class*="flex"], .btn, .icon-btn, .badge, .provider-chip, .rail, .rail-lead, .tv-rail, .tv-rail-group, .tv-rail-item, .tv-rail-logo, .tv-hero-side, .app-nav'

function applyAll(scope: ParentNode = document.body) {
  const root = document.documentElement
  if (!root.hasAttribute('data-legacy-css')) return

  const list: Element[] = []
  if (scope instanceof Element && scope.matches(CONTAINERS)) list.push(scope)
  list.push(...scope.querySelectorAll(CONTAINERS))

  for (const container of list as HTMLElement[]) {
    const style = getComputedStyle(container)
    if (style.display !== 'flex' && style.display !== 'inline-flex') continue

    const row = style.flexDirection.startsWith('row')
    const spacing = Number.parseFloat(row ? style.columnGap : style.rowGap) || 0
    if (!spacing) continue

    // `space-x`/`space-y` already space children with margins of their own.
    if ([...container.classList].some((name) => /^space-[xy]-/.test(name))) continue

    let index = 0
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (getComputedStyle(child).display === 'none') continue
      if (index === 0) {
        // First child: no leading space, but if text follows it directly the gap
        // belongs on its trailing edge.
        clearOwned(child)
        if (row && hasText(child.nextSibling)) space(child, 'marginRight', spacing)
      } else if (!hasText(child.previousSibling)) {
        // Already separated from the text before it by that node's margin.
        space(child, row ? 'marginLeft' : 'marginTop', spacing)
      } else {
        clearOwned(child)
      }
      index += 1
    }
  }
}

/** Installs the polyfill; a no-op on any engine with real flex gaps. */
export function installLegacyGapFix(): void {
  if (typeof window === 'undefined' || !document.documentElement.hasAttribute('data-legacy-css')) return
  if (flexGapWorks()) return

  let scheduled = 0
  const pending = new Set<Element>()
  const flush = () => {
    scheduled = 0
    // Rails mount in stages and filtering swaps cards, so only the subtrees that
    // actually changed are re-spaced.
    if (!pending.size) {
      applyAll()
      return
    }
    for (const node of pending) {
      applyAll(node.isConnected ? node : document.body)
      if (node.parentElement) applyAll(node.parentElement)
    }
    pending.clear()
  }
  const schedule = (nodes: Node[] = []) => {
    for (const node of nodes) if (node.nodeType === Node.ELEMENT_NODE) pending.add(node as Element)
    if (scheduled) return
    scheduled = window.requestAnimationFrame(flush)
  }

  applyAll()
  const observer = new MutationObserver((records) => {
    const added: Node[] = []
    for (const record of records) added.push(...Array.from(record.addedNodes))
    schedule(added)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // Layout flips direction at breakpoints, so the whole page is re-spaced.
  let resizeTimer = 0
  window.addEventListener(
    'resize',
    () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => schedule(), 200)
    },
    { passive: true },
  )
}
