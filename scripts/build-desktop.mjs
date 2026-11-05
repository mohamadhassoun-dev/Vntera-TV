/**
 * Builds the Windows desktop app.
 *
 *   npm run desktop         # build the bundle and open the shell
 *   npm run desktop:build   # build release/Vntera-Setup-<version>.exe
 *   npm run desktop -- --smoke   # load the shell headlessly and report
 *
 * The desktop shell serves the same origin as the website from inside the main
 * process, so the bundle keeps the default same-origin /xtream bridge.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const devOnly = argv.includes('--dev')
const smoke = argv.includes('--smoke')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

function run(command, args, env = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
}

console.log('\n▸ web bundle → same-origin /xtream (served by the shell)')
run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  VITE_API_BASE: '/xtream',
})

// Installers are published from the website; shipping them inside the app would
// add tens of megabytes to every download.
rmSync(join(root, 'dist', 'downloads'), { recursive: true, force: true })

if (devOnly) {
  const electron = require('electron')
  console.log('\n▸ opening the desktop shell')
  const child = spawn(electron, ['.', ...(smoke ? ['--smoke'] : [])], {
    cwd: root,
    stdio: 'inherit',
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  console.log('\n▸ packaging the Windows installer')
  run(
    process.execPath,
    [join(root, 'node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--x64', '--config', 'electron-builder.yml'],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  )

  const out = join(root, 'release', 'desktop')
  const installer = readdirSync(out).find((file) => file.endsWith('.exe'))
  if (!installer) throw new Error(`electron-builder finished without an installer in ${out}`)

  mkdirSync(join(root, 'release'), { recursive: true })
  const target = join(root, 'release', `Vntera-Setup-${version}.exe`)
  copyFileSync(join(out, installer), target)
  const bytes = readFileSync(target).length
  console.log(`\n✓ ${target} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)

  // The shell is only useful if it actually starts and renders, so prove it here.
  const electron = require('electron')
  if (existsSync(electron)) {
    console.log('\n▸ smoke-testing the shell against the packaged bundle')
    try {
      const output = execFileSync(electron, ['.', '--smoke'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 90_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      })
      const line = output.split('\n').find((entry) => entry.startsWith('SMOKE '))
      if (!line) throw new Error(`shell did not report a loaded page: ${output.slice(-400)}`)
      console.log(`✓ ${line}`)
      const report = JSON.parse(line.slice('SMOKE '.length))
      if (report.health?.status !== 200) throw new Error('the in-app origin did not answer /healthz')
    } catch (error) {
      console.error('[smoke] failed:', error.message)
      process.exitCode = 1
    }
  }
}
