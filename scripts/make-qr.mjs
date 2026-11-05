/**
 * Renders the QR code the site footer shows for "scan to install".
 *
 *   npm run qr
 *
 * It points at the download page rather than the .apk path, so the code stays
 * valid across releases: the page always links the current build.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'public', 'media', 'app-qr.png')
const url = process.env.QR_URL || 'http://movies.vntera.com/download'

mkdirSync(dirname(target), { recursive: true })
const png = await QRCode.toBuffer(url, {
  type: 'png',
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 512,
  color: { dark: '#131313', light: '#ffffff' },
})
writeFileSync(target, png)
console.log(`✓ ${target} → ${url} (${png.length} bytes)`)
