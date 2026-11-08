/**
 * Builds the stylesheet older Android WebViews can actually parse.
 *
 * Tailwind v4 emits CSS that assumes a 2023+ engine: cascade layers (`@layer`),
 * `color-mix()`, `:where()` and `svh` units. An Android TV's system WebView is
 * often years behind — a sideloaded APK cannot update it — and an engine that
 * does not understand `@layer` drops *everything* inside those blocks, which is
 * the whole design system. The page then renders as unstyled markup: the login
 * wallpaper at full width with the form below it, which is what a "cracked app"
 * on a TV looks like.
 *
 * This produces the same rules with those four constructs lowered:
 *   - layers flattened (source order is preserved, so the cascade is unchanged),
 *   - `color-mix(<space>, C p%, transparent)` → the same colour as `rgba()`
 *     (mixing with transparent is exactly alpha scaling),
 *   - `svh`/`dvh` heights backed by `vh`,
 *   - `:where()` with a single alternative inlined into the selector.
 *
 * The modern sheet stays the default; index.html only loads this one when the
 * engine cannot do `color-mix()`.
 */
import postcss from 'postcss'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** #abc / #aabbcc / #aabbccdd → [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  let value = hex.slice(1)
  if (value.length === 3 || value.length === 4) {
    value = value
      .split('')
      .slice(0, 3)
      .map((c) => c + c)
      .join('')
  }
  const int = Number.parseInt(value.slice(0, 6), 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

/** Colour tokens declared by the theme, so `var(--color-x)` can be resolved. */
function themeColours(css: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of css.matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) {
    if (!map.has(match[1])) map.set(match[1], match[2])
  }
  return map
}

const MIX =
  /color-mix\(\s*in\s+(?:oklab|oklch|srgb|srgb-linear|lab|lch|hsl)\s*,\s*([^,()]+?|var\([^)]*\))\s+([\d.]+)%\s*,\s*transparent\s*\)/gi

/** One match, parsed without touching the global pattern's lastIndex. */
const MIX_ONE =
  /^color-mix\(\s*in\s+(?:oklab|oklch|srgb|srgb-linear|lab|lch|hsl)\s*,\s*([^,()]+?|var\([^)]*\))\s+([\d.]+)%\s*,\s*transparent\s*\)$/i

