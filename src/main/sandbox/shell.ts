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

/** Sandbox paths must be absolute or a subdirectory of `~/` (relative and `~user` forms are rejected). */
export function validateSandboxPath(p: string): void {
  const rest = p.startsWith('~/') ? p.slice(2) : p.startsWith('/') ? p.slice(1) : null
  if (rest === null || rest.replace(/\//g, '') === '') {
    throw new Error('path ต้องขึ้นต้นด้วย / หรือ ~/')
  }
}
