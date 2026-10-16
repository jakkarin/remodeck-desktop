import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import type { Repo, Workspace } from '../../../src/shared/types'
import {
  getDiff,
  listBaseBranches,
  resolveBaseRef,
  listBranches,
  listCommits,
  listFiles,
  listWorktrees,
  requireCommitInRange
} from '../../../src/main/sync/queries'
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
    svc = new SyncService({
      git: host,
      mirror: new MirrorService(host, () => gh.url),
      store,
      targetFor: () => target
    })
    await gh.seed({ 'a.txt': 'hi' })
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const sb = (rel: string): string => path.join(home, rel)
  const makeWs = async (rel: string): Promise<{ ws: Workspace; repo: Repo }> => {
    const repo = store.upsertRepo('acme', 'api')
    const h = store.config.hosts[0] ?? store.addHost('box', 'Box')
    const ws = store.addWorkspace(repo.id, h.id, `~/${rel}`)
    await svc.cloneToSandbox(ws)
    mirrorPath = store.mirrorPath(repo)
    return { ws, repo }
  }
  const commit = async (dir: string, file: string, msg: string): Promise<void> => {
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
    expect(a).toMatchObject({
      name: 'feat/a',
      base: 'origin/main',
      ahead: 2,
      behind: 0,
      merged: false,
      rewritten: false
    })
    expect(a.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(list.find((b) => b.name === 'HEAD')).toBeUndefined()

    // GitHub merges it (fast-forward main to the branch tip).
    await git(mirrorPath, 'push', 'origin', `refs/remotes/ws-${ws.id}/feat/a:refs/heads/main`)
    await svc.sync(ws)
    const after = await listBranches(
      host,
      mirrorPath,
      ws.id,
      repo.defaultBranch,
      new Set(['feat/a'])
    )
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

  it('offers all origin branches and compares against the chosen base', async () => {
    const { ws } = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'dev-v9')
    await commit(sb('w1'), 'v9.txt', 'v9')
    await svc.sync(ws)
    await svc.pushToGitHub(ws, 'dev-v9', 'dev-v9')
    await git(sb('w1'), 'checkout', '-b', 'dev-v10')
    await commit(sb('w1'), 'v10.txt', 'v10')
    await svc.sync(ws)
    await svc.pushToGitHub(ws, 'dev-v10', 'dev-v10')
    await svc.sync(ws)
    await git(mirrorPath, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    const bases = await listBaseBranches(host, mirrorPath)
    expect(bases.map((b) => b.name)).toEqual(['dev-v10', 'dev-v9', 'main'])
    expect(bases.every((b) => /^[0-9a-f]{40}$/.test(b.sha))).toBe(true)
    const ref = `refs/remotes/ws-${ws.id}/dev-v10`
    const base = await resolveBaseRef(host, mirrorPath, 'dev-v9')
    expect((await listCommits(host, mirrorPath, base, ref)).map((c) => c.subject)).toEqual(['v10'])
    expect((await listFiles(host, mirrorPath, base, ref)).map((f) => f.path)).toEqual(['v10.txt'])
    const diff = await getDiff(host, mirrorPath, base, ref)
    expect(diff).toContain('+v10')
    expect(diff).not.toContain('v9.txt')
    expect(
      await listCommits(host, mirrorPath, await resolveBaseRef(host, mirrorPath, 'dev-v10'), ref)
    ).toEqual([])
    const v9 = bases.find((b) => b.name === 'dev-v9')!.sha
    await expect(requireCommitInRange(host, mirrorPath, base, ref, v9)).rejects.toThrow(
      'Commit is not on this branch'
    )
    for (const invalid of [
      'missing',
      'HEAD',
      '--output=x',
      'main..dev-v10',
      'refs/remotes/origin/main'
    ]) {
      await expect(resolveBaseRef(host, mirrorPath, invalid)).rejects.toThrow(
        'Comparison branch not found'
      )
    }
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
    // Git reports long paths; the temp dir may be an 8.3 short path (e.g. RUNNER~1).
    const real = (p: string): string => fs.realpathSync.native(p).replaceAll('\\', '/')
    expect(real(list[1].path)).toBe(real(wt))
  })

  it('uses origin/<name> as base when GitHub has the branch', async () => {
    const { ws, repo } = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    await commit(sb('w1'), 'f.txt', 'first')
    await svc.sync(ws)
    await svc.pushToGitHub(ws, 'feat/a', 'feat/a')
    await commit(sb('w1'), 'g.txt', 'second')
    await svc.sync(ws)
    const list = await listBranches(host, mirrorPath, ws.id, repo.defaultBranch, new Set())
    expect(list.find((b) => b.name === 'feat/a')).toMatchObject({
      base: 'origin/feat/a',
      ahead: 1,
      behind: 0
    })
  })

  describe('per-file queries', () => {
    const setup = async (): Promise<{
      ws: Workspace
      older: string
      newer: string
      ref: string
      base: string
    }> => {
      const { ws } = await makeWs('w1')
      const dir = sb('w1')
      await git(dir, 'checkout', '-b', 'feat/a')
      fs.mkdirSync(path.join(dir, 'dir'))
      fs.writeFileSync(path.join(dir, 'dir', 'with space.txt'), 'one\n')
      await git(dir, 'add', '-A')
      await git(dir, ...ident, 'commit', '-m', 'older')
      const older = (await git(dir, 'rev-parse', 'HEAD')).trim()
      fs.writeFileSync(path.join(dir, 'dir', 'with space.txt'), 'one\ntwo\n')
      fs.writeFileSync(path.join(dir, 'g.txt'), 'g\n')
      await git(dir, 'add', '-A')
      await git(dir, ...ident, 'commit', '-m', 'newer')
      const newer = (await git(dir, 'rev-parse', 'HEAD')).trim()
      await svc.sync(ws)
      return {
        ws,
        older,
        newer,
        ref: `refs/remotes/ws-${ws.id}/feat/a`,
        base: 'refs/remotes/origin/main'
      }
    }

    it('listFiles over the branch and for a single commit', async () => {
      const { ref, base, older } = await setup()
      const all = await listFiles(host, mirrorPath, base, ref)
      expect(all.map((f) => f.path).sort()).toEqual(['dir/with space.txt', 'g.txt'])
      expect(all.find((f) => f.path === 'dir/with space.txt')).toMatchObject({
        status: 'A',
        additions: 2,
        deletions: 0
      })
      const one = await listFiles(host, mirrorPath, base, ref, older)
      expect(one).toEqual([{ path: 'dir/with space.txt', status: 'A', additions: 1, deletions: 0 }])
    })

    it('listFiles works for a root commit', async () => {
      const { ref, base } = await setup()
      const root = (await git(mirrorPath, 'rev-list', '--max-parents=0', base)).trim()
      const files = await listFiles(host, mirrorPath, base, ref, root)
      expect(files).toEqual([{ path: 'a.txt', status: 'A', additions: 1, deletions: 0 }])
    })

    it('getDiff without opts is the plain range diff; file and commit narrow it', async () => {
      const { ref, base, older, newer } = await setup()
      const plain = await getDiff(host, mirrorPath, base, ref)
      expect(plain).toBe(await git(mirrorPath, 'diff', `${base}...${ref}`))
      const one = await getDiff(host, mirrorPath, base, ref, { file: 'dir/with space.txt' })
      expect(one).toContain('with space.txt')
      expect(one).not.toContain('g.txt')
      const both = await getDiff(host, mirrorPath, base, ref, {
        commit: newer,
        file: 'dir/with space.txt'
      })
      expect(both).toContain('+two')
      expect(both).not.toContain('+one')
      const first = await getDiff(host, mirrorPath, base, ref, { commit: older })
      expect(first).toContain('+one')
    })

    it('requireCommitInRange accepts branch commits only', async () => {
      const { ref, base, older } = await setup()
      await expect(
        requireCommitInRange(host, mirrorPath, base, ref, older)
      ).resolves.toBeUndefined()
      const onMain = (await git(mirrorPath, 'rev-parse', base)).trim()
      await expect(requireCommitInRange(host, mirrorPath, base, ref, onMain)).rejects.toThrow(
        'Commit is not on this branch'
      )
      await expect(requireCommitInRange(host, mirrorPath, base, ref, 'HEAD')).rejects.toThrow(
        'Commit is not on this branch'
      )
      await expect(requireCommitInRange(host, mirrorPath, base, ref, '--output=x')).rejects.toThrow(
        'Commit is not on this branch'
      )
    })
  })

  it('reports a renamed file with oldPath and shows the rename in the per-file diff', async () => {
    await gh.seed({ 'a.txt': Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n' })
    const { ws } = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/r')
    await git(sb('w1'), 'mv', 'a.txt', 'renamed.txt')
    fs.appendFileSync(path.join(sb('w1'), 'renamed.txt'), 'extra\n')
    await git(sb('w1'), 'add', '-A')
    await git(sb('w1'), ...ident, 'commit', '-m', 'rename')
    await svc.sync(ws)
    const ref = `refs/remotes/ws-${ws.id}/feat/r`
    const files = await listFiles(host, mirrorPath, 'origin/main', ref)
    expect(files.find((f) => f.path === 'renamed.txt')).toMatchObject({
      status: 'R',
      oldPath: 'a.txt'
    })
    const text = await getDiff(host, mirrorPath, 'origin/main', ref, { file: 'renamed.txt' })
    expect(text).toContain('rename from a.txt')
    expect(text).toContain('rename to renamed.txt')
    expect(text).toContain('+extra')
  })
})
