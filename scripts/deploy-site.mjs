/**
 * Publishes the built site straight to the Hostinger host over SSH.
 *
 *   npm run deploy
 *
 * This is the path that does not involve GitHub at all: it streams `dist/` to
 * the domain's document root, including the Windows installer staged in
 * `public/downloads` (118 MB, past what a git deploy or GitHub release asset can
 * carry while the release channel is unavailable).
 *
 *   VNTERA_SSH_HOST   82.198.229.218                     (default)
 *   VNTERA_SSH_PORT   65002                              (Hostinger SSH port)
 *   VNTERA_SSH_USER   u855512965
 *   VNTERA_SSH_KEY    path to the private key added under hPanel → SSH keys
 *   VNTERA_REMOTE_ROOT /home/<user>/domains/movies.vntera.com/public_html
 *
 * FTP is deliberately avoided: the hosting FTP account is chrooted one level
 * below the document root, so uploads over FTP land in a directory the web
 * server never serves. SSH writes to the real web root.
 *
 * Files go up in one stream with `index.html` last (the page must never
 * reference assets that are not there yet), and every uploaded file is checked
 * against its local byte size before the run reports success.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

const host = process.env.VNTERA_SSH_HOST || '82.198.229.218'
const port = process.env.VNTERA_SSH_PORT || '65002'
const user = process.env.VNTERA_SSH_USER || 'u855512965'
const key = resolve(process.env.VNTERA_SSH_KEY || join(root, '.tools', 'deploy_key'))
const remoteRoot = process.env.VNTERA_REMOTE_ROOT || `/home/${user}/domains/movies.vntera.com/public_html`

if (!statSync(dist, { throwIfNoEntry: false })) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(2)
}
if (!statSync(key, { throwIfNoEntry: false })) {
  console.error(`No SSH key at ${key}`)
  console.error('Add the matching public key under hPanel → Advanced → SSH Access, then run again.')
  process.exit(2)
}

const sshTarget = `${user}@${host}`
const sshArgs = ['-i', key, '-p', port, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']

function run(command, args, stdinFrom) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: [stdinFrom ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', rejectPromise)
    child.on('close', (code) => (code === 0 ? resolvePromise(out) : rejectPromise(new Error(err.trim() || `${command} exited ${code}`))))
    if (stdinFrom) stdinFrom.pipe(child.stdin)
  })
}

/** Streams the given tar member list into the remote document root. */
function upload(entries, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const tarArgs = ['-cf', '-', '-C', 'dist', ...entries]
    const tar = spawn('tar', tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    const ssh = spawn('ssh', [...sshArgs, sshTarget, `tar -xf - -C '${remoteRoot}'`], { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    tar.stderr.on('data', (chunk) => (err += chunk))
    ssh.stderr.on('data', (chunk) => (err += chunk))
    tar.stdout.pipe(ssh.stdin)
    let pending = 2
    const done = (code, who) => {
      pending -= 1
      if (code !== 0) {
        rejectPromise(new Error(`${who} exited ${code}: ${err.trim().slice(0, 300)}`))
      } else if (pending === 0) {
        resolvePromise()
      }
    }
    tar.on('close', (code) => done(code, 'tar'))
    ssh.on('close', (code) => done(code, 'ssh'))
    console.log(`  ${label} … streamed`)
  })
}

console.log(`▸ deploying dist/ → ${sshTarget}:${remoteRoot}`)

// Everything except index.html first, then the page that references it.
await upload(['--exclude=./index.html', '.'], 'site files')
await upload(['./index.html'], 'index.html')

// Verify: the remote listing must carry every local path at its exact size.
const remote = await run('ssh', [...sshArgs, sshTarget, `cd '${remoteRoot}' && find . -type f -printf '%P\\t%s\\n'`])
const remoteSizes = new Map()
for (const line of remote.split(/\r?\n/)) {
  const [path, size] = line.split('\t')
  if (path) remoteSizes.set(path.replace(/^\.\//, ''), Number(size))
}

const { readdirSync } = await import('node:fs')
const walk = (dir, base = '') => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else out.push({ rel, size: statSync(join(dir, entry.name)).size })
  }
  return out
}
const local = walk(dist)
const bad = local.filter((item) => remoteSizes.get(item.rel) !== item.size)
if (bad.length) {
  console.error(`✗ ${bad.length} file(s) do not match on the server:`)
  for (const item of bad.slice(0, 10)) console.error(`  ${item.rel} local=${item.size} remote=${remoteSizes.get(item.rel) ?? 'missing'}`)
  process.exit(1)
}
console.log(`✓ deployed and verified ${local.length} files at ${remoteRoot}`)
