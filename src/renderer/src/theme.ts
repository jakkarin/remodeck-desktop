import type { ITheme } from '@xterm/xterm'

export function xtermTheme(read: (name: string) => string): ITheme {
  return {
    background: read('--bg-inset'),
    foreground: read('--fg'),
    cursor: read('--fg'),
    selectionBackground: read('--terminal-selection')
  }
}

export function watchColorScheme(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
