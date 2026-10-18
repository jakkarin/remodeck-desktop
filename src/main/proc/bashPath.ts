import fs from 'node:fs'
import path from 'node:path'

export const BASH_MISSING =
  process.platform === 'win32'
    ? 'Git for Windows is required: install it from https://git-scm.com'
    : 'bash is required: install it with your package manager'

/**
 * The bash the local host runs under, or null when it is not installed.
 * On Windows this is Git for Windows' bash.exe; `bash` on PATH is never used on its own there:
 * it is usually WSL's, whose paths and HOME belong to another system.
 * Elsewhere it is /bin/bash, else the first `bash` on PATH.
 */
export function resolveBashPath(deps?: {
  exists?(p: string): boolean
  pathEnv?: string
  programFiles?: string[]
  platform?: NodeJS.Platform
}): string | null {
  const exists = deps?.exists ?? fs.existsSync
  const pathEnv = deps?.pathEnv ?? process.env.PATH ?? ''
  if ((deps?.platform ?? process.platform) !== 'win32') {
    if (exists('/bin/bash')) return '/bin/bash'
    for (const dir of pathEnv.split(':')) {
      const bash = `${dir.replace(/\/$/, '')}/bash`
      if (dir && exists(bash)) return bash
    }
    return null
  }
  const programFiles =
    deps?.programFiles ??
    [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p)
  for (const dir of programFiles) {
    const bash = `${dir.replaceAll('\\', '/')}/Git/bin/bash.exe`
    if (exists(bash)) return bash
  }
  for (const dir of pathEnv.split(';')) {
    if (!dir || !exists(path.join(dir, 'git.exe'))) continue
    const bash = path.join(dir, '..', 'bin', 'bash.exe')
    if (exists(bash)) return bash
  }
  return null
}
