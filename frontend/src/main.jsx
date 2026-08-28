import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Capture the browser's install prompt as EARLY as possible — it can fire
// before any React component mounts, so we stash it on window and notify any
// Install button (via a custom event) regardless of which route is open.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    window.__deferredInstallPrompt = e
    window.dispatchEvent(new Event('pwa-installable'))
  })
  window.addEventListener('appinstalled', () => {
    window.__deferredInstallPrompt = null
    window.dispatchEvent(new Event('pwa-installed'))
  })
}

// Register the PWA service worker (installable app + offline shell). Kept
// out of the render path and failure-tolerant so it never blocks the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
