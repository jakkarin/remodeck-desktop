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

/** Forces light/dark via `data-theme` on <html>; `system` removes it so the OS preference applies. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
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
