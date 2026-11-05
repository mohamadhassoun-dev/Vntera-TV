/**
 * Renders the QR codes the site shows in the install section.
 *
 *   npm run qr
 *
 * Each code points at the download page with its platform selected rather than
 * at the file itself, so a printed or saved code keeps working after a release:
 * the page always offers the current build for that platform.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const media = join(root, 'public', 'media')
const base = process.env.QR_BASE || 'http://movies.vntera.com'

const codes = [
  { file: 'app-qr.png', url: `${base}/download` },
  { file: 'qr-phone.png', url: `${base}/download?platform=phone` },
  { file: 'qr-tv.png', url: `${base}/download?platform=tv` },
  { file: 'qr-desktop.png', url: `${base}/download?platform=desktop` },
]

mkdirSync(media, { recursive: true })
for (const { file, url } of codes) {
  const png = await QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
    color: { dark: '#131313', light: '#ffffff' },
  })
  writeFileSync(join(media, file), png)
  console.log(`✓ public/media/${file} → ${url}`)
}
