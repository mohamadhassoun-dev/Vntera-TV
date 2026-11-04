import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { useAuth } from './store/auth'
import { useCatalog } from './store/catalog'
import { useEpg } from './store/epg'
import { useLibrary } from './store/library'

// Dev-only store handles for QA in the browser console.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__vntera = { useAuth, useCatalog, useEpg, useLibrary }
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
