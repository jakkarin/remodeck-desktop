import { describe, it, expect } from 'vitest'
import {
  parseStatusOutput,
  computeStatus,
  type RawStatus
} from '../../../src/main/gitAccess/statusParse'
import type { GitToken, HostGitAccess } from '../../../src/shared/gitAccess'

const raw = (over: Partial<RawStatus> = {}): RawStatus => ({
  helper: true,
  include: true,
  scopes: ['github.com/org-a'],
  cliPath: '/usr/bin/gh',
  cliVersion: '2.62.0',
  wrapper: { state: 'ours', version: 1 },
  home: '/home/u',
  loginResolves: '/home/u/.local/bin/gh',
  nonLoginResolves: '/home/u/.local/bin/gh',
  otherHelpers: [],
  ...over
})
const tok = (id: string, path: string, updatedAt = 't1'): GitToken => ({
  id,
  provider: 'github',
  host: 'github.com',
  path,
  login: 'x',
  label: id,
  expiresAt: null,
  updatedAt
})
const access = (installed: Record<string, string>): HostGitAccess => ({
  installedAt: 't0',
  installed,
  wrapperVersion: 1
})

describe('parseStatusOutput', () => {
  it('reads the key=value lines', () => {
    expect(
      parseStatusOutput(
        'helper=1\ninclude=1\nscope=github.com/org-a\nwrapper=ours:1\ncli_version=2.62.0\n'
      )
    ).toMatchObject({
      helper: true,
      include: true,
      scopes: ['github.com/org-a'],
      wrapper: { state: 'ours', version: 1 },
      cliVersion: '2.62.0',
      cliPath: null
    })
  })

  it('collects repeated keys, handles foreign/none wrappers and empty values', () => {
    const r = parseStatusOutput(
      'helper=0\ninclude=0\nscope=a/b\nscope=c/d\nother_helper=store\nother_helper=cache\nwrapper=foreign\ncli_path=\nresolve_login=/usr/bin/gh\nresolve_nonlogin=\nnoise\n'
    )
    expect(r.scopes).toEqual(['a/b', 'c/d'])
    expect(r.otherHelpers).toEqual(['store', 'cache'])
    expect(r.wrapper).toEqual({ state: 'foreign', version: null })
    expect(r).toMatchObject({
      helper: false,
      cliPath: null,
      loginResolves: '/usr/bin/gh',
      nonLoginResolves: null
    })
    expect(parseStatusOutput('').wrapper).toEqual({ state: 'none', version: null })
  })
})

describe('computeStatus', () => {
  it('passes the raw facts through', () => {
    const s = computeStatus(raw({ otherHelpers: ['store'] }), undefined, [], 1)
    expect(s).toMatchObject({
      helperInstalled: true,
      includeActive: true,
      scopesOnTarget: ['github.com/org-a'],
      cli: { path: '/usr/bin/gh', version: '2.62.0' },
      otherHelpers: ['store'],
      stale: [],
      missing: []
    })
    expect(s.wrapper).toEqual({
      state: 'ours',
      version: 1,
      outdated: false,
      loginShell: true,
      nonLoginShell: true
    })
  })

  it('flags a token changed since install as stale', () => {
    const s = computeStatus(raw(), access({ a: 't1' }), [tok('a', 'org-a', 't2')], 1)
    expect(s.stale).toEqual(['a'])
    expect(s.missing).toEqual([])
  })

  it('flags an installed scope that is not on the target as missing', () => {
    const s = computeStatus(
      raw(),
      access({ a: 't1', b: 't1' }),
      [tok('a', 'org-a'), tok('b', 'org-b')],
      1
    )
    expect(s.missing).toEqual(['b'])
    expect(s.stale).toEqual([])
  })

  it('flags an installed id whose token was removed as stale', () => {
    expect(computeStatus(raw(), access({ gone: 't1' }), [], 1).stale).toEqual(['gone'])
  })

  it('marks an older wrapper outdated', () => {
    expect(
      computeStatus(raw({ wrapper: { state: 'ours', version: 0 } }), undefined, [], 1).wrapper
        .outdated
    ).toBe(true)
    expect(
      computeStatus(raw({ wrapper: { state: 'foreign', version: null } }), undefined, [], 1).wrapper
        .outdated
    ).toBe(false)
  })

  it('loginShell / nonLoginShell are true only when the command resolves to our wrapper', () => {
    const s = computeStatus(
      raw({ loginResolves: '/usr/bin/gh', nonLoginResolves: null }),
      undefined,
      [],
      1
    )
    expect(s.wrapper).toMatchObject({ loginShell: false, nonLoginShell: false })
    // some other user's .local/bin/gh is not ours
    const other = computeStatus(raw({ loginResolves: '/home/v/.local/bin/gh' }), undefined, [], 1)
    expect(other.wrapper.loginShell).toBe(false)
    // an unknown home or an unknown probe ("?") is false
    expect(computeStatus(raw({ home: null }), undefined, [], 1).wrapper).toMatchObject({
      loginShell: false,
      nonLoginShell: false
    })
    const q = parseStatusOutput(
      'home=/home/u\nresolve_login=?\nresolve_nonlogin=/home/u/.local/bin/gh\n'
    )
    expect(q.loginResolves).toBeNull()
    expect(computeStatus(q, undefined, [], 1).wrapper).toMatchObject({
      loginShell: false,
      nonLoginShell: true
    })
  })
})
