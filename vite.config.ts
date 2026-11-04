import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The OTT panel is served over plain HTTP and does not send CORS headers, so the
// browser cannot call it directly. In development we proxy it on the same origin;
// in production a tiny edge proxy (see server/panel-proxy.worker.js) does the same.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const panelOrigin = env.VITE_PANEL_ORIGIN || 'http://ontvflix.cc:8080'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: {
        overlay: false,
      },
      proxy: {
        '/xtream': {
          target: panelOrigin,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/xtream/, ''),
          // Streams can reset mid-transfer; never let that crash the dev server.
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              console.warn('[xtream-proxy]', err.message)
              const response = res as unknown as {
                headersSent?: boolean
                writeHead?: (code: number, headers: Record<string, string>) => void
                end?: (body?: string) => void
              }
              if (response && !response.headersSent && response.writeHead && response.end) {
                response.writeHead(502, { 'Content-Type': 'application/json' })
                response.end(JSON.stringify({ error: 'panel_proxy_failed' }))
              }
            })
          },
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy: {
        '/xtream': {
          target: panelOrigin,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/xtream/, ''),
        },
      },
    },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          // Framework code changes rarely, demuxers are huge and used by one
          // route, so each gets its own long-lived chunk instead of bloating
          // the entry bundle.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('hls.js')) return 'hls'
            if (id.includes('mpegts.js')) return 'mpegts'
            if (/(\/react\/|\/react-dom\/|\/react-router|\/scheduler\/|\/zustand\/)/.test(id)) return 'vendor'
            return undefined
          },
        },
      },
    },
  }
})
