// Git access scope model shared by main and renderer: pure helpers and types, no node imports.

export type GitProviderId = 'github'

export type GitToken = {
  id: string
  provider: GitProviderId
  host: string
  path: string
  login: string
  label: string
  expiresAt: string | null
  updatedAt: string
}

export type HostGitAccess = {
  installedAt: string
  installed: Record<string, string>
  wrapperVersion: number | null
}

/** pathBlock: the user agreed to put ~/.local/bin first in PATH from the top of ~/.bashrc. */
export type InstallOptions = { pathBlock?: boolean }

export type PathBlockState ='present' | 'absent' | 'symlink' | 'partial'

export type GitAccessStatus = {
  helperInstalled: boolean
  includeActive: boolean
  scopesOnTarget: string[]
  cli: { path: string | null; version: string | null }
  wrapper: {
    state: 'ours' | 'foreign' | 'none'
    version: number | null
    outdated: boolean
    loginShell: boolean
    nonLoginShell: boolean
  }
  otherHelpers: string[]
  /** Our PATH block at the top of ~/.bashrc; `partial` = begin marker without an end marker. */
  pathBlock: PathBlockState
  stale: string[]
  missing: string[]
}

const HOST_LABEL_RE = /^(?=.*[a-z0-9])[a-z0-9-]+$/
const SEGMENT_RE = /^[a-z0-9._-]+$/
const TOKEN_RE = /^[\x21-\x7e]{1,512}$/

/** Lowercases, trims surrounding slashes and drops a trailing `.git`. */
export function normalizeScopePath(path: string): string {
  return path
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

/** Returns an error message for an invalid host or scope path, or null when valid. */
export function validateScope(host: string, path: string): string | null {
  if (!host.split('.').every((label) => HOST_LABEL_RE.test(label))) return `Invalid host "${host}"`
  const normalized = normalizeScopePath(path)
  if (normalized === '') return 'Scope path must not be empty'
  for (const segment of normalized.split('/')) {
    if (segment === '.' || segment === '..' || !SEGMENT_RE.test(segment))
      return `Invalid path segment "${segment}"`
  }
  return null
}

export function scopeKey(s: { host: string; path: string }): string {
  return `${s.host}/${s.path}`
}

/** Orders by host, then path segment by segment; a shorter prefix sorts first. */
export function compareScopes(
  a: { host: string; path: string },
  b: { host: string; path: string }
): number {
  if (a.host !== b.host) return a.host < b.host ? -1 : 1
  const as = a.path.split('/')
  const bs = b.path.split('/')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1
  }
  return as.length - bs.length
}

/** Returns the most specific item whose host matches and whose path is a segment prefix of repoPath. */
export function matchScope<T extends { host: string; path: string }>(
  items: T[],
  host: string,
  repoPath: string
): T | null {
  const segments = normalizeScopePath(repoPath).split('/')
  for (let n = segments.length; n >= 1; n--) {
    const candidate = segments.slice(0, n).join('/')
    const found = items.find((item) => item.host === host && item.path === candidate)
    if (found) return found
  }
  return null
}

/** A token is 1 to 512 printable ASCII characters with no whitespace. */
export function isValidTokenValue(token: string): boolean {
  return TOKEN_RE.test(token)
}
