// Deterministic, dependency-free SVG artwork. Real subscribers get the panel's
// posters; the demo catalog (and covers missing artwork) uses these generated
// cinematic frames so no external image host is required.

const PALETTES: Array<[string, string, string]> = [
  ['#2b0a0c', '#0c0b12', '#e50914'],
  ['#0b1a2b', '#0a0a10', '#0071eb'],
  ['#2b1c05', '#0b0a0c', '#ff6b35'],
  ['#0d241c', '#080a0a', '#00e676'],
  ['#1d1030', '#0a0810', '#8b5cf6'],
  ['#2a0f1e', '#0a080d', '#ff3d81'],
  ['#241f0a', '#0a0a0a', '#ffd700'],
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const enc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

export function posterArt(title: string, seed = title): string {
  const h = hash(seed)
  const [a, b, accent] = PALETTES[h % PALETTES.length]
  const angle = (h % 40) - 20
  const initials = title
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  const label = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 26)
  const rings = [0, 1, 2].map((i) => {
    const r = 70 + i * 46 + (h % 30)
    return `<circle cx="${232 - (h % 60)}" cy="${300 + (h % 40)}" r="${r}" fill="none" stroke="${accent}" stroke-opacity="${0.16 - i * 0.04}" stroke-width="1"/>`
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1" gradientTransform="rotate(${angle} .5 .5)">
<stop offset="0" stop-color="${a}"/><stop offset="0.62" stop-color="${b}"/><stop offset="1" stop-color="#050505"/>
</linearGradient>
<radialGradient id="r" cx="0.7" cy="0.18" r="0.7"><stop offset="0" stop-color="${accent}" stop-opacity="0.5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="scrim" x1="0" y1="0.45" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#080808" stop-opacity="0.92"/></linearGradient>
</defs>
<rect width="400" height="600" fill="url(#g)"/>
<rect width="400" height="600" fill="url(#r)"/>
${rings.join('')}
<g opacity="0.14" stroke="#fff" stroke-width="1">
${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50 + 90}" y2="600"/>`).join('')}
</g>
<text x="40" y="250" font-family="Inter,Helvetica,Arial,sans-serif" font-size="120" font-weight="900" fill="#ffffff" fill-opacity="0.10" letter-spacing="-6">${initials || 'V'}</text>
<rect x="0" y="420" width="400" height="180" fill="url(#scrim)"/>
<rect x="32" y="430" width="34" height="3" fill="${accent}"/>
<text x="32" y="500" font-family="Inter,Helvetica,Arial,sans-serif" font-size="34" font-weight="800" fill="#ffffff" letter-spacing="-1">${label}</text>
<text x="32" y="530" font-family="Inter,Helvetica,Arial,sans-serif" font-size="15" font-weight="600" fill="#b3b3b3" letter-spacing="3">VNTERA</text>
</svg>`
  return enc(svg)
}

export function backdropArt(title: string, seed = title): string {
  const h = hash(seed)
  const [a, , accent] = PALETTES[(h + 2) % PALETTES.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.55" stop-color="#0b0b0f"/><stop offset="1" stop-color="#050505"/></linearGradient>
<radialGradient id="glow" cx="0.72" cy="0.28" r="0.55"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1600" height="900" fill="url(#bg)"/>
<rect width="1600" height="900" fill="url(#glow)"/>
<g stroke="#fff" stroke-opacity="0.07">
${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 140}" y1="900" x2="${700 + i * 90}" y2="0"/>`).join('')}
</g>
<g fill="none" stroke="${accent}" stroke-opacity="0.22">
<circle cx="1180" cy="300" r="180"/><circle cx="1180" cy="300" r="260"/><circle cx="1180" cy="300" r="340"/>
</g>
</svg>`
  return enc(svg)
}

export function channelArt(name: string): string {
  const h = hash(name)
  const [a, , accent] = PALETTES[h % PALETTES.length]
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient></defs>
<rect width="240" height="240" rx="18" fill="url(#c)"/>
<circle cx="196" cy="44" r="70" fill="${accent}" fill-opacity="0.18"/>
<text x="120" y="146" text-anchor="middle" font-family="Inter,Helvetica,Arial,sans-serif" font-size="74" font-weight="800" fill="#ffffff" fill-opacity="0.92" letter-spacing="-2">${initials || 'TV'}</text>
</svg>`
  return enc(svg)
}
