import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../../src/main/store/store'
import { scopeKey } from '../../src/shared/gitAccess'
import { DEFAULT_PREFS, isLocalHost, type PushLogEntry } from '../../src/shared/types'

/** Hosts other than the built-in local one. */
const ssh = (h: { id: string }): boolean => h.id !== 'local'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-store-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const entry = (n: number): PushLogEntry => ({
  time: `t${n}`,
  repo: 'acme/api',
  workspaceId: null,
  channel: 'review',
  updates: [],
  result: 'ok'
})

describe('Store', () => {
  it('starts empty and creates missing dir', () => {
    const nested = path.join(dir, 'a', 'b')
    const s = new Store(nested)
    expect({ ...s.config, hosts: s.config.hosts.filter(ssh) }).toEqual({
      hosts: [],
      repos: [],
      workspaces: [],
      prefs: DEFAULT_PREFS,
      gitTokens: []
    })
    s.addHost('h', 'H')
    expect(fs.existsSync(path.join(nested, 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(nested, 'config.json.tmp'))).toBe(false)
  })

  it('persists hosts, repos, workspaces', () => {
    const s = new Store(dir)
    const h = s.addHost('dev', 'Dev')
    const r = s.upsertRepo('acme', 'api')
    const w = s.addWorkspace(r.id, h.id, '/home/x/api')
    const s2 = new Store(dir)
    expect(s2.config.hosts.filter(ssh)).toEqual([h])
    expect(s2.config.repos).toEqual([r])
    expect(s2.config.workspaces).toEqual([w])
    expect(h.id).toHaveLength(8)
  })

  it('upsertRepo dedupes case-insensitively and applies defaults', () => {
    const s = new Store(dir)
    const a = s.upsertRepo('Acme', 'API')
    const b = s.upsertRepo('acme', 'api')
    expect(b.id).toBe(a.id)
    expect(s.config.repos).toHaveLength(1)
    expect(a).toMatchObject({
      defaultBranch: 'main',
      protectedBranches: ['main', 'master'],
      alwaysAllowPush: false,
      enforceRules: true
    })
  })

  it('updateRepo patches and throws on unknown id', () => {
    const s = new Store(dir)
    const r = s.upsertRepo('a', 'b')
    const u = s.updateRepo(r.id, { alwaysAllowPush: true })
    expect(u.alwaysAllowPush).toBe(true)
    expect(new Store(dir).config.repos[0].alwaysAllowPush).toBe(true)
    expect(() => s.updateRepo('nope', {})).toThrow()
  })

  it('mirrorPath is lowercased', () => {
    const s = new Store(dir)
    const r = s.upsertRepo('Acme', 'API')
    expect(s.mirrorPath(r).split(path.sep).join('/')).toMatch(/mirrors\/acme\/api\.git$/)
  })

  it('removeHost throws when it has workspaces; removeWorkspace works', () => {
    const s = new Store(dir)
    const h = s.addHost('dev', 'Dev')
    const r = s.upsertRepo('a', 'b')
    const w = s.addWorkspace(r.id, h.id, '/x')
    expect(() => s.removeHost(h.id)).toThrow()
    s.removeWorkspace(w.id)
    expect(() => s.removeWorkspace(w.id)).toThrow()
    s.removeHost(h.id)
    expect(s.config.hosts.filter(ssh)).toEqual([])
  })

  it('removeHost refuses while git access is set on the host', () => {
    const s = new Store(dir)
    const h = s.addHost('dev', 'Dev')
    s.setHostGitAccess(h.id, { installedAt: 't', installed: {}, wrapperVersion: null })
    expect(() => s.removeHost(h.id)).toThrow('Remove git access from this host first')
    expect(s.config.hosts.filter(ssh)).toHaveLength(1)
    s.setHostGitAccess(h.id, null)
    s.removeHost(h.id)
    expect(s.config.hosts.filter(ssh)).toEqual([])
  })

  it('push log returns newest first and limited', () => {
    const s = new Store(dir)
    expect(s.readPushLog(5)).toEqual([])
    s.appendPushLog(entry(1))
    s.appendPushLog(entry(2))
    s.appendPushLog(entry(3))
    expect(s.readPushLog(2).map((e) => e.time)).toEqual(['t3', 't2'])
  })

  it('push log skips torn or unparsable lines', () => {
    const s = new Store(dir)
    s.appendPushLog(entry(1))
    fs.appendFileSync(path.join(dir, 'push-log.jsonl'), 'not json\n')
    s.appendPushLog(entry(2))
    fs.appendFileSync(path.join(dir, 'push-log.jsonl'), '{"time":"t3","repo"')
    expect(s.readPushLog(10).map((e) => e.time)).toEqual(['t2', 't1'])
    expect(s.readPushLog(1).map((e) => e.time)).toEqual(['t2'])
  })

  it('addHost rejects an empty, option-like or whitespace ssh host', () => {
    const s = new Store(dir)
    for (const bad of ['', '-oProxyCommand=calc', 'a b', ' box', 'box\t']) {
      expect(() => s.addHost(bad, 'x'), JSON.stringify(bad)).toThrow('Invalid ssh host')
    }
    expect(s.config.hosts.filter(ssh)).toEqual([])
    expect(s.addHost('user@box.example', 'Box').sshHost).toBe('user@box.example')
  })

  describe('prefs', () => {
    const writeCfg = (raw: unknown): void =>
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(raw))

    it('defaults when config has no prefs', () => {
      writeCfg({ hosts: [], repos: [], workspaces: [] })
      expect(new Store(dir).config.prefs).toEqual(DEFAULT_PREFS)
    })

    it('invalid stored fields fall back individually', () => {
      writeCfg({
        prefs: { theme: 'neon', terminalFontSize: 99, defaultProtectedBranches: 'main' }
      })
      expect(new Store(dir).config.prefs).toEqual(DEFAULT_PREFS)
      writeCfg({
        prefs: { theme: 'dark', terminalFontSize: 12.5, defaultProtectedBranches: ['x', ''] }
      })
      expect(new Store(dir).config.prefs).toEqual({ ...DEFAULT_PREFS, theme: 'dark' })
      writeCfg({
        prefs: { theme: 'light', terminalFontSize: 16, defaultProtectedBranches: ['dev'] }
      })
      expect(new Store(dir).config.prefs).toEqual({
        theme: 'light',
        terminalFontSize: 16,
        defaultProtectedBranches: ['dev']
      })
    })

    it('updatePrefs validates, merges, dedupes and persists', () => {
      const s = new Store(dir)
      expect(s.updatePrefs({ theme: 'dark' })).toEqual({ ...DEFAULT_PREFS, theme: 'dark' })
      const r = s.updatePrefs({ terminalFontSize: 18, defaultProtectedBranches: [' a ', 'b', 'a'] })
      expect(r).toEqual({
        theme: 'dark',
        terminalFontSize: 18,
        defaultProtectedBranches: ['a', 'b']
      })
      expect(new Store(dir).config.prefs).toEqual(r)
    })

    it('updatePrefs rejects invalid values without changing anything', () => {
      const s = new Store(dir)
      expect(() => s.updatePrefs({ theme: 'x' as never })).toThrow()
      expect(() => s.updatePrefs({ terminalFontSize: 9 })).toThrow()
      expect(() => s.updatePrefs({ terminalFontSize: 21 })).toThrow()
      expect(() => s.updatePrefs({ terminalFontSize: 12.5 })).toThrow()
      expect(() => s.updatePrefs({ defaultProtectedBranches: 'main' as never })).toThrow()
      expect(() => s.updatePrefs({ defaultProtectedBranches: ['a', '  '] })).toThrow()
      expect(s.config.prefs).toEqual(DEFAULT_PREFS)
    })

    it('upsertRepo uses default protected branches for new repos only', () => {
      const s = new Store(dir)
      const a = s.upsertRepo('a', 'one')
      s.updatePrefs({ defaultProtectedBranches: ['release'] })
      const b = s.upsertRepo('a', 'two')
      expect(b.protectedBranches).toEqual(['release'])
      expect(b.protectedBranches).not.toBe(s.config.prefs.defaultProtectedBranches)
      expect(s.upsertRepo('a', 'one').protectedBranches).toEqual(a.protectedBranches)
      expect(a.protectedBranches).toEqual(['main', 'master'])
    })
  })

  it('updateHost renames, trims, persists; rejects blank label and unknown id', () => {
    const s = new Store(dir)
    const h = s.addHost('box', 'Box')
    const u = s.updateHost(h.id, { label: '  Work box ' })
    expect(u).toEqual({ id: h.id, sshHost: 'box', label: 'Work box', protected: false })
    expect(new Store(dir).config.hosts.filter(ssh)[0].label).toBe('Work box')
    expect(() => s.updateHost(h.id, { label: '   ' })).toThrow()
    expect(() => s.updateHost('nope', { label: 'x' })).toThrow('Unknown host')
  })

  it('adds hosts unprotected', () => {
    const store = new Store(dir)
    expect(store.addHost('box', 'Box').protected).toBe(false)
  })

  it('loads old hosts without protected as unprotected, and coerces non-booleans', () => {
    fs.writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({
        hosts: [
          { id: 'a', sshHost: 'a', label: 'A' },
          { id: 'b', sshHost: 'b', label: 'B', protected: 'yes' }
        ]
      })
    )
    const s = new Store(dir)
    expect(s.config.hosts.filter(ssh).map((h) => h.protected)).toEqual([false, false])
  })

  it('updates protected without touching the label', () => {
    const store = new Store(dir)
    const h = store.addHost('box', 'Box')
    expect(store.updateHost(h.id, { protected: true })).toMatchObject({
      label: 'Box',
      protected: true
    })
    expect(new Store(dir).config.hosts.filter(ssh)[0].protected).toBe(true)
  })

  it('rejects a non-boolean protected', () => {
    const store = new Store(dir)
    const h = store.addHost('box', 'Box')
    expect(() => store.updateHost(h.id, { protected: 'x' as never })).toThrow()
  })
})

