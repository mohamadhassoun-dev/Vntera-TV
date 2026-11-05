/**
 * Writes the install metadata the site renders (version, real sizes, download URLs).
 *
 *   npm run artifacts
 *
 * Run it after copying installers into public/downloads. The generated JSON is
 * committed, so a plain `npm run build` on the host publishes exactly what is
 * actually there instead of a hand-typed size.
 *
 * The Windows installer is far larger than git will take (GitHub rejects files
 * over 100 MB), so it is published as a GitHub release asset and the site links
 * to it. Its size is read from release/ when it is not in the web folder.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const repo = process.env.VNTERA_REPO || 'mohamadhassoun1/Vntera-TV'

const sizeOf = (path) => (existsSync(path) ? statSync(path).size : 0)

const artifacts = { version }

for (const [key, name] of Object.entries({
  phone: `vntera-${version}.apk`,
  tv: `vntera-tv-${version}.apk`,
})) {
  const path = join(root, 'public', 'downloads', name)
  artifacts[key] = { file: `/downloads/${name}`, bytes: sizeOf(path), available: existsSync(path) }
  console.log(`${existsSync(path) ? '✓' : '·'} ${key.padEnd(8)} ${name} ${artifacts[key].bytes || 'missing'}`)
}

const installer = `Vntera-Setup-${version}.exe`
const localInstaller = join(root, 'public', 'downloads', installer)
const builtInstaller = join(root, 'release', installer)
const bytes = sizeOf(localInstaller) || sizeOf(builtInstaller)
artifacts.desktop = {
  file: `/downloads/${installer}`,
  url: `https://github.com/${repo}/releases/download/v${version}/${installer}`,
  bytes,
  available: bytes > 0,
}
console.log(`${bytes ? '✓' : '·'} desktop  ${installer} ${bytes || 'missing'} → ${artifacts.desktop.url}`)

writeFileSync(join(root, 'src', 'lib', 'artifacts.json'), JSON.stringify(artifacts, null, 2) + '\n')
console.log('✓ src/lib/artifacts.json')
