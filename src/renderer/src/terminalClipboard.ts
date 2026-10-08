import type { Terminal } from '@xterm/xterm'

type ClipTerm = Pick<
  Terminal,
  'attachCustomKeyEventHandler' | 'hasSelection' | 'getSelection' | 'clearSelection' | 'paste'
>
type Clip = { readText(): Promise<string>; writeText(t: string): Promise<void> }

export type ClipboardOptions = {
  /** Uploads the clipboard image (if any) and resolves its remote path, or null when there is none. */
  pasteImage?: () => Promise<string | null>
  onError?: (msg: string) => void
  /** Called when an upload starts; the returned function is called when it settles. */
  onBusy?: () => () => void
}

const BACKSLASH = String.fromCharCode(92)
const SAFE_PATH = /^[A-Za-z0-9_./,:@%+=~-]+$/

/** Quotes a path for the shell only when it holds whitespace or special characters. */
export function formatPath(p: string): string {
  return SAFE_PATH.test(p) ? p : "'" + p.replaceAll("'", "'" + BACKSLASH + "''") + "'"
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Terminal copy/paste: Ctrl+Shift+C / Ctrl+Shift+V (and Cmd+C / Cmd+V on macOS) plus right-click.
 * Plain Ctrl+C / Ctrl+V are left alone so they reach the shell. Returns a disposer.
 */
export function attachClipboard(
  term: ClipTerm,
  el: HTMLElement,
  clipboard: Clip = navigator.clipboard,
  opts: ClipboardOptions = {}
): () => void {
  const copy = (): void => {
    if (!term.hasSelection()) return
    try {
      clipboard.writeText(term.getSelection()).catch(() => {})
    } catch {
      /* clipboard unavailable */
    }
  }
  const pasteText = (): void => {
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

  const paste = (): void => {
    if (!opts.pasteImage) return pasteText()
    const end = opts.onBusy?.()
    opts
      .pasteImage()
      .finally(() => end?.())
      .then((path) => {
        if (path) term.paste(formatPath(path) + ' ')
        else pasteText()
      })
      .catch((e) => opts.onError?.(errMsg(e)))
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

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}
export const MAX_DROP_BYTES = 10 * 1024 * 1024

/**
 * Dropping image files on the terminal uploads each one and pastes the resulting paths.
 * Always cancels the default drop so Electron does not navigate to the file. Returns a disposer.
 */
export function attachImageDrop(
  el: HTMLElement,
  term: Pick<Terminal, 'paste'>,
  upload: (bytes: Uint8Array, ext: string) => Promise<string>,
  onError: (msg: string) => void,
  onBusy?: () => () => void
): () => void {
  const onDragOver = (e: DragEvent): void => e.preventDefault()
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    const end = onBusy?.()
    void (async () => {
      const paths: string[] = []
      for (const file of files) {
        const ext = IMAGE_TYPES[file.type]
        if (!ext) {
          onError(`${file.name}: not a supported image file`)
          continue
        }
        if (file.size > MAX_DROP_BYTES) {
          onError(`${file.name}: exceeds 10MB`)
          continue
        }
        try {
          paths.push(await upload(new Uint8Array(await file.arrayBuffer()), ext))
        } catch (err) {
          onError(errMsg(err))
        }
      }
      end?.()
      if (paths.length > 0) term.paste(paths.map(formatPath).join(' ') + ' ')
    })()
  }
  el.addEventListener('dragover', onDragOver)
  el.addEventListener('drop', onDrop)
  return () => {
    el.removeEventListener('dragover', onDragOver)
    el.removeEventListener('drop', onDrop)
  }
}
