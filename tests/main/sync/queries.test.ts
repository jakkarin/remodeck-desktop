import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { getDiff, listBranches, listCommits, listWorktrees } from '../../../src/main/sync/queries'
import { SyncService } from '../../../src/main/sync/syncService'
import { git, makeFakeGitHub, makeTmp } from '../../helpers/repos'

const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

describe('workspace queries', () => {
  let tmp: string
  let home: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let store: Store
  let svc: SyncService
  let host: HostGit
  let mirrorPath: string
  let target: LocalTarget

  beforeEach(async () => {
    tmp = makeTmp()
    home = path.join(tmp, 'home')
    fs.mkdirSync(home, { recursive: true })
    gh = makeFakeGitHub(tmp)
    store = new Store(path.join(tmp, 'data'))
    host = new HostGit()
    target = new LocalTarget(home)
    svc = new SyncService({ git: host, mirror: new MirrorService(host, () => gh.url), store, targetFor: () => target })
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
    return { ws, repo }
  }
  const commit = async (dir: string, file: string, msg: string) => {
    fs.writeFileSync(path.join(dir, file), msg)
    await git(dir, 'add', '-A')
    await git(dir, ...ident, 'commit', '-m', msg)
  }

  it('lists branches with ahead/behind/merged against origin', async () => {
    const { ws, repo } = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    await commit(sb('w1'), 'f.txt', 'first')
    await commit(sb('w1'), 'g.txt', 'second')
    await svc.sync(ws)
    const list = await listBranches(host, mirrorPath, ws.id, repo.defaultBranch, new Set())
    const a = list.find((b) => b.name === 'feat/a')!
    expect(a).toMatchObject({ name: 'feat/a', base: 'origin/main', ahead: 2, behind: 0, merged: false, rewritten: false })
    expect(a.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(list.find((b) => b.name === 'HEAD')).toBeUndefined()

    // GitHub merges it (fast-forward main to the branch tip).
    await git(mirrorPath, 'push', 'origin', `refs/remotes/ws-${ws.id}/feat/a:refs/heads/main`)
    await svc.sync(ws)
    const after = await listBranches(host, mirrorPath, ws.id, repo.defaultBranch, new Set(['feat/a']))
    expect(after.find((b) => b.name === 'feat/a')).toMatchObject({ merged: true, rewritten: true })
  })

  it('lists commits newest first and the diff', async () => {
    const { ws } = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    await commit(sb('w1'), 'f.txt', 'first')
    await commit(sb('w1'), 'g.txt', 'second')
    await svc.sync(ws)
    const ref = `refs/remotes/ws-${ws.id}/feat/a`
    const commits = await listCommits(host, mirrorPath, 'origin/main', ref)
    expect(commits.map((c) => c.subject)).toEqual(['second', 'first'])
    expect(commits[0]).toMatchObject({ author: 'test' })
    expect(commits[0].sha).toMatch(/^[0-9a-f]{40}$/)
    const diff = await getDiff(host, mirrorPath, 'origin/main', ref)
    expect(diff).toContain('f.txt')
    expect(diff).toContain('g.txt')
  })

  it('lists worktrees with dirty counts', async () => {
    await makeWs('w1')
    const wt = path.join(tmp, 'extra wt')
    await git(sb('w1'), 'worktree', 'add', '-b', 'other', wt)
    fs.writeFileSync(path.join(wt, 'untracked.txt'), 'x')
    const list = await listWorktrees(target, '~/w1')
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ branch: 'main', dirty: 0 })
    expect(list[1]).toMatchObject({ branch: 'other', dirty: 1 })
    expect(list[1].path.replaceAll('\\', '/')).toBe(wt.replaceAll('\\', '/'))
  })
})
