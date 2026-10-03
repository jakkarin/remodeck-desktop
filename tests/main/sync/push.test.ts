import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { SyncService } from '../../../src/main/sync/syncService'
import { git, makeFakeGitHub, makeTmp } from '../../helpers/repos'

const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

describe('SyncService.pushToGitHub', () => {
  let tmp: string
  let home: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let store: Store
  let svc: SyncService

  beforeEach(async () => {
    tmp = makeTmp()
    home = path.join(tmp, 'home')
    fs.mkdirSync(home, { recursive: true })
    gh = makeFakeGitHub(tmp)
    store = new Store(path.join(tmp, 'data'))
    const host = new HostGit()
    svc = new SyncService({
      git: host,
      mirror: new MirrorService(host, () => gh.url),
      store,
      targetFor: () => new LocalTarget(home)
    })
    await gh.seed({ 'a.txt': 'hi' })
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const sb = (rel: string) => path.join(home, rel)
  const makeWs = async (rel: string) => {
    const repo = store.upsertRepo('acme', 'api')
    const h = store.config.hosts[0] ?? store.addHost('box', 'Box')
    const ws = store.addWorkspace(repo.id, h.id, `~/${rel}`)
    await svc.cloneToSandbox(ws)
    return ws
  }
  const commit = async (dir: string, file: string, msg: string) => {
    fs.writeFileSync(path.join(dir, file), msg)
    await git(dir, 'add', '-A')
    await git(dir, ...ident, 'commit', '-m', msg)
    return (await git(dir, 'rev-parse', 'HEAD')).trim()
  }
  const ghSha = async (branch: string) => (await git(gh.url, 'rev-parse', `refs/heads/${branch}`)).trim()

  it('pushes a sandbox branch to GitHub and logs it', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    const sha = await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    expect(await svc.pushToGitHub(ws, 'feat/a', 'feat/a')).toEqual({ ok: true })
    expect(await ghSha('feat/a')).toBe(sha)
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      repo: 'acme/api',
      workspaceId: ws.id,
      channel: 'review',
      result: 'ok',
      updates: [{ oldSha: '0'.repeat(40), newSha: sha, ref: 'refs/heads/feat/a' }]
    })
  })

  it('blocks pushes to protected branches without running git', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    const before = await ghSha('main')
    const res = await svc.pushToGitHub(ws, 'feat/a', 'main')
    expect(res).toEqual({ ok: false, reason: 'protected', message: 'branch main ถูกป้องกัน — แก้ได้ใน Settings' })
    expect(await ghSha('main')).toBe(before)
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ result: 'blocked', detail: 'branch main ถูกป้องกัน — แก้ได้ใน Settings' })
    expect(log[0].updates[0]).toMatchObject({ oldSha: before, ref: 'refs/heads/main' })
  })

  it('reports non-fast-forward when GitHub moved ahead, never forcing', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat-x')
    await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    expect((await svc.pushToGitHub(ws, 'feat-x', 'feat-x')).ok).toBe(true)
    const ghTip = await gh.seed({ 'other.txt': 'gh' }, 'feat-x')
    await commit(sb('w1'), 'g.txt', 'two')
    await svc.sync(ws)
    const res = await svc.pushToGitHub(ws, 'feat-x', 'feat-x')
    expect(res).toEqual({
      ok: false,
      reason: 'non-fast-forward',
      message: 'GitHub มี commit ใหม่กว่า — กด Sync แล้วให้ AI rebase บน origin/feat-x'
    })
    expect(await ghSha('feat-x')).toBe(ghTip)
    expect(store.readPushLog(10).map((e) => e.result)).toEqual(['rejected', 'ok'])
  })
})
