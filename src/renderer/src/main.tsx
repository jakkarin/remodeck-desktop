import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { restoreCachedTheme } from './theme'

restoreCachedTheme()

// Dropping a file outside a drop target must be a no-op (Electron would navigate to it).
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
