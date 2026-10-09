import { scopeKey, type GitAccessStatus, type GitToken, type HostGitAccess } from '../../shared/gitAccess'

export type RawStatus = {
  helper: boolean
  include: boolean
  scopes: string[]
  cliPath: string | null
  cliVersion: string | null
  wrapper: { state: 'ours' | 'foreign' | 'none'; version: number | null }
  loginResolves: string | null
  nonLoginResolves: string | null
  otherHelpers: string[]
  home: string | null
}

/** Parses the `key=value` lines of the status script; unknown lines are ignored and, for a scalar key, the first line wins. */
export function parseStatusOutput(stdout: string): RawStatus {
  const raw: RawStatus = {
    helper: false,
    include: false,
    scopes: [],
    cliPath: null,
    cliVersion: null,
    wrapper: { state: 'none', version: null },
    loginResolves: null,
    nonLoginResolves: null,
    otherHelpers: [],
    home: null
  }
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq)
    const value = line.slice(eq + 1).replace(/\r$/, '')
    if (key === 'scope') {
      if (value) raw.scopes.push(value)
      continue
    }
    if (key === 'other_helper') {
      if (value) raw.otherHelpers.push(value)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    switch (key) {
      case 'helper':
        raw.helper = value === '1'
        break
      case 'include':
        raw.include = value === '1'
        break
      case 'home':
        raw.home = value || null
        break
      case 'cli_path':
        raw.cliPath = value || null
        break
      case 'cli_version':
        raw.cliVersion = value || null
        break
      case 'resolve_login':
        raw.loginResolves = value === '?' ? null : value || null
        break
      case 'resolve_nonlogin':
        raw.nonLoginResolves = value === '?' ? null : value || null
        break
      case 'wrapper': {
        const m = /^ours:(\d+)$/.exec(value)
        if (m) raw.wrapper = { state: 'ours', version: Number(m[1]) }
        else if (value === 'foreign') raw.wrapper = { state: 'foreign', version: null }
        break
      }
    }
  }
  return raw
}

/** Compares what the target reports with what remodeck recorded at install time. */
export function computeStatus(
  raw: RawStatus,
  access: HostGitAccess | undefined,
  tokens: GitToken[],
  wrapperVersion: number
): GitAccessStatus {
  const stale: string[] = []
  const missing: string[] = []
  for (const [id, installedUpdatedAt] of Object.entries(access?.installed ?? {})) {
    const token = tokens.find((t) => t.id === id)
    // a token deleted since install still sits on the host
    if (!token || token.updatedAt !== installedUpdatedAt) stale.push(id)
    if (token && !raw.scopes.includes(scopeKey(token))) missing.push(id)
  }
  // exactly where our wrapper lives; an unknown home or probe means false
  const resolvesToWrapper = (p: string | null): boolean => p !== null && raw.home !== null && p === `${raw.home}/.local/bin/gh`
  return {
    helperInstalled: raw.helper,
    includeActive: raw.include,
    scopesOnTarget: raw.scopes,
    cli: { path: raw.cliPath, version: raw.cliVersion },
    wrapper: {
      state: raw.wrapper.state,
      version: raw.wrapper.version,
      outdated: raw.wrapper.state === 'ours' && (raw.wrapper.version ?? 0) < wrapperVersion,
      loginShell: resolvesToWrapper(raw.loginResolves),
      nonLoginShell: resolvesToWrapper(raw.nonLoginResolves)
    },
    otherHelpers: raw.otherHelpers,
    stale,
    missing
  }
}
