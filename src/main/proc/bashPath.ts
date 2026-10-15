import fs from 'node:fs'
import path from 'node:path'

export const BASH_MISSING = 'Git for Windows is required: install it from https://git-scm.com'

/**
 * Git for Windows' bash.exe, or null when it is not installed. `bash` on PATH is never used on its own:
 * on Windows it is usually WSL's, whose paths and HOME belong to another system.
 */
export function resolveBashPath(deps?: {
  exists?(p: string): boolean
  pathEnv?: string
  programFiles?: string[]
}): string | null {
  const exists = deps?.exists ?? fs.existsSync
  const programFiles =
    deps?.programFiles ??
    [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p)
  for (const dir of programFiles) {
    const bash = `${dir.replaceAll('\\', '/')}/Git/bin/bash.exe`
    if (exists(bash)) return bash
  }
  for (const dir of (deps?.pathEnv ?? process.env.PATH ?? '').split(';')) {
    if (!dir || !exists(path.join(dir, 'git.exe'))) continue
    const bash = path.join(dir, '..', 'bin', 'bash.exe')
    if (exists(bash)) return bash
  }
  return null
}