/** `color-mix(..., C p%, transparent)` == `C` at alpha p%. Undefined when C is unknown. */
function lowerMix(match: string, colours: Map<string, string>): string | null {
  const parsed = MIX_ONE.exec(match.trim())
  if (!parsed) return null
  const [, raw, percent] = parsed
  let colour = raw.trim()
  const fallback = colour.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(#[0-9a-fA-F]{3,8}))?\s*\)$/i)
  if (fallback) colour = colours.get(fallback[1]) ?? fallback[2] ?? ''
  if (!HEX.test(colour)) return null
  const [r, g, b] = hexToRgb(colour)
  const alpha = Math.round((Number(percent) / 100) * 1000) / 1000
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * `:where(a)` / `:is(a)` → `a`; leaves the two-alternative forms alone, because
 * splitting them would change which elements match.
 */
function unwrapSingleArg(selector: string): string {
  let out = ''
  let i = 0
  while (i < selector.length) {
    const lower = selector.toLowerCase()
    const whereAt = lower.indexOf(':where(', i)
    const isAt = lower.indexOf(':is(', i)
    const candidates = [whereAt, isAt].filter((at) => at >= 0)
    const at = candidates.length ? Math.min(...candidates) : -1
    if (at < 0) {
      out += selector.slice(i)
      break
    }
    out += selector.slice(i, at)
    const start = at + (lower.startsWith(':where(', at) ? ':where('.length : ':is('.length)
    let depth = 1
    let end = start
    while (end < selector.length && depth > 0) {
      if (selector[end] === '(') depth += 1
      else if (selector[end] === ')') depth -= 1
      end += 1
    }
    const inner = selector.slice(start, end - 1)
    let topLevelComma = false
    let parens = 0
    for (const char of inner) {
      if (char === '(') parens += 1
      else if (char === ')') parens -= 1
      else if (char === ',' && parens === 0) topLevelComma = true
    }
    out += topLevelComma ? selector.slice(at, end) : inner
    i = end
  }
  return out
}

/** The whole value as concrete colours, or null when something cannot resolve. */
function lowerColourFunctions(value: string, colours: Map<string, string>): string | null {
  let unresolved = false
  const lowered = value.replace(MIX, (match) => {
    const colour = lowerMix(match, colours)
    if (!colour) {
      unresolved = true
      return match
    }
    return colour
  })
  if (unresolved) return null
  // Anything else an old engine cannot parse is not worth shipping at all.
  if (/oklch\(|oklab\(|\blab\(|\blch\(/i.test(lowered)) return null
  return lowered
}

/**
 * `select:is([multiple],[size])` → `select[multiple], select[size]`, so no rule
 * depends on a selector function the engine may not have.
 */
function expandSelectorFunctions(selector: string): string {
  const isAt = selector.indexOf(':is(')
  const whereAt = selector.indexOf(':where(')
  const candidates = [isAt, whereAt].filter((index) => index >= 0)
  if (!candidates.length) return selector
  const at = Math.min(...candidates)
  const offset = selector.startsWith(':where(', at) ? 7 : 4
  let depth = 1
  let end = at + offset
  while (end < selector.length && depth > 0) {
    if (selector[end] === '(') depth += 1
    else if (selector[end] === ')') depth -= 1
    end += 1
  }
  const inner = selector.slice(at + offset, end - 1)
  const alternatives: string[] = []
  let parens = 0
  let buf = ''
  for (const char of inner) {
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    if (char === ',' && parens === 0) {
      alternatives.push(buf.trim())
      buf = ''
      continue
    }
    buf += char
  }
  alternatives.push(buf.trim())
  if (alternatives.length < 2) return selector
  const prefix = selector.slice(0, at)
  const suffix = selector.slice(end)
  return alternatives
    .map((alternative) => expandSelectorFunctions(`${prefix}${alternative}${suffix}`))
    .join(', ')
}

/** Split a shorthand on top-level spaces only, so `calc(a * 2)` stays whole. */
function splitValues(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let buf = ''
  for (const char of value.trim()) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (buf) parts.push(buf)
      buf = ''
      continue
    }
    buf += char
  }
  if (buf) parts.push(buf)
  return parts.length ? parts : [value.trim()]
}

/**
 * `padding-inline: a b` → left/right. Tailwind v4 writes its spacing utilities
 * with logical shorthands, which arrived after the engines this sheet targets;
 * dropped, they silently remove every gutter on the page.
 */
function expandLogicalShorthand(decl: postcss.Declaration): boolean {
  const pairs: Record<string, [string, string, string, string]> = {
    'padding-inline': ['padding-left', 'padding-right', 'padding-top', 'padding-bottom'],
    'padding-block': ['padding-top', 'padding-bottom', 'padding-left', 'padding-right'],
    'margin-inline': ['margin-left', 'margin-right', 'margin-top', 'margin-bottom'],
    'margin-block': ['margin-top', 'margin-bottom', 'margin-left', 'margin-right'],
  }
  const sides = pairs[decl.prop]
  if (!sides) return false
  const [start, end = start] = splitValues(decl.value)
  decl.prop = sides[0]
  decl.value = start
  decl.cloneAfter({ prop: sides[1], value: end })
  return true
}

/** `inset: a b` → four sides, `inset-inline`/`inset-block` → their pair. */
function expandInset(decl: postcss.Declaration): void {
  const [top, right = top, bottom = top, left = right] = splitValues(decl.value)
  const sides: Array<[string, string]> =
    decl.prop === 'inset-inline'
      ? [
          ['left', left],
          ['right', right],
        ]
      : decl.prop === 'inset-block'
        ? [
            ['top', top],
            ['bottom', bottom],
          ]
        : [
            ['top', top],
            ['right', right],
            ['bottom', bottom],
            ['left', left],
          ]
  const first = sides[0]
  decl.prop = first[0]
  decl.value = first[1]
  sides.slice(1).forEach(([prop, value]) => decl.cloneAfter({ prop, value }))
}

/**
 * `aspect-ratio` arrived in engines that still lack it on some TVs. The three
 * fixed ratios the app uses get the padding-box equivalent, only where the real
 * property is unsupported, so a modern engine is untouched.
 */
const ASPECT_FALLBACKS: Array<{ className: string; ratio: string; percent: string }> = [
  { className: '.aspect-\\[2\\/3\\]', ratio: '2 / 3', percent: '150%' },
  { className: '.aspect-square', ratio: '1 / 1', percent: '100%' },
  { className: '.aspect-video', ratio: '16 / 9', percent: '56.25%' },
]

function aspectFallbackCss(): string {
  return ASPECT_FALLBACKS.map(
    ({ className, ratio, percent }) =>
      `@supports not (aspect-ratio: ${ratio}){${className}{height:0;padding-top:${percent}}` +
      `${className}>*{position:absolute;top:0;left:0;width:100%;height:100%}}`,
  ).join('\n')
}

const VIEWPORT_UNIT = /(-?\d*\.?\d+)(svh|dvh|svw|dvw|lvh|lvw)\b/g

function toViewportUnits(value: string): string {
  return value.replace(VIEWPORT_UNIT, (_, size: string, unit: string) => `${size}${unit.endsWith('w') ? 'vw' : 'vh'}`)
}

/** Same rules, lowered so an older engine keeps them. */
export function toLegacyCss(css: string): string {
  const colours = themeColours(css)
  const root = postcss.parse(css)
  let dropped = 0

  root.walkAtRules('layer', (atRule) => {
    // `@layer a, b;` only declares order; the flattened sheet needs nothing.
    if (!atRule.nodes) {
      atRule.remove()
      return
    }
    // Unwrap in place: the sheet's own order already encodes the cascade.
    atRule.replaceWith(...atRule.nodes)
  })

  // `@property` registrations are a modern-engine nicety; the compatibility
  // sheet carries the same defaults as plain custom properties on `*`.
  root.walkAtRules('property', (atRule) => {
    atRule.remove()
  })

  // `@supports` blocks that only restate variable defaults become plain rules:
  // an engine may evaluate the condition oddly, and the declarations are the
  // same either way.
  root.walkAtRules('supports', (atRule) => {
    const params = atRule.params || ''
    if (params.includes('aspect-ratio') || !atRule.nodes) return
    atRule.replaceWith(...atRule.nodes)
  })

  root.walkRules((rule) => {
    // `:is(:where(.group):hover …)` needs more than one pass: unwrapping the
    // outer match jumps past the one it contains.
    let selector = rule.selector
    for (let pass = 0; pass < 6; pass += 1) {
      const next = unwrapSingleArg(selector)
      if (next === selector) break
      selector = next
    }
    // Anything still holding `:is(a, b)` is expanded into the equivalent list so
    // no rule depends on a selector function the engine may lack.
    rule.selector = expandSelectorFunctions(selector)
  })

  root.walkDecls((decl) => {
    const original = decl.value

    if (/\d(svh|dvh|svw|dvw|\d*lvh|lvw)\b/.test(original)) {
      // Plain viewport units only: the modern ones are dropped here, not kept.
      decl.value = toViewportUnits(original)
    }

    if (original.includes('color-mix(') || /oklch\(|oklab\(|\blab\(|\blch\(/i.test(original)) {
      const lowered = lowerColourFunctions(original, colours)
      if (lowered === null) {
        // Nothing sensible to fall back to: drop it here rather than ship a
        // declaration an old engine discards mid-property.
        dropped += 1
        decl.remove()
        return
      }
      // Replace, never clone: the modern sheet keeps the mix, this one must not
      // contain it at all.
      decl.value = lowered
    }

    if (expandLogicalShorthand(decl)) return

    if (decl.prop === 'inset' || decl.prop === 'inset-inline' || decl.prop === 'inset-block') {
      expandInset(decl)
    }
  })

  // Rules that still rely on a selector an old engine lacks are removed rather
  // than left to fail: `:has()` only hides an empty rail, which React already
  // omits, and an unrunnable rule is noise.
  root.walkRules((rule) => {
    if (/:has\(/i.test(rule.selector)) rule.remove()
  })

  // A `@supports` whose condition mentions a modern colour function would be
  // skipped wholesale on an old engine; its contents are either empty or the
  // fallback we already ship.
  root.walkAtRules('supports', (atRule) => {
    if (/color-mix|oklch|oklab/i.test(atRule.params)) {
      atRule.remove()
    }
  })

  const output = `${root.toString()}\n${aspectFallbackCss()}\n`

  // Ship nothing an old engine would choke on: the build fails loudly instead of
  // producing a sheet that silently loses declarations. Values and selectors are
  // checked separately — an escaped class name such as `.h-[46svh]` is text, not
  // a unit the engine has to parse.
  const problems: string[] = []
  const audit = postcss.parse(output)
  audit.walkAtRules((atRule) => {
    if (atRule.name === 'layer' || atRule.name === 'property') problems.push(`@${atRule.name}`)
    if (atRule.name === 'supports' && /color-mix|oklch|oklab/i.test(atRule.params)) problems.push('@supports colour test')
  })
  audit.walkRules((rule) => {
    if (/:where\(|:is\(|:has\(/i.test(rule.selector)) problems.push(`selector ${rule.selector.slice(0, 40)}`)
  })
  audit.walkDecls((decl) => {
    if (decl.prop.startsWith('--tw-inset')) return
    if (/color-mix\(/i.test(decl.value)) problems.push(`colour in ${decl.prop}`)
    if (/oklch\(|oklab\(|\blab\(|\blch\(/i.test(decl.value)) problems.push(`lab colour in ${decl.prop}`)
    if (/\d(svh|dvh)\b/.test(decl.value)) problems.push(`viewport unit in ${decl.prop}`)
    if (decl.prop === 'inset') problems.push('inset shorthand')
    if (/^(padding|margin)-(inline|block)$/.test(decl.prop)) problems.push(`${decl.prop} shorthand`)
  })
  if (problems.length) {
    throw new Error(`legacy stylesheet still contains ${[...new Set(problems)].slice(0, 6).join(', ')}`)
  }
  return output
}

export interface LegacySheet {
  modernHref: string
  legacyHref: string
  legacyBytes: number
}

/** Rewrites index.html so the engine picks the sheet it can parse. */
export function writeLegacySheet(distDir: string): LegacySheet {
  const htmlPath = join(distDir, 'index.html')
  const html = readFileSync(htmlPath, 'utf8')
  const link = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"[^>]*>/i)
  if (!link) throw new Error('no stylesheet link in index.html')

  const modernHref = link[1]
  const modernPath = join(distDir, modernHref.replace(/^\//, ''))
  const legacyCss = toLegacyCss(readFileSync(modernPath, 'utf8'))
  // Its own content hash: the modern sheet's name can stay the same while this
  // one changes, and a TV that cached the previous copy would never refresh.
  const digest = createHash('sha256').update(legacyCss).digest('hex').slice(0, 8)
  const legacyHref = `/assets/legacy-${digest}.css`
  writeFileSync(join(distDir, legacyHref.replace(/^\//, '')), legacyCss)

  // Inline, before the body parses: the choice has to be made before the first
  // paint, and a modern engine keeps exactly the sheet it had before.
  const loader = `<script>
      (function () {
        var modern = ${JSON.stringify(modernHref)}, legacy = ${JSON.stringify(legacyHref)};
        var ok = false;
        try { ok = !!(window.CSS && CSS.supports && CSS.supports('color', 'color-mix(in oklab, red, blue)')); } catch (e) {}
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.crossOrigin = 'anonymous';
        link.href = ok ? modern : legacy;
        document.head.appendChild(link);
        if (!ok) document.documentElement.setAttribute('data-legacy-css', '');

        // Last resort: an engine older than even the compatibility sheet renders
        // nothing recognisable, so say so in markup that cannot depend on CSS.
        window.addEventListener('load', function () {
          var applied = '';
          try { applied = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(); } catch (e) {}
          if (applied) return;
          var note = document.createElement('div');
          note.setAttribute('role', 'alert');
          note.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:16px 20px;' +
            'background:#131313;color:#fff;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
            'border-top:2px solid #e50914';
          note.textContent = 'This device\\'s web view is too old to draw the app. Open the Play Store on this TV, ' +
            'update "Android System WebView" (or "Chrome"), then reopen Vntera.';
          document.body.appendChild(note);
        });
      })();
    </script>`

  writeFileSync(htmlPath, html.replace(link[0], loader))
  return { modernHref, legacyHref, legacyBytes: legacyCss.length }
}
