/** Single-quotes a string for POSIX sh. */
export function shQuote(s: string): string {
  return "'" + s.replaceAll("'", "'\\''") + "'"
}

/** Quotes a remote path, expanding a leading `~` to "$HOME". */
export function shPath(p: string): string {
  if (p === '~') return '"$HOME"'
  if (p.startsWith('~/')) return `"$HOME"/${shQuote(p.slice(2))}`
  return shQuote(p)
}

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const MSYS_DRIVE = /^\/([A-Za-z])(\/|$)/

/**
 * Sandbox paths must be absolute or a subdirectory of `~/` (relative and `~user` forms are rejected).
 * On Windows the local host also takes drive paths (`D:/x`, `D:\x`), but of the `/` forms only Git Bash's `/d/x`:
 * other ones (`/tmp`, `/home`) mean one folder inside Git Bash and another to native git.exe and node-pty.
 * On other platforms the local host takes plain POSIX paths.
 */
export function validateSandboxPath(
  p: string,
  opts?: { local?: boolean; platform?: NodeJS.Platform }
): void {
  const windows = !!opts?.local && (opts.platform ?? process.platform) === 'win32'
  if (windows && p.startsWith('/') && !MSYS_DRIVE.test(p))
    throw new Error('Use a Windows path like D:/projects/app')
  const rest = p.startsWith('~/')
    ? p.slice(2)
    : p.startsWith('/')
      ? p.slice(1)
      : windows && DRIVE_PATH.test(p)
        ? p.slice(3)
        : null
  if (rest === null || rest.replace(/[\\/]/g, '') === '') {
    throw new Error('Path must start with / or ~/')
  }
}

/**
 * Canonical form of a local-host path: `~` expanded when homeDir is given, no trailing `/`.
 * On Windows also forward slashes and an upper-case drive, with Git Bash's `/d/x` becoming `D:/x`.
 */
export function normalizeLocalPath(
  p: string,
  homeDir?: string,
  platform: NodeJS.Platform = process.platform
): string {
  const windows = platform === 'win32'
  let s = windows ? p.replaceAll('\\', '/') : p
  if (homeDir !== undefined && (s === '~' || s.startsWith('~/'))) {
    const home = normalizeLocalPath(homeDir, undefined, platform)
    s = s === '~' ? home : `${home.replace(/\/$/, '')}/${s.slice(2)}`
  }
  if (windows) {
    const msys = MSYS_DRIVE.exec(s)
    if (msys) s = `${msys[1]}:/${s.slice(msys[0].length)}`
    if (/^[A-Za-z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1)
  }
  const trimmed = s.replace(/\/+$/, '')
  return /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed || s
}

/**
 * Whether two sandbox paths name the same folder. Local paths compare normalised, and case-insensitively
 * on Windows and macOS, whose default file systems ignore case.
 */
export function sameSandboxPath(
  a: string,
  b: string,
  local: boolean,
  homeDir?: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!local) return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
  const fold = platform === 'win32' || platform === 'darwin'
  const norm = (p: string): string => {
    const n = normalizeLocalPath(p, homeDir, platform)
    return fold ? n.toLowerCase() : n
  }
  return norm(a) === norm(b)
}