describe('Store git access', () => {
  const base = {
    provider: 'github' as const,
    host: 'github.com',
    path: 'org-a',
    login: 'j',
    label: 'A',
    expiresAt: null
  }

  it('upserts tokens by scope, keeps the id on rotate and persists', () => {
    const s = new Store(dir)
    const t = s.upsertGitToken(base)
    const t2 = s.upsertGitToken({ ...base, label: 'B' })
    expect(t2.id).toBe(t.id)
    expect(t2.label).toBe('B')
    expect(t2.updatedAt >= t.updatedAt).toBe(true)
    expect(new Store(dir).config.gitTokens).toHaveLength(1)
  })

  it('keeps tokens sorted by scope and rejects invalid scopes', () => {
    const s = new Store(dir)
    s.upsertGitToken({ ...base, path: 'zed' })
    s.upsertGitToken({ ...base, path: 'org-a/repo' })
    s.upsertGitToken({ ...base, path: 'org-a' })
    expect(s.config.gitTokens.map(scopeKey)).toEqual([
      'github.com/org-a',
      'github.com/org-a/repo',
      'github.com/zed'
    ])
    expect(() => s.upsertGitToken({ ...base, path: '../x' })).toThrow()
  })

  it('sets a label and removes a token', () => {
    const s = new Store(dir)
    const t = s.upsertGitToken(base)
    expect(s.setGitTokenLabel(t.id, '  New ').label).toBe('New')
    expect(() => s.setGitTokenLabel(t.id, ' ')).toThrow(/empty/)
    expect(() => s.setGitTokenLabel('nope', 'x')).toThrow(/Unknown git token/)
    s.removeGitToken(t.id)
    expect(new Store(dir).config.gitTokens).toEqual([])
    expect(() => s.removeGitToken(t.id)).toThrow(/Unknown git token/)
  })

  it('sets and clears host git access', () => {
    const s = new Store(dir)
    const h = s.addHost('h', 'H')
    const t = s.upsertGitToken(base)
    s.setHostGitAccess(h.id, {
      installedAt: 'x',
      installed: { [t.id]: t.updatedAt },
      wrapperVersion: 1
    })
    expect(new Store(dir).config.hosts.filter(ssh)[0].gitAccess?.wrapperVersion).toBe(1)
    s.setHostGitAccess(h.id, null)
    expect(s.config.hosts.filter(ssh)[0].gitAccess).toBeUndefined()
    expect(new Store(dir).config.hosts.filter(ssh)[0].gitAccess).toBeUndefined()
    expect(() => s.setHostGitAccess('nope', null)).toThrow(/Unknown host/)
  })

  it('loads legacy config without gitTokens and drops invalid or malformed entries', () => {
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, JSON.stringify({ hosts: [], repos: [], workspaces: [] }))
    expect(new Store(dir).config.gitTokens).toEqual([])
    const good = {
      id: 'a',
      provider: 'github',
      host: 'github.com',
      path: 'o',
      login: 'j',
      label: 'L',
      expiresAt: null,
      updatedAt: 't'
    }
    fs.writeFileSync(
      file,
      JSON.stringify({
        hosts: [
          {
            id: 'h1',
            sshHost: 'a',
            label: 'A',
            gitAccess: { installedAt: 'x', installed: {}, wrapperVersion: null }
          },
          { id: 'h2', sshHost: 'b', label: 'B', gitAccess: 'junk' }
        ],
        gitTokens: [good, { ...good, id: 'b', path: '../bad' }, null]
      })
    )
    const c = new Store(dir).config
    expect(c.gitTokens.map((t) => t.id)).toEqual(['a'])
    expect(c.hosts.filter(ssh)[0].gitAccess).toBeDefined()
    expect(c.hosts.filter(ssh)[1].gitAccess).toBeUndefined()
  })
})

