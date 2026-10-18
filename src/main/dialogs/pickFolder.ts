import { normalizeLocalPath } from '../sandbox/shell'

/** Electron's showOpenDialog, narrowed to what the folder picker needs; injected so tests need no window. */
export type ShowFolderDialog = (opts: {
  defaultPath?: string
}) => Promise<{ canceled: boolean; filePaths: string[] }>

const WINDOWS = process.platform === 'win32'
const LOCAL_START = WINDOWS
  ? /^(?:[A-Za-z]:[\\/]|~(?:[\\/]|$)|\/[A-Za-z](?:\/|$))/
  : /^(?:~(?:\/|$)|\/)/

/**
 * Asks the user for a folder on This computer. `start` comes from the renderer, so it only opens the
 * dialog at that folder when it looks like a local path; the answer is normalised like a typed path.
 */
export async function pickFolder(
  show: ShowFolderDialog,
  start: unknown,
  homeDir: string
): Promise<string | null> {
  const opts: { defaultPath?: string } = {}
  if (typeof start === 'string' && LOCAL_START.test(start.trim())) {
    const p = normalizeLocalPath(start.trim(), homeDir)
    opts.defaultPath = WINDOWS ? p.replaceAll('/', '\\') : p
  }
  const r = await show(opts)
  if (r.canceled || r.filePaths.length === 0) return null
  return normalizeLocalPath(r.filePaths[0])
}
