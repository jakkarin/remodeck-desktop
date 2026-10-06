import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../../src/main/store/store'
import { DEFAULT_PREFS, type PushLogEntry } from '../../src/shared/types'

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
    expect(s.config).toEqual({
      hosts: [],
      repos: [],
      workspaces: [],
      prefs: DEFAULT_PREFS
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
    expect(s2.config.hosts).toEqual([h])
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
    expect(s.config.hosts).toEqual([])
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
      expect(() => s.addHost(bad, 'x'), JSON.stringify(bad)).toThrow('ssh host ไม่ถูกต้อง')
    }
    expect(s.config.hosts).toEqual([])
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
    expect(new Store(dir).config.hosts[0].label).toBe('Work box')
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
    expect(s.config.hosts.map((h) => h.protected)).toEqual([false, false])
  })

  it('updates protected without touching the label', () => {
    const store = new Store(dir)
    const h = store.addHost('box', 'Box')
    expect(store.updateHost(h.id, { protected: true })).toMatchObject({
      label: 'Box',
      protected: true
    })
    expect(new Store(dir).config.hosts[0].protected).toBe(true)
  })

  it('rejects a non-boolean protected', () => {
    const store = new Store(dir)
    const h = store.addHost('box', 'Box')
    expect(() => store.updateHost(h.id, { protected: 'x' as never })).toThrow()
  })
})
