import { localPlatform, type LocalPlatform } from '../platform/localPlatform'

/** Electron's showOpenDialog, narrowed to what the folder picker needs; injected so tests need no window. */
export type ShowFolderDialog = (opts: {
  defaultPath?: string
}) => Promise<{ canceled: boolean; filePaths: string[] }>

/**
 * Asks the user for a folder on This computer. `start` comes from the renderer, so it only opens the
 * dialog at that folder when it looks like a local path; the answer is normalised like a typed path.
 */
export async function pickFolder(
  show: ShowFolderDialog,
  start: unknown,
  homeDir: string,
  platform: LocalPlatform = localPlatform
): Promise<string | null> {
  const opts: { defaultPath?: string } = {}
  if (typeof start === 'string' && platform.looksLikePath(start.trim()))
    opts.defaultPath = platform.toDialogPath(platform.normalizePath(start.trim(), homeDir))
  const r = await show(opts)
  if (r.canceled || r.filePaths.length === 0) return null
  return platform.normalizePath(r.filePaths[0])
}