describe('Store local host', () => {
  const LOCAL = {
    id: 'local',
    kind: 'local',
    sshHost: '',
    label: 'This computer',
    protected: false
  }
  const writeRaw = (cfg: unknown): void =>
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg))

  it('adds This computer on a fresh store', () => {
    const s = new Store(dir)
    expect(s.config.hosts[0]).toEqual(LOCAL)
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
    expect(disk.hosts[0]).toEqual(LOCAL)
  })

  it('moves an existing local host to the top and keeps its label', () => {
    writeRaw({
      hosts: [
        { id: 'a', sshHost: 'a', label: 'A', protected: false },
        { id: 'local', sshHost: 'x', label: 'Mine', protected: true }
      ],
      repos: [],
      workspaces: []
    })
    const s = new Store(dir)
    expect(s.config.hosts.map((h) => h.id)).toEqual(['local', 'a'])
    expect(s.config.hosts[0]).toEqual({ ...LOCAL, label: 'Mine', protected: true })
  })

  it('loads old ssh hosts without kind', () => {
    writeRaw({
      hosts: [{ id: 'a', sshHost: 'a', label: 'A', protected: false }],
      repos: [],
      workspaces: []
    })
    const a = new Store(dir).config.hosts.find((h) => h.id === 'a')!
    expect(a.kind).toBeUndefined()
    expect(isLocalHost(a)).toBe(false)
  })

  it('refuses to remove This computer', () => {
    const s = new Store(dir)
    expect(() => s.removeHost('local')).toThrow('This computer cannot be removed')
  })
})
