import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  let host: HostGit

  beforeEach(async () => {
    tmp = makeTmp()
    home = path.join(tmp, 'home')
    fs.mkdirSync(home, { recursive: true })
    gh = makeFakeGitHub(tmp)
    store = new Store(path.join(tmp, 'data'))
    host = new HostGit()
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
  const ghSha = async (branch: string) =>
    (await git(gh.url, 'rev-parse', `refs/heads/${branch}`)).trim()

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
    expect(res).toEqual({
      ok: false,
      reason: 'protected',
      message: 'branch main is protected — change this in Settings'
    })
    expect(await ghSha('main')).toBe(before)
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      result: 'blocked',
      detail: 'branch main is protected — change this in Settings'
    })
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
      message: 'GitHub has newer commits — press Sync, then have the AI rebase onto origin/feat-x'
    })
    expect(await ghSha('feat-x')).toBe(ghTip)
    expect(store.readPushLog(10).map((e) => e.result)).toEqual(['rejected', 'ok'])
  })

  it('logs ok even if the post-push fetch fails', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    const sha = await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    const realRun = host.run.bind(host)
    vi.spyOn(host, 'run').mockImplementation(async (cwd, args, opts) => {
      if (args[0] === 'fetch') throw new Error('network down')
      return realRun(cwd, args, opts)
    })
    expect(await svc.pushToGitHub(ws, 'feat/a', 'feat/a')).toEqual({ ok: true })
    expect(await ghSha('feat/a')).toBe(sha)
    expect(store.readPushLog(10).map((e) => e.result)).toEqual(['ok'])
  })

  it('allows pushing to a protected name when enforceRules is off', async () => {
    const ws = await makeWs('w1')
    store.updateRepo(ws.repoId, { enforceRules: false })
    await git(sb('w1'), 'checkout', '-b', 'feat/a')
    const sha = await commit(sb('w1'), 'f.txt', 'one')
    await svc.sync(ws)
    expect(await svc.pushToGitHub(ws, 'feat/a', 'main')).toEqual({ ok: true })
    expect(await ghSha('main')).toBe(sha)
  })

  it('never leaks sandbox tags into the mirror or GitHub (even with push.followTags)', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat-a')
    await commit(sb('w1'), 'f.txt', 'one')
    await git(sb('w1'), ...ident, 'tag', '-a', 'ai-tag', '-m', 'annotated by AI')
    const mirrorPath = store.mirrorPath(store.config.repos[0])
    await git(mirrorPath, 'config', 'push.followTags', 'true')
    await svc.sync(ws)
    expect((await git(mirrorPath, 'config', `remote.ws-${ws.id}.tagOpt`)).trim()).toBe('--no-tags')
    expect(await git(mirrorPath, 'tag', '--list')).not.toContain('ai-tag')
    expect(await svc.pushToGitHub(ws, 'feat-a', 'feat-a')).toEqual({ ok: true })
    expect(await git(gh.url, 'tag', '--list')).not.toContain('ai-tag')
    expect(await git(mirrorPath, 'for-each-ref', 'refs/tags')).not.toContain('ai-tag')
  })

  it('never leaks sandbox tags when the mirror already holds the tagged object', async () => {
    const ws = await makeWs('w1')
    await git(sb('w1'), 'checkout', '-b', 'feat-a')
    await commit(sb('w1'), 'f.txt', 'one')
    const mirrorPath = store.mirrorPath(store.config.repos[0])
    await git(mirrorPath, 'config', 'push.followTags', 'true')
    await svc.sync(ws)
    // tag created after the branch tip is already in the mirror: plain auto-follow would grab it now
    await git(sb('w1'), ...ident, 'tag', '-a', 'ai-tag2', '-m', 'annotated by AI')
    await svc.sync(ws)
    expect(await git(mirrorPath, 'tag', '--list')).not.toContain('ai-tag2')
    expect(await svc.pushToGitHub(ws, 'feat-a', 'feat-a')).toEqual({ ok: true })
    expect(await git(gh.url, 'tag', '--list')).not.toContain('ai-tag2')
  })

  it('reports error when the source branch does not exist', async () => {
    const ws = await makeWs('w1')
    const res = await svc.pushToGitHub(ws, 'nope', 'nope')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('error')
      expect(res.message).not.toBe('')
    }
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0].result).toBe('error')
  })
})
