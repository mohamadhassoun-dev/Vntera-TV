/**
 * Vntera desktop shell (Windows).
 *
 * A packaged app has no browser origin and nothing to proxy through, so the
 * main process runs the very same origin the website runs — server/app.js —
 * on a loopback port, and the window loads that. Playback, sign-in and the
 * /xtream bridge therefore behave identically to the web build.
 *
 *   npm run desktop          # build the web bundle, then open the shell
 *   npm run desktop -- --smoke   # load, report, quit (CI/packaging check)
 */
import { app, BrowserWindow, Menu, shell, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from '../server/app.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PANEL_ORIGIN = process.env.VNTERA_PANEL_ORIGIN || 'http://ontvflix.cc:8080'
const SMOKE = process.argv.includes('--smoke')
const APP_URL_PATH = '/'

let server = null
let mainWindow = null
let appOrigin = ''

const stateFile = () => join(app.getPath('userData'), 'window-state.json')

function readWindowState() {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (typeof raw?.width === 'number' && typeof raw?.height === 'number') return raw
  } catch {
    /* first run */
  }
  return null
}

function saveWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  const bounds = win.getNormalBounds()
  try {
    mkdirSync(dirname(stateFile()), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }))
  } catch {
    /* not important enough to fail a session over */
  }
}

/** Ask the OS for a free loopback port instead of guessing one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function startOrigin() {
  const dist = join(app.getAppPath(), 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`No web bundle at ${dist}. Run "npm run desktop" instead of launching Electron directly.`)
  }
  const port = await freePort()
  const created = createAppServer({
    dist,
    panelOrigin: PANEL_ORIGIN,
    log: (...args) => console.log('[origin]', ...args),
  })
  server = created.server
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  appOrigin = `http://127.0.0.1:${port}`
  return appOrigin
}

function openExternal(url) {
  // Only ever hand real web links to the browser; never local files or app URLs.
  if (/^https?:\/\//i.test(url) && !url.startsWith(appOrigin)) {
    void shell.openExternal(url)
    return true
  }
  return false
}

function buildMenu(win) {
  const template = [
    {
      label: 'Vntera',
      submenu: [
        { label: 'Home', accelerator: 'Alt+H', click: () => win.loadURL(appOrigin + '/') },
        { type: 'separator' },
        { label: 'Check for the latest build…', click: () => openExternal('http://movies.vntera.com/download') },
        { label: 'Install help', click: () => openExternal('http://movies.vntera.com/download') },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Vntera' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full screen', accelerator: 'F11' },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play / pause',
          accelerator: 'Space',
          // The player owns the keyboard; this only forwards the key it expects.
          click: () => win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }),
        },
        { label: 'Back', accelerator: 'Alt+Left', click: () => win.webContents.navigationHistory?.goBack?.() },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => win.webContents.navigationHistory?.goForward?.() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Vntera on the web', click: () => openExternal('http://movies.vntera.com') },
        { label: 'Android and TV apps', click: () => openExternal('http://movies.vntera.com/download') },
      ],
    },
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow() {
  const saved = readWindowState()
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(saved?.width ?? 1440, workArea.width)
  const height = Math.min(saved?.height ?? 900, workArea.height)

  const win = new BrowserWindow({
    width,
    height,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Vntera',
    backgroundColor: '#131313',
    autoHideMenuBar: false,
    // Packaged builds take their icon from the executable; the file only exists
    // during development.
    ...(existsSync(join(ROOT, 'build', 'icon.png')) ? { icon: join(ROOT, 'build', 'icon.png') } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  if (saved?.maximized) win.maximize()

  // Keep the window on one origin: links either navigate inside the app or go
  // to the real browser. A new Electron window would have no menu or state.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(appOrigin)) return
    event.preventDefault()
    openExternal(url)
  })
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[window] load failed ${code} ${description} ${url}`)
  })

  win.once('ready-to-show', () => {
    if (!SMOKE) win.show()
  })
  win.on('close', () => saveWindowState(win))

  Menu.setApplicationMenu(buildMenu(win))
  win.loadURL(appOrigin + APP_URL_PATH)
  return win
}

async function runSmoke(win) {
  // Give the app a moment to mount and settle its form factor before reading it.
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const report = await win.webContents.executeJavaScript(
    `(async () => {
      let health = null
      try {
        const response = await fetch('/healthz', { cache: 'no-store' })
        health = { status: response.status, body: await response.json() }
      } catch (error) {
        health = { error: String(error) }
      }
      return {
        title: document.title,
        formFactor: document.documentElement.dataset.formFactor ?? null,
        route: location.pathname,
        images: document.querySelectorAll('img').length,
        canvas: Boolean(document.querySelector('canvas')),
        signIn: Boolean(document.querySelector('input[type="password"]')),
        health,
      }
    })()`,
    true,
  )
  console.log(
    'SMOKE ' +
      JSON.stringify({ ...report, origin: appOrigin, version: app.getVersion(), formFactor: report.formFactor }),
  )
  setTimeout(() => app.exit(0), 300)
}

// A second launch focuses the running window instead of starting another origin.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.setAppUserModelId('com.vntera.desktop')

  app.whenReady().then(async () => {
    try {
      await startOrigin()
      mainWindow = createWindow()
      if (SMOKE) {
        mainWindow.webContents.once('did-finish-load', () => void runSmoke(mainWindow))
        setTimeout(() => {
          console.error('SMOKE timed out waiting for the app to load')
          app.exit(1)
        }, 45_000)
      }
    } catch (error) {
      console.error('[startup]', error)
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    saveWindowState(mainWindow)
    server?.close()
  })
}
