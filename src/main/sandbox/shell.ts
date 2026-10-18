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

/** Throws unless p is absolute or a subdirectory of `~/` (relative and `~user` forms are rejected). */
export function requireAbsoluteOrHome(p: string): void {
  const rest = p.startsWith('~/') ? p.slice(2) : p.startsWith('/') ? p.slice(1) : null
  if (rest === null || rest.replace(/[\\/]/g, '') === '') {
    throw new Error('Path must start with / or ~/')
  }
}

/**
 * Checks a sandbox path. Remote hosts take POSIX paths; pass the LocalPlatform for This computer,
 * whose rules depend on the OS (Windows drive paths, say).
 */
export function validateSandboxPath(p: string, local?: { validatePath(p: string): void }): void {
  if (local) local.validatePath(p)
  else requireAbsoluteOrHome(p)
}
