/**
 * Vntera panel proxy — deploy at the origin that serves the app.
 *
 * The OTT panel is HTTP-only and sends no CORS headers, so the browser cannot
 * call it directly (mixed content + CORS). This Worker forwards `/xtream/*` to
 * the allow-listed panel over the same origin the app is served from.
 *
 * wrangler.toml:
 *   name = "vntera-panel-proxy"
 *   main = "server/panel-proxy.worker.js"
 *   compatibility_date = "2025-01-01"
 *   [vars]
 *   PANEL_ORIGIN = "http://ontvflix.cc:8080"
 *   ALLOWED_HOSTS = "ontvflix.cc:8080"
 *
 * Route it on your app's domain (e.g. vntera.example/xtream/*) so requests stay
 * same-origin. Never expose a wildcard proxy: keep ALLOWED_HOSTS narrow.
 */

const DEFAULT_PANEL = 'http://ontvflix.cc:8080'

function allowedHosts(env) {
  return (env.ALLOWED_HOSTS || new URL(env.PANEL_ORIGIN || DEFAULT_PANEL).host).split(',').map((s) => s.trim())
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  const own = new URL(request.url).origin
  const allowed = origin === own || !origin ? own : origin
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    if (!path.startsWith('/xtream/')) {
      return new Response('Not found', { status: 404 })
    }

    // Optional portal override: /xtream/<host:port>/player_api.php
    let target = env.PANEL_ORIGIN || DEFAULT_PANEL
    let rest = path.slice('/xtream/'.length)
    const first = rest.split('/')[0]
    if (/^[\w.-]+:\d+$/.test(decodeURIComponent(first))) {
      const candidate = decodeURIComponent(first)
      if (!allowedHosts(env).includes(candidate)) {
        return new Response('Portal host is not allow-listed', { status: 403 })
      }
      target = `http://${candidate}`
      rest = rest.split('/').slice(1).join('/')
    }

    const targetUrl = new URL(rest, target.endsWith('/') ? target : `${target}/`)
    targetUrl.search = url.search

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('cookie')
    headers.delete('origin')
    headers.delete('referer')

    let upstream
    try {
      upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.method === 'POST' ? await request.text() : undefined,
        redirect: 'follow',
        cf: { cacheTtl: 0, cacheEverything: false },
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: 'upstream_unreachable', detail: String(error) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
      })
    }

    const out = new Headers(upstream.headers)
    out.delete('set-cookie')
    out.delete('content-security-policy')
    out.delete('content-encoding')
    for (const [k, v] of Object.entries(corsHeaders(request, env))) out.set(k, v)
    out.set('Cache-Control', 'no-store')

    return new Response(upstream.body, { status: upstream.status, headers: out })
  },
}
