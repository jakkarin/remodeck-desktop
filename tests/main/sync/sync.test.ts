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

describe('SyncService.sync', () => {
  let tmp: string
  let home: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let store: Store
  let svc: SyncService
  let mirrorPath: string

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
    mirrorPath = store.mirrorPath(repo)
    return ws
  }
  const commit = async (dir: string, file: string, msg: string, ...extra: string[]) => {
    fs.writeFileSync(path.join(dir, file), msg)
    await git(dir, 'add', '-A')
    await git(dir, ...ident, 'commit', ...extra, '-m', msg)
    return (await git(dir, 'rev-parse', 'HEAD')).trim()
  }
  const rev = async (cwd: string, ref: string) => (await git(cwd, 'rev-parse', ref)).trim()

  it('fetches sandbox branches into refs/remotes/ws-<id>/*', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat-a')
    const sha = await commit(sb('w1'), 'f.txt', 'one')
    const res = await svc.sync(ws)
    expect(res.rewritten).toEqual([])
    expect(await rev(mirrorPath, `refs/remotes/ws-${ws.id}/feat-a`)).toBe(sha)
  })

  it('pushes GitHub updates to sandbox origin/* without touching heads or working tree', async () => {
    const ws = await makeWs('w1')
    const localMain = await rev(sb('w1'), 'refs/heads/main')
    const newSha = await gh.seed({ 'b.txt': 'new' })
    await svc.sync(ws)
    expect(await rev(sb('w1'), 'refs/remotes/origin/main')).toBe(newSha)
    expect(await rev(sb('w1'), 'refs/heads/main')).toBe(localMain)
    expect(fs.existsSync(sb('w1/b.txt'))).toBe(false)
    expect((await git(sb('w1'), 'status', '--porcelain')).trim()).toBe('')
  })

  it('keeps same-named branches from different sandboxes separate', async () => {
    const w1 = await makeWs('w1')
    const w2 = await makeWs('w2')
    await git(sb('w1'), 'checkout', '-b', 'feat-a')
    const s1 = await commit(sb('w1'), 'f.txt', 'from w1')
    await git(sb('w2'), 'checkout', '-b', 'feat-a')
    const s2 = await commit(sb('w2'), 'f.txt', 'from w2')
    await svc.sync(w1)
    await svc.sync(w2)
    expect(await rev(mirrorPath, `refs/remotes/ws-${w1.id}/feat-a`)).toBe(s1)
    expect(await rev(mirrorPath, `refs/remotes/ws-${w2.id}/feat-a`)).toBe(s2)
    expect(s1).not.toBe(s2)
  })

  it('reports rewritten branches (only those present before and after) and tracks them', async () => {
    const ws = await makeWs('w1')
    expect(svc.rewrittenBranches(ws.id).size).toBe(0)
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    await commit(sb('w1'), 'f.txt', 'one')
    expect((await svc.sync(ws)).rewritten).toEqual([])
    await commit(sb('w1'), 'f.txt', 'two', '--amend')
    await git(sb('w1'), 'checkout', '-b', 'brand-new')
    const res = await svc.sync(ws)
    expect(res.rewritten).toEqual(['feat/a'])
    expect([...svc.rewrittenBranches(ws.id)]).toEqual(['feat/a'])
    expect((await svc.sync(ws)).rewritten).toEqual([])
    expect(svc.rewrittenBranches(ws.id).size).toBe(0)
  })

  it('prunes branches deleted in the sandbox, without flagging them as rewritten', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat-a')
    await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    await git(sb('w1'), 'checkout', 'main')
    await git(sb('w1'), 'branch', '-D', 'feat-a')
    const res = await svc.sync(ws)
    expect(res.rewritten).toEqual([])
    const refs = await git(mirrorPath, 'for-each-ref', '--format=%(refname)', `refs/remotes/ws-${ws.id}`)
    expect(refs).not.toContain('feat-a')
  })

  it('names GitHub tags that collide with sandbox tags, after pushing branch refs', async () => {
    const ws = await makeWs('w1')
    await commit(sb('w1'), 'f.txt', 'sandbox side')
    await git(sb('w1'), 'tag', 'v1')
    const ghMain = await gh.seed({ 'b.txt': 'gh side' })
    await git(gh.url, 'tag', 'v1', ghMain)
    await expect(svc.sync(ws)).rejects.toThrow('tag ชนกับใน sandbox: v1')
    expect(await rev(sb('w1'), 'refs/remotes/origin/main')).toBe(ghMain)
    expect(await rev(sb('w1'), 'refs/tags/v1')).not.toBe(ghMain)
  })

  it('syncs two workspaces concurrently', async () => {
    const w1 = await makeWs('w1')
    const w2 = await makeWs('w2')
    await expect(Promise.all([svc.sync(w1), svc.sync(w2)])).resolves.toHaveLength(2)
  })
})
