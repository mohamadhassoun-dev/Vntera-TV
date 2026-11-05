/**
 * Renders the installer icon and the Android TV banner.
 *
 *   npm run icons
 *
 * Everything comes from the shipped artwork, so re-running after a logo change
 * refreshes the Windows icon, the .ico electron-builder signs into the
 * installer, and the 320×180 drawable Android TV launchers require.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'public', 'icon-512.png')
const logo = join(root, 'public', 'logos', 'nav-logo.webp')

/** ICO container with PNG payloads — supported by Windows Vista and newer. */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(16 * images.length)
  let offset = header.length + entries.length

  images.forEach(({ size, data }, index) => {
    const at = index * 16
    entries.writeUInt8(size >= 256 ? 0 : size, at)
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1)
    entries.writeUInt8(0, at + 2) // palette size
    entries.writeUInt8(0, at + 3) // reserved
    entries.writeUInt16LE(1, at + 4) // colour planes
    entries.writeUInt16LE(32, at + 6) // bits per pixel
    entries.writeUInt32LE(data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += data.length
  })

  return Buffer.concat([header, entries, ...images.map((image) => image.data)])
}

mkdirSync(join(root, 'build'), { recursive: true })

const iconPng = await sharp(source).resize(512, 512, { fit: 'contain' }).png().toBuffer()
writeFileSync(join(root, 'build', 'icon.png'), iconPng)

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = []
for (const size of sizes) {
  const data = await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  images.push({ size, data })
}
writeFileSync(join(root, 'build', 'icon.ico'), ico(images))

// Android TV requires a 320×180 banner; the launcher draws it behind the name.
const bannerLogo = await sharp(logo).resize({ height: 104 }).png().toBuffer()
const banner = await sharp({
  create: { width: 320, height: 180, channels: 4, background: '#0d0d0d' },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg">' +
          '<defs><radialGradient id="g" cx="50%" cy="50%" r="60%">' +
          '<stop offset="0%" stop-color="#e50914" stop-opacity="0.28"/>' +
          '<stop offset="100%" stop-color="#0d0d0d" stop-opacity="0"/>' +
          '</radialGradient></defs>' +
          '<rect width="320" height="180" fill="url(#g)"/>' +
          '</svg>',
      ),
      top: 0,
      left: 0,
    },
    { input: bannerLogo, gravity: 'center' },
  ])
  .png()
  .toBuffer()

const tvDrawable = join(root, 'android', 'app', 'src', 'tv', 'res', 'drawable')
mkdirSync(tvDrawable, { recursive: true })
writeFileSync(join(tvDrawable, 'tv_banner.png'), banner)

console.log(`✓ build/icon.png (${iconPng.length} B)`)
console.log(`✓ build/icon.ico (${sizes.join('/')})`)
console.log(`✓ android/app/src/tv/res/drawable/tv_banner.png (${banner.length} B)`)
