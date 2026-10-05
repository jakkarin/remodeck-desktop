import type { ITheme } from '@xterm/xterm'
import type { Theme } from '../../shared/types'

export function xtermTheme(read: (name: string) => string): ITheme {
  return {
    background: read('--bg-inset'),
    foreground: read('--fg'),
    cursor: read('--fg'),
    selectionBackground: read('--terminal-selection')
  }
}

const THEME_CACHE_KEY = 'regit.theme'

/** Forces light/dark via `data-theme` on <html>; `system` removes it so the OS preference applies. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme)
  } catch {
    /* storage unavailable: only costs a flash on next start */
  }
}

/** Re-applies the last theme before first render, since prefs arrive asynchronously over IPC. */
export function restoreCachedTheme(): void {
  try {
    const t = localStorage.getItem(THEME_CACHE_KEY)
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  } catch {
    /* ignore */
  }
}

/** Fires when the OS color scheme or the forced `data-theme` changes. */
export function watchColorScheme(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    mq.removeEventListener('change', cb)
    mo.disconnect()
  }
}
