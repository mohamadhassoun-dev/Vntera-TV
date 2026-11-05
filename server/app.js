/**
 * The Vntera origin: static SPA from ./dist plus the /xtream bridge.
 *
 * Split out of server.js so the same origin can be served in-process by the
 * desktop shell (a packaged app has no npm-hosted proxy either) and by the
 * production Node server, with identical proxy rules in both.
 *
 *   const { server } = createAppServer({ dist, panelOrigin })
 *   server.listen(0, '127.0.0.1', () => console.log(server.address().port))
 */

import { createReadStream, statSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { extname, join, resolve, sep } from 'node:path'

const PREFIX = '/xtream'

/** Hop-by-hop headers must not be forwarded in either direction. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

export function createAppServer({ dist, panelOrigin, allowedHosts = [], log = () => {} }) {
  const DIST = resolve(dist)
  const PANEL_ORIGIN = String(panelOrigin || '').replace(/\/+$/, '')
  const allowed = allowedHosts.length ? allowedHosts : PANEL_ORIGIN ? [new URL(PANEL_ORIGIN).host] : []

  function proxyToPanel(req, res) {
    let target
    try {
      target = new URL(PANEL_ORIGIN)
    } catch {
      sendJson(res, 500, { error: 'panel_origin_invalid' })
      return
    }

    // Never proxy to a host that is not explicitly allowed.
    if (!allowed.includes(target.host)) {
      log('refusing panel host', target.host, '— allowed:', allowed.join(', '))
      sendJson(res, 502, { error: 'panel_host_not_allowed', host: target.host })
      return
    }

    const incoming = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const upstreamPath = (incoming.pathname.slice(PREFIX.length) || '/') + incoming.search

    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (!value || HOP_BY_HOP.has(name)) continue
      // The panel expects its own host; browser cookies must never leak to it.
      if (name === 'host' || name === 'cookie' || name === 'origin' || name === 'referer') continue
      headers[name] = value
    }
    headers.host = target.host
    headers['x-forwarded-host'] = req.headers.host || ''
    headers['x-forwarded-proto'] = 'https'
    headers['accept-encoding'] = 'identity'

    const isHttps = target.protocol === 'https:'
    const request = isHttps ? httpsRequest : httpRequest
    const upstream = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        method: req.method,
        path: upstreamPath,
        headers,
      },
      (upstreamRes) => {
        const status = upstreamRes.statusCode || 502
        const out = {}
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (!value || HOP_BY_HOP.has(name)) continue
          if (name === 'set-cookie') continue
          // The browser must see this response as same-origin, not as panel CORS.
          if (name === 'access-control-allow-origin') continue
          out[name] = value
        }
        res.writeHead(status, out)
        // Stream straight through: live segments must not be buffered.
        upstreamRes.pipe(res)
        upstreamRes.on('error', () => res.destroy())
      },
    )

    // Live streams can idle for minutes between segments.
    upstream.setTimeout(0)

    upstream.on('error', (error) => {
      log('panel request failed:', error.message)
      if (!res.headersSent) sendJson(res, 502, { error: 'panel_unreachable', message: error.message })
      else res.destroy()
    })

    req.on('aborted', () => upstream.destroy())
    req.pipe(upstream)
  }

  function serveFile(req, res, filePath, immutable) {
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
    const { size } = statSync(filePath)
    res.writeHead(200, {
      'content-type': type,
      'content-length': size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(filePath)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  function serveStatic(req, res, pathname) {
    let decoded
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      sendJson(res, 400, { error: 'bad_request' })
      return
    }

    const relative = decoded.replace(/^\/+/, '')
    const candidate = resolve(DIST, relative)
    // Path traversal guard: the resolved file must stay inside dist.
    if (candidate !== DIST && !candidate.startsWith(DIST + sep)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }

    let isFile = false
    try {
      isFile = statSync(candidate).isFile()
    } catch {
      isFile = false
    }

    if (isFile) {
      serveFile(req, res, candidate, decoded.startsWith('/assets/'))
      return
    }

    // SPA history fallback for routes without a file extension.
    if (extname(decoded)) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    const index = join(DIST, 'index.html')
    try {
      statSync(index)
    } catch {
      sendJson(res, 503, { error: 'build_missing', message: 'Run "npm run build" before starting the server.' })
      return
    }
    serveFile(req, res, index, false)
  }

  const server = createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname

    if (pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        panel: PANEL_ORIGIN,
        allowedHosts: allowed,
        node: process.version,
      })
      return
    }

    if (pathname === PREFIX || pathname.startsWith(PREFIX + '/')) {
      proxyToPanel(req, res)
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }

    serveStatic(req, res, pathname)
  })

  // Live TV holds a response open for hours; none of the default timeouts apply.
  server.requestTimeout = 0
  server.headersTimeout = 60_000
  server.keepAliveTimeout = 65_000

  return { server, dist: DIST, panelOrigin: PANEL_ORIGIN }
}
