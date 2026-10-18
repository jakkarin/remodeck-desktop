import fs from 'node:fs'
import path from 'node:path'
import { requireAbsoluteOrHome } from '../sandbox/shell'

/** Where resolveBash looks; injected so tests need no real file system. */
export type BashLookup = {
  exists?(p: string): boolean
  pathEnv?: string
  programFiles?: string[]
}

/**
 * Everything about "This computer" that depends on the OS it runs on: which bash runs local scripts and
 * terminals, and how local sandbox paths are written, cleaned and compared. Pick one with localPlatformFor
 * (the app uses localPlatform, chosen once from process.platform) and pass it on; no other local code checks the OS.
 */
export interface LocalPlatform {
  readonly kind: 'windows' | 'linux' | 'mac'
  /** What the local shell is called in the UI and in errors. */
  readonly shellName: string
  /** The error local actions throw when resolveBash found nothing. */
  readonly bashMissing: string
  /** The bash local scripts and terminals run under, or null when it is not installed. */
  resolveBash(lookup?: BashLookup): string | null
  /** Throws when p is not a usable local sandbox path. */
  validatePath(p: string): void
  /** Canonical form of a local path: `~` expanded when homeDir is given, no trailing `/`. */
  normalizePath(p: string, homeDir?: string): string
  /** Whether two local paths name the same folder. */
  samePath(a: string, b: string, homeDir?: string): boolean
  /** Whether local shell scripts must compare paths case-insensitively (with bash 4's `${x,,}`). */
  readonly shellFoldsCase: boolean
  /** Whether a string from the renderer looks like a local path to open the folder picker at. */
  looksLikePath(p: string): boolean
  /** A normalised path in the form the native folder dialog takes. */
  toDialogPath(p: string): string
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const MSYS_DRIVE = /^\/([A-Za-z])(\/|$)/

const expandHome = (s: string, home: string | undefined): string =>
  home === undefined || (s !== '~' && !s.startsWith('~/'))
    ? s
    : s === '~'
      ? home
      : `${home.replace(/\/$/, '')}/${s.slice(2)}`

const trimSlashes = (s: string): string => s.replace(/\/+$/, '') || s

/**
 * Git for Windows' bash and Windows paths. `bash` on PATH is never used on its own: it is usually WSL's,
 * whose paths and HOME belong to another system. Of the `/` path forms only Git Bash's `/d/x` is taken:
 * other ones (`/tmp`, `/home`) mean one folder inside Git Bash and another to native git.exe and node-pty.
 */
export const windowsPlatform: LocalPlatform = {
  kind: 'windows',
  shellName: 'Git Bash',
  bashMissing: 'Git for Windows is required: install it from https://git-scm.com',
  resolveBash(lookup) {
    const exists = lookup?.exists ?? fs.existsSync
    const programFiles =
      lookup?.programFiles ??
      [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p)
    for (const dir of programFiles) {
      const bash = `${dir.replaceAll('\\', '/')}/Git/bin/bash.exe`
      if (exists(bash)) return bash
    }
    for (const dir of (lookup?.pathEnv ?? process.env.PATH ?? '').split(';')) {
      if (!dir || !exists(path.join(dir, 'git.exe'))) continue
      const bash = path.join(dir, '..', 'bin', 'bash.exe')
      if (exists(bash)) return bash
    }
    return null
  },
  validatePath(p) {
    if (p.startsWith('/') && !MSYS_DRIVE.test(p))
      throw new Error('Use a Windows path like D:/projects/app')
    requireAbsoluteOrHome(DRIVE_PATH.test(p) ? `/${p.slice(3)}` : p)
  },
  normalizePath(p, homeDir) {
    let s = expandHome(
      p.replaceAll('\\', '/'),
      homeDir === undefined ? undefined : this.normalizePath(homeDir)
    )
    const msys = MSYS_DRIVE.exec(s)
    if (msys) s = `${msys[1]}:/${s.slice(msys[0].length)}`
    if (/^[A-Za-z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1)
    const trimmed = s.replace(/\/+$/, '')
    return /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed || s
  },
  samePath(a, b, homeDir) {
    return (
      this.normalizePath(a, homeDir).toLowerCase() === this.normalizePath(b, homeDir).toLowerCase()
    )
  },
  shellFoldsCase: true,
  looksLikePath: (p) => /^(?:[A-Za-z]:[\\/]|~(?:[\\/]|$)|\/[A-Za-z](?:\/|$))/.test(p),
  toDialogPath: (p) => p.replaceAll('/', '\\')
}

/** /bin/bash (else the first bash on PATH) and plain POSIX paths; caseInsensitive for macOS' default APFS. */
function posixPlatform(kind: 'linux' | 'mac', caseInsensitive: boolean): LocalPlatform {
  return {
    kind,
    shellName: 'bash',
    bashMissing: 'bash is required: install it with your package manager',
    resolveBash(lookup) {
      const exists = lookup?.exists ?? fs.existsSync
      if (exists('/bin/bash')) return '/bin/bash'
      for (const dir of (lookup?.pathEnv ?? process.env.PATH ?? '').split(':')) {
        const bash = `${dir.replace(/\/$/, '')}/bash`
        if (dir && exists(bash)) return bash
      }
      return null
    },
    validatePath: requireAbsoluteOrHome,
    normalizePath: (p, homeDir) =>
      trimSlashes(expandHome(p, homeDir === undefined ? undefined : trimSlashes(homeDir))),
    samePath(a, b, homeDir) {
      const norm = (p: string): string => {
        const n = this.normalizePath(p, homeDir)
        return caseInsensitive ? n.toLowerCase() : n
      }
      return norm(a) === norm(b)
    },
    // macOS' /bin/bash is 3.2, which has no `${x,,}`
    shellFoldsCase: false,
    looksLikePath: (p) => /^(?:~(?:\/|$)|\/)/.test(p),
    toDialogPath: (p) => p
  }
}

export const linuxPlatform = posixPlatform('linux', false)
export const macPlatform = posixPlatform('mac', true)

export function localPlatformFor(platform: NodeJS.Platform): LocalPlatform {
  return platform === 'win32'
    ? windowsPlatform
    : platform === 'darwin'
      ? macPlatform
      : linuxPlatform
}

/** The platform this app runs on. */
export const localPlatform = localPlatformFor(process.platform)
