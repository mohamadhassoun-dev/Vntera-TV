/*
 * Vntera web shell cache.
 *
 * It exists for one reason: a downloaded title must still be playable after the
 * tab has been closed and the network is gone. The film itself lives in
 * IndexedDB (see src/lib/offline/storage.ts); this worker only keeps the app
 * shell — HTML, scripts, styles, icons — so the app can boot and reach it.
 *
 * Not cached on purpose: the panel API and its streams (/xtream), the large
 * installers under /downloads, and any range request (video seeking).
 */
const SHELL = 'vntera-shell-v3'
const RUNTIME = 'vntera-runtime-v3'
const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL && key !== RUNTIME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/xtream')) return
  if (url.pathname.startsWith('/downloads/') || url.pathname.startsWith('/files/')) return
  if (request.headers.get('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy)).catch(() => undefined)
          return response
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(RUNTIME).then((cache) => cache.put(request, copy)).catch(() => undefined)
          }
          return response
        })
        .catch(() => hit || Response.error())
      return hit || network
    }),
  )
})
