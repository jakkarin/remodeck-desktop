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
 * The local host also takes Windows drive paths (`D:/x`, `D:\x`).
 */
export function validateSandboxPath(p: string, opts?: { local?: boolean }): void {
  const rest = p.startsWith('~/')
    ? p.slice(2)
    : p.startsWith('/')
      ? p.slice(1)
      : opts?.local && DRIVE_PATH.test(p)
        ? p.slice(3)
        : null
  if (rest === null || rest.replace(/[\\/]/g, '') === '') {
    throw new Error('Path must start with / or ~/')
  }
}

/**
 * Canonical form of a local-host path: forward slashes, upper-case drive, no trailing `/`.
 * Git Bash's `/d/x` becomes `D:/x`; `~` and other paths only lose the trailing `/`.
 */
export function normalizeLocalPath(p: string): string {
  let s = p.replaceAll('\\', '/')
  const msys = MSYS_DRIVE.exec(s)
  if (msys) s = `${msys[1]}:/${s.slice(msys[0].length)}`
  if (/^[A-Za-z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1)
  const trimmed = s.replace(/\/+$/, '')
  return /^[A-Z]:$/.test(trimmed) ? `${trimmed}/` : trimmed || s
}

/** Whether two sandbox paths name the same folder; local paths compare normalised and case-insensitively. */
export function sameSandboxPath(a: string, b: string, local: boolean): boolean {
  if (!local) return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
  return normalizeLocalPath(a).toLowerCase() === normalizeLocalPath(b).toLowerCase()
}
