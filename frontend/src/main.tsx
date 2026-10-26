import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyStoredA11ySettings } from './hooks/useA11ySettings'

// Apply persisted text size / contrast before the first paint so the page
// doesn't flash at the default size.
applyStoredA11ySettings()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
