import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { SyncService } from '../../../src/main/sync/syncService'
import { git, makeFakeGitHub, makeTmp } from '../../helpers/repos'

describe('SyncService.cloneToSandbox', () => {
  let tmp: string
  let home: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let store: Store
  let svc: SyncService
  let host: HostGit

  beforeEach(() => {
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
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const setup = (sandboxPath: string) => {
    const repo = store.upsertRepo('acme', 'api')
    const h = store.addHost('box', 'Box')
    return { repo, ws: store.addWorkspace(repo.id, h.id, sandboxPath) }
  }
  const sb = (rel: string) => path.join(home, rel)

  it('clones into a path with spaces on the default branch', async () => {
    const sha = await gh.seed({ 'a.txt': 'hi' })
    const { ws } = setup('~/repos/my api')
    await svc.cloneToSandbox(ws)
    const dir = sb('repos/my api')
    expect((await git(dir, 'branch', '--show-current')).trim()).toBe('main')
    expect((await git(dir, 'remote', 'get-url', 'origin')).trim()).toBe('https://github.com/acme/api.git')
    expect((await git(dir, 'rev-parse', 'refs/remotes/origin/main')).trim()).toBe(sha)
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hi')
  })

  it('reports progress that only rises and ends at 100', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const { ws } = setup('~/repos/api')
    const seen: number[] = []
    await svc.cloneToSandbox(ws, (p) => seen.push(p.percent))
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(100)
    expect(seen).toEqual([...seen].sort((x, y) => x - y))
  })

  it('rejects a non-empty target and leaves the mirror untouched', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const { ws, repo } = setup('~/busy')
    fs.mkdirSync(sb('busy'))
    fs.writeFileSync(sb('busy/x'), 'x')
    await expect(svc.cloneToSandbox(ws)).rejects.toThrow('Path is not empty: ~/busy')
    expect(fs.existsSync(store.mirrorPath(repo))).toBe(false)
  })

  it('clones an empty GitHub repo without commits', async () => {
    fs.mkdirSync(gh.url, { recursive: true })
    await git(gh.url, 'init', '--bare', '-b', 'main')
    const { ws, repo } = setup('~/empty')
    await svc.cloneToSandbox(ws)
    const dir = sb('empty')
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true)
    await expect(git(dir, 'rev-parse', '--verify', 'HEAD')).rejects.toThrow()
    expect(store.config.repos.find((r) => r.id === repo.id)?.defaultBranch).toBe('main')
  })

  it('leaves zero footprint beyond init, origin remote, remote refs and default branch', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const { ws } = setup('~/zero')
    await svc.cloneToSandbox(ws)
    const dir = sb('zero')
    expect((await git(dir, 'status', '--porcelain')).trim()).toBe('')
    const keys = (await git(dir, 'config', '--list', '--local'))
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('=')[0])
    for (const k of keys) expect(k).toMatch(/^(core\.|remote\.origin\.|branch\.main\.)/)
    const refs = (await git(dir, 'for-each-ref', '--format=%(refname)')).trim().split('\n')
    for (const r of refs) expect(r).toMatch(/^refs\/(heads\/main|remotes\/origin\/|tags\/)/)
  })

  it('rejects a relative sandbox path before touching anything', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    for (const bad of ['repos/api', './api', '~user/api', '~', '~/']) {
      const { ws, repo } = setup(bad)
      await expect(svc.cloneToSandbox(ws)).rejects.toThrow('Path must start with / or ~/')
      expect(fs.existsSync(store.mirrorPath(repo))).toBe(false)
    }
  })

  it('a retry after a failure following git init succeeds', async () => {
    const sha = await gh.seed({ 'a.txt': 'hi' })
    const { ws } = setup('~/retry')
    const realRun = host.run.bind(host)
    const spy = vi.spyOn(host, 'run').mockImplementation(async (cwd, args, opts) => {
      if (args[0] === 'push') throw new Error('mirror push boom')
      return realRun(cwd, args, opts)
    })
    await expect(svc.cloneToSandbox(ws)).rejects.toThrow('mirror push boom')
    expect(fs.existsSync(sb('retry/.git'))).toBe(true)
    spy.mockRestore()
    await svc.cloneToSandbox(ws)
    const dir = sb('retry')
    expect((await git(dir, 'branch', '--show-current')).trim()).toBe('main')
    expect((await git(dir, 'rev-parse', 'HEAD')).trim()).toBe(sha)
    expect((await git(dir, 'remote', 'get-url', 'origin')).trim()).toBe('https://github.com/acme/api.git')
  })

  it('still rejects a target repo that has commits or an origin remote', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const { ws: w1 } = setup('~/withorigin')
    fs.mkdirSync(sb('withorigin'))
    await git(sb('withorigin'), 'init')
    await git(sb('withorigin'), 'remote', 'add', 'origin', 'https://example.invalid/x.git')
    await expect(svc.cloneToSandbox(w1)).rejects.toThrow('Path is not empty: ~/withorigin')
    const { ws: w2 } = setup('~/withcommit')
    fs.mkdirSync(sb('withcommit'))
    await git(sb('withcommit'), 'init')
    await git(sb('withcommit'), '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '--allow-empty', '-m', 'x')
    await expect(svc.cloneToSandbox(w2)).rejects.toThrow('Path is not empty: ~/withcommit')
  })
})
