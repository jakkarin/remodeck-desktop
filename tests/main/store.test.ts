import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../../src/main/store/store'
import type { PushLogEntry } from '../../src/shared/types'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regit-store-'))
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
    expect(s.config).toEqual({ hosts: [], repos: [], workspaces: [] })
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
})
