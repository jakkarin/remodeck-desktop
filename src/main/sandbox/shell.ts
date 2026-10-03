/** Single-quotes a string for POSIX sh. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\''`)}'`
}

/** Quotes a remote path, expanding a leading `~` to "$HOME". */
export function shPath(p: string): string {
  if (p === '~') return '"$HOME"'
  if (p.startsWith('~/')) return `"$HOME"/${shQuote(p.slice(2))}`
  return shQuote(p)
}
