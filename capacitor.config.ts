import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android shell for the web app.
 *
 * The panel only speaks plain HTTP, so the WebView runs on an http://localhost
 * origin with mixed content allowed; VITE_API_BASE points the app at the
 * deployed /xtream bridge because a bundled WebView has no same-origin proxy.
 */
const config: CapacitorConfig = {
  appId: 'com.vntera.iptv',
  appName: 'Vntera',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#131313',
  },
  server: {
    androidScheme: 'http',
  },
}

export default config
