import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import { installLegacyGapFix } from './lib/legacyGap'
import { useAuth } from './store/auth'
import { useCatalog } from './store/catalog'
import { useEpg } from './store/epg'
import { useLibrary } from './store/library'

// Store handles for QA in the browser console. Off by default in a release
// build: `localStorage.setItem('vntera:qa', '1')` opts in for a manual check of
// the offline queue (the automated preview uses the same switch).
const qaEnabled = import.meta.env.DEV || (() => {
  try {
    return localStorage.getItem('vntera:qa') === '1'
  } catch {
    return false
  }
})()
if (qaEnabled) {
  ;(window as unknown as Record<string, unknown>).__vntera = { useAuth, useCatalog, useEpg, useLibrary }
}

// The installed web app can boot with no network, which is what makes a
// downloaded title playable after the tab was closed. Android uses its own
// native shell instead.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)

// Only does anything where the compatibility stylesheet was chosen and the
// engine has no flex gaps (see lib/legacyGap).
installLegacyGapFix()
