import type { Terminal } from '@xterm/xterm'

type ClipTerm = Pick<
  Terminal,
  'attachCustomKeyEventHandler' | 'hasSelection' | 'getSelection' | 'clearSelection' | 'paste'
>
type Clip = { readText(): Promise<string>; writeText(t: string): Promise<void> }

/**
 * Terminal copy/paste: Ctrl+Shift+C / Ctrl+Shift+V (and Cmd+C / Cmd+V on macOS) plus right-click.
 * Plain Ctrl+C / Ctrl+V are left alone so they reach the shell. Returns a disposer.
 */
export function attachClipboard(
  term: ClipTerm,
  el: HTMLElement,
  clipboard: Clip = navigator.clipboard
): () => void {
  const copy = (): void => {
    if (!term.hasSelection()) return
    try {
      clipboard.writeText(term.getSelection()).catch(() => {})
    } catch {
      /* clipboard unavailable */
    }
  }
  const paste = (): void => {
    try {
      clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text)
        })
        .catch(() => {})
    } catch {
      /* clipboard unavailable */
    }
  }

  term.attachCustomKeyEventHandler((e) => {
    const combo =
      (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) || (e.metaKey && !e.ctrlKey && !e.altKey)
    const action = combo ? (e.code === 'KeyC' ? copy : e.code === 'KeyV' ? paste : null) : null
    if (!action) return true
    if (e.type === 'keydown') {
      e.preventDefault()
      action()
    }
    return false
  })

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (term.hasSelection()) {
      copy()
      term.clearSelection()
    } else {
      paste()
    }
  }
  el.addEventListener('contextmenu', onContextMenu)
  return () => el.removeEventListener('contextmenu', onContextMenu)
}
