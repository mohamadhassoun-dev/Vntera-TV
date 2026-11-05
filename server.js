/**
 * Vntera production server (Node 22, no dependencies).
 *
 * Two jobs:
 *   1. serve the built SPA from ./dist (with SPA history fallback);
 *   2. forward /xtream/* to the IPTV panel over the same origin, because the
 *      panel is HTTP-only and sends no CORS headers, so the browser cannot
 *      call it directly.
 *
 * The serving and proxying rules live in server/app.js so the Windows desktop
 * build can run exactly the same origin inside Electron.
 *
 * Environment:
 *   PORT            port to listen on (Hostinger injects this)
 *   PANEL_ORIGIN    e.g. http://ontvflix.cc:8080
 *   ALLOWED_HOSTS   comma-separated host:port list the proxy may reach
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app.js'

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)))
const PORT = Number(process.env.PORT) || 3000

const PANEL_ORIGIN = (process.env.PANEL_ORIGIN || 'http://ontvflix.cc:8080').replace(/\/+$/, '')
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

function log(...args) {
  console.log('[vntera]', ...args)
}

const { server, dist } = createAppServer({
  dist: resolve(HERE, 'dist'),
  panelOrigin: PANEL_ORIGIN,
  allowedHosts: ALLOWED_HOSTS,
  log,
})

server.listen(PORT, '0.0.0.0', () => {
  log(`listening on :${PORT}`)
  log(`serving ${dist}`)
  log(`proxying /xtream/* → ${PANEL_ORIGIN}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`${signal} received, closing`)
    server.close(() => process.exit(0))
  })
}
