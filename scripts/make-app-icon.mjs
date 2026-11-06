/**
 * Renders the app mark on a cinema backdrop.
 *
 *   npm run app-icon
 *
 * The mark is the shipped artwork with its black plate turned transparent, so it
 * sits on the background instead of on a black square, and it is drawn larger
 * than before. One render feeds the web icons, the Windows installer icon and
 * every Android launcher density (flat, round, adaptive background and
 * foreground).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The mark itself, kept apart from the rendered icons so re-running this script
// always starts from the same artwork instead of from its own output.
const source = join(root, 'assets', 'icon-mark.png')
const ANDROID = join(root, 'android', 'app', 'src', 'main', 'res')

/** The art with its black plate removed, ready to sit on any background. */
async function markLayer() {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    // The plate is pure black and the art is lit, so the key is a hard cut:
    // a soft ramp leaves the film strip half see-through, which reads as a
    // ghost on the backdrop instead of a logo on it.
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    out[i + 3] = luma <= 24 ? 0 : 255
  }
  // Trim the transparent border so the mark itself can be drawn larger.
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 6 })
    .png()
    .toBuffer()
}

/** Cinema backdrop: warm light, poster grid and film perforations. */
function backdropSvg(size) {
  const cell = size / 7
  const posters = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 7; col++) {
      const x = col * cell + cell * 0.12
      const y = row * cell * 1.35 + size * 0.06
      const w = cell * 0.76
      const h = cell * 1.04
      const shade = 0.08 + ((row + col) % 3) * 0.045
      posters.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(w * 0.07).toFixed(1)}" fill="#ffffff" fill-opacity="${shade.toFixed(3)}"/>`,
      )
    }
  }
  const holes = []
  const holeW = size * 0.035
  const holeH = size * 0.026
  for (let i = 0; i < 14; i++) {
    const y = (size / 14) * i + size * 0.012
    holes.push(
      `<rect x="${(size * 0.012).toFixed(1)}" y="${y.toFixed(1)}" width="${holeW.toFixed(1)}" height="${holeH.toFixed(1)}" rx="${(holeH * 0.25).toFixed(1)}" fill="#000" fill-opacity="0.45"/>`,
      `<rect x="${(size - size * 0.012 - holeW).toFixed(1)}" y="${y.toFixed(1)}" width="${holeW.toFixed(1)}" height="${holeH.toFixed(1)}" rx="${(holeH * 0.25).toFixed(1)}" fill="#000" fill-opacity="0.45"/>`,
    )
  }
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stop-color="#7a0710"/>
          <stop offset="52%" stop-color="#2a0306"/>
          <stop offset="100%" stop-color="#050506"/>
        </radialGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.10"/>
          <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <radialGradient id="core" cx="50%" cy="50%" r="52%">
          <stop offset="0%" stop-color="#07070a" stop-opacity="0.97"/>
          <stop offset="62%" stop-color="#07070a" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#07070a" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="vignette" cx="50%" cy="50%" r="62%">
          <stop offset="58%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.8"/>
        </radialGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#glow)"/>
      ${posters.join('')}
      <rect width="${size}" height="${size}" fill="url(#beam)"/>
      ${holes.join('')}
      <rect width="${size}" height="${size}" fill="url(#core)"/>
      <rect width="${size}" height="${size}" fill="url(#vignette)"/>
      <rect x="${(size * 0.004).toFixed(1)}" y="${(size * 0.004).toFixed(1)}" width="${(size * 0.992).toFixed(1)}" height="${(size * 0.992).toFixed(1)}" rx="${(size * 0.22).toFixed(1)}" fill="none" stroke="#e50914" stroke-opacity="0.28" stroke-width="${(size * 0.008).toFixed(1)}"/>
    </svg>`,
  )
}

const mark = await markLayer()

/** The flat icon: backdrop plus the mark, drawn at `markRatio` of the canvas. */
async function flatIcon(size, markRatio = 0.84) {
  const backdrop = await sharp(backdropSvg(size)).png().toBuffer()
  const logo = await sharp(mark)
    .resize({ width: Math.round(size * markRatio), fit: 'inside', withoutEnlargement: false })
    .toBuffer()
  const { width = size, height = size } = await sharp(logo).metadata()
  const shadow = await sharp(Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${size / 2}" cy="${size * 0.52}" rx="${width * 0.46}" ry="${height * 0.42}" fill="#000" fill-opacity="0.55"/></svg>`,
  ))
    .blur(size * 0.035)
    .png()
    .toBuffer()
  return sharp(backdrop)
    .composite([
      { input: shadow, top: 0, left: 0 },
      { input: logo, gravity: 'center' },
    ])
    .png()
    .toBuffer()
}

/** Logo alone on transparency, for the adaptive icon's foreground layer. */
async function foreground(size) {
  return sharp(mark).resize({ width: Math.round(size * 0.62), fit: 'inside' }).png().toBuffer()
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length
  images.forEach(({ size, data }, index) => {
    const at = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, at)
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1)
    entries.writeUInt16LE(1, at + 4)
    entries.writeUInt16LE(32, at + 6)
    entries.writeUInt32LE(data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

// ---------------------------------------------------------------- web + PWA
const web = [
  ['icon-512.png', 512],
  ['icon-192.png', 192],
  ['icon-180.png', 180],
  ['favicon-48.png', 48],
  ['favicon-32.png', 32],
  ['favicon-16.png', 16],
]
for (const [name, size] of web) {
  writeFileSync(join(root, 'public', name), await flatIcon(size))
}

// ------------------------------------------------------------------ Windows
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), await flatIcon(512))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoImages = []
for (const size of icoSizes) icoImages.push({ size, data: await flatIcon(size) })
writeFileSync(join(root, 'build', 'icon.ico'), ico(icoImages))

// ------------------------------------------------------------------ Android
const densities = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]
for (const [density, size] of densities) {
  const dir = join(ANDROID, `mipmap-${density}`)
  mkdirSync(dir, { recursive: true })
  const flat = await flatIcon(size)
  writeFileSync(join(dir, 'ic_launcher.png'), flat)
  writeFileSync(join(dir, 'ic_launcher_round.png'), await sharp(flat).composite([{ input: Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#000" fill-opacity="0"/></svg>`,
  ) }]).png().toBuffer())
  writeFileSync(join(dir, 'ic_launcher_background.png'), await sharp(backdropSvg(Math.round(size * 1.6))).resize(size).png().toBuffer())
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), await foreground(size))
}

console.log('✓ public/icon-512.png, icon-192, icon-180, favicons')
console.log('✓ build/icon.png, build/icon.ico')
console.log(`✓ android launcher icons (${densities.map(([d]) => d).join(', ')})`)
