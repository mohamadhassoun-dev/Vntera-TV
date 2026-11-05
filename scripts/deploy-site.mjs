/**
 * Publishes the built site straight to the Hostinger host over FTP/FTPS/SFTP.
 *
 *   npm run deploy
 *
 * This is the path that does not involve GitHub at all: it walks `dist/` and
 * uploads every file to the account's web root, including the Windows installer
 * staged in `public/downloads` (118 MB, far past what a git deploy or a GitHub
 * release asset can carry while the release channel is unavailable).
 *
 * Credentials come from the environment so nothing secret is committed:
 *
 *   VNTERA_FTP_HOST      ftp.movies.vntera.com   (or the server IP)
 *   VNTERA_FTP_USER      the Hostinger FTP account
 *   VNTERA_FTP_PASS      that account's password
 *   VNTERA_FTP_PROTOCOL  ftp | ftps | sftp       (default ftp)
 *   VNTERA_FTP_PORT      21, 990 or 22           (default per protocol)
 *   VNTERA_FTP_ROOT      /public_html            (default)
 *
 * Every upload is a plain overwrite, so running it twice is harmless.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const host = process.env.VNTERA_FTP_HOST
const user = process.env.VNTERA_FTP_USER
const pass = process.env.VNTERA_FTP_PASS
const protocol = (process.env.VNTERA_FTP_PROTOCOL || 'ftp').toLowerCase()
const port = process.env.VNTERA_FTP_PORT || (protocol === 'sftp' ? '22' : protocol === 'ftps' ? '990' : '21')
const remoteRoot = (process.env.VNTERA_FTP_ROOT || '/public_html').replace(/\/+$/, '')

if (!host || !user || !pass) {
  console.error('Missing deploy credentials.')
  console.error('Set VNTERA_FTP_HOST, VNTERA_FTP_USER and VNTERA_FTP_PASS, then run again.')
  console.error('Hostinger shows all three under hPanel → Files → FTP Accounts.')
  process.exit(2)
}

/** curl reads the password from a config file so it never shows in `ps`. */
const configFile = join(mkdtempSync(join(tmpdir(), 'vntera-deploy-')), 'curl.conf')
writeFileSync(configFile, `user = "${user}:${pass.replace(/(["\\])/g, '\\$1')}"\n`, { mode: 0o600 })

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

if (!statSync(dist, { throwIfNoEntry: false })) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(2)
}

const files = walk(dist).sort()
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0)
console.log(`▸ ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${protocol}://${host}:${port}${remoteRoot}`)

let done = 0
for (const file of files) {
  const rel = relative(dist, file).split(sep).join('/')
  const url = `${protocol}://${host}:${port}${remoteRoot}/${rel}`
  const size = statSync(file).size
  process.stdout.write(`  ${rel} (${(size / 1024).toFixed(0)} KB) … `)
  try {
    execFileSync('curl', ['-sS', '--fail', '-K', configFile, '--ftp-create-dirs', '-T', file, url], {
      stdio: ['ignore', 'ignore', 'pipe'],
      maxBuffer: 1024 * 1024,
    })
    console.log('ok')
    done += 1
  } catch (error) {
    console.log('FAILED')
    console.error(String(error.stderr || error.message).trim().slice(0, 400))
    process.exit(1)
  }
}
console.log(`✓ uploaded ${done}/${files.length} files to ${host}${remoteRoot}`)
