/**
 * Builds the Android release APK in one step.
 *
 * A bundled WebView has no same-origin proxy, so the app is compiled with
 * VITE_API_BASE pointing at the deployed /xtream bridge on the site.
 *
 *   npm run apk            # release APK, signed with android/keystore.properties
 *   npm run apk -- --api-base http://other.host/xtream
 *
 * Needs the Android SDK (android/local.properties) and a JDK 21; pass
 * JAVA_HOME yourself or let the script pick up .tools/jdk-21* if present.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const apiBase =
  argValue('--api-base') || process.env.VITE_API_BASE || 'http://movies.vntera.com/xtream'
const isWindows = process.platform === 'win32'

function argValue(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  })
}

// Windows has no `npx` executable to spawn directly (only a .cmd shim), so use the
// JS entry points the package manager would have launched.
function runNode(script, args, options = {}) {
  run(process.execPath, [script, ...args], options)
}

function javaHome() {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  const tools = join(root, '.tools')
  if (existsSync(tools)) {
    const jdk = readdirSync(tools).find((entry) => /^jdk-21/.test(entry))
    if (jdk) return join(tools, jdk)
  }
  throw new Error(
    'No JDK 21 found. Install one, or point JAVA_HOME at it (Gradle 8.14 cannot run on Java 26).',
  )
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const env = { VITE_API_BASE: apiBase, JAVA_HOME: javaHome() }

console.log(`\n▸ web bundle → ${apiBase}`)
runNode(join(root, 'node_modules', 'vite', 'bin', 'vite.js'), ['build'], { env })

// The site publishes the installers from public/downloads; the app must not carry
// them, or every release ships a copy of itself inside its own bundle.
for (const dir of [join(root, 'dist', 'downloads'), join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'downloads')]) {
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n▸ syncing into the Android project')
runNode(join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), ['sync', 'android'])

// A local Gradle unpacked in .tools wins: the wrapper's own downloader is fragile
// on slow links and drops the distribution mid-fetch. Launching Gradle's main jar
// through the JDK avoids Windows .bat spawning quirks entirely.
function gradleLauncher() {
  const tools = join(root, '.tools')
  if (existsSync(tools)) {
    for (const entry of readdirSync(tools)) {
      if (!/^gradle-[\d.]+$/.test(entry)) continue
      const lib = join(tools, entry, 'lib')
      if (!existsSync(lib)) continue
      const jar = readdirSync(lib).find((file) => /^gradle-launcher-.*\.jar$/.test(file))
      if (jar) return join(lib, jar)
    }
  }
  return null
}

console.log('\n▸ assembling the signed release APK')
const launcher = gradleLauncher()
if (launcher) {
  run(
    join(env.JAVA_HOME, 'bin', isWindows ? 'java.exe' : 'java'),
    ['-classpath', launcher, 'org.gradle.launcher.GradleMain', 'assembleRelease', '--no-daemon'],
    { cwd: join(root, 'android'), env },
  )
} else {
  run(isWindows ? join(root, 'android', 'gradlew.bat') : './gradlew', ['assembleRelease', '--no-daemon'], {
    cwd: join(root, 'android'),
    env,
  })
}

const built = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release')
const apk = readdirSync(built).find((file) => file.endsWith('.apk'))
if (!apk) throw new Error(`Gradle finished without an APK in ${built}`)

mkdirSync(join(root, 'release'), { recursive: true })
const target = join(root, 'release', `vntera-${version}.apk`)
copyFileSync(join(built, apk), target)
console.log(`\n✓ ${target}`)
