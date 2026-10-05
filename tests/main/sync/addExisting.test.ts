import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { SyncService } from '../../../src/main/sync/syncService'
import { git, makeFakeGitHub, makeTmp } from '../../helpers/repos'

const ident = ['-c', 'user.name=t', '-c', 'user.email=t@e']

describe('SyncService.addExisting', () => {
  let tmp: string
  let home: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let store: Store
  let svc: SyncService
  let host: HostGit
  let hostId: string

  beforeEach(() => {
    tmp = makeTmp()
    home = path.join(tmp, 'home')
    fs.mkdirSync(home, { recursive: true })
    gh = makeFakeGitHub(tmp)
    store = new Store(path.join(tmp, 'data'))
    host = new HostGit()
    hostId = store.addHost('box', 'Box').id
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

  const sb = (rel: string): string => path.join(home, rel)

  /** A normal clone in the "VM" whose origin URL is the given GitHub URL (the mirror uses the local fake GitHub). */
  async function vmRepo(
    rel: string,
    originUrl = 'https://github.com/acme/api.git'
  ): Promise<string> {
    const dir = sb(rel)
    await git(tmp, 'clone', '-q', gh.url, dir)
    await git(dir, 'remote', 'set-url', 'origin', originUrl)
    return dir
  }

  const snapshot = async (dir: string): Promise<Record<string, string>> => ({
    head: fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8'),
    sha: (await git(dir, 'rev-parse', 'HEAD')).trim(),
    status: await git(dir, 'status', '--porcelain'),
    config: fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'),
    heads: await git(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads')
  })

  it('adopts a repo with an https origin', async () => {
    const sha = await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('work/api')
    const ws = await svc.addExisting(hostId, '~/work/api')
    expect(ws).toMatchObject({ hostId, sandboxPath: '~/work/api' })
    expect(store.config.workspaces).toHaveLength(1)
    const repo = store.config.repos.find((r) => r.id === ws.repoId)
    expect(repo).toMatchObject({ owner: 'acme', name: 'api', defaultBranch: 'main' })
    const mirror = store.mirrorPath(repo!)
    expect((await git(mirror, 'rev-parse', `refs/remotes/ws-${ws.id}/main`)).trim()).toBe(sha)
    expect((await git(mirror, 'rev-parse', 'refs/remotes/origin/main')).trim()).toBe(sha)
  })

  it('adopts a repo with a git@github.com: origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api', 'git@github.com:acme/api.git')
    const ws = await svc.addExisting(hostId, '~/api')
    const repo = store.config.repos.find((r) => r.id === ws.repoId)
    expect(repo).toMatchObject({ owner: 'acme', name: 'api' })
  })

  it('adopts a repo with an ssh://git@github.com/ origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api', 'ssh://git@github.com/acme/api.git')
    const ws = await svc.addExisting(hostId, '~/api')
    expect(store.config.repos.find((r) => r.id === ws.repoId)).toMatchObject({
      owner: 'acme',
      name: 'api'
    })
  })

  it('accepts a trailing slash and a path with spaces', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('my work/api')
    const ws = await svc.addExisting(hostId, '~/my work/api/')
    expect(ws.sandboxPath).toBe('~/my work/api')
  })

  it('rejects a missing path', async () => {
    await expect(svc.addExisting(hostId, '~/nope')).rejects.toThrow('ไม่พบ path ใน sandbox: ~/nope')
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects a path that is a file', async () => {
    fs.writeFileSync(sb('file'), 'x')
    await expect(svc.addExisting(hostId, '~/file')).rejects.toThrow('ไม่พบ path ใน sandbox')
  })

  it('rejects a directory that is not a git repo', async () => {
    fs.mkdirSync(sb('plain'))
    await expect(svc.addExisting(hostId, '~/plain')).rejects.toThrow('ไม่ใช่ git repo: ~/plain')
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects a bare repo', async () => {
    fs.mkdirSync(sb('bare.git'))
    await git(sb('bare.git'), 'init', '--bare')
    await expect(svc.addExisting(hostId, '~/bare.git')).rejects.toThrow('เป็น bare repo')
  })

  it('rejects a subdirectory of a repo', async () => {
    await gh.seed({ 'sub/a.txt': 'hi' })
    await vmRepo('api')
    await expect(svc.addExisting(hostId, '~/api/sub')).rejects.toThrow('ไม่ใช่ root ของ repo')
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects the .git directory itself', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api')
    await expect(svc.addExisting(hostId, '~/api/.git')).rejects.toThrow('ไม่ใช่ root ของ repo')
  })

  it('accepts a path reached through a symlink', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('real')
    try {
      fs.symlinkSync(sb('real'), sb('link'), 'dir')
    } catch {
      return // symlinks unavailable (Windows without privilege)
    }
    const ws = await svc.addExisting(hostId, '~/link')
    expect(ws.sandboxPath).toBe('~/link')
  })

  it('rejects a repo without an origin remote', async () => {
    fs.mkdirSync(sb('noorigin'))
    await git(sb('noorigin'), 'init')
    await expect(svc.addExisting(hostId, '~/noorigin')).rejects.toThrow('ไม่มี remote origin')
  })

  it('rejects a non-GitHub origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('gl', 'https://gitlab.com/a/b.git')
    await expect(svc.addExisting(hostId, '~/gl')).rejects.toThrow(
      'origin ไม่ได้ชี้ไป GitHub: https://gitlab.com/a/b.git'
    )
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects a relative path before touching anything', async () => {
    await expect(svc.addExisting(hostId, 'api')).rejects.toThrow('path ต้องขึ้นต้นด้วย / หรือ ~/')
  })

  it('rejects a duplicate hostId + sandboxPath', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api')
    await svc.addExisting(hostId, '~/api')
    await expect(svc.addExisting(hostId, '~/api')).rejects.toThrow('มี workspace นี้อยู่แล้ว')
    expect(store.config.workspaces).toHaveLength(1)
  })

  it('rolls back the workspace and the mirror remote on failure, leaving the VM alone', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    const before = await snapshot(dir)
    const realRun = host.run.bind(host)
    const spy = vi.spyOn(host, 'run').mockImplementation(async (cwd, args, opts) => {
      if (args[0] === 'push') throw new Error('mirror push boom')
      return realRun(cwd, args, opts)
    })
    await expect(svc.addExisting(hostId, '~/api')).rejects.toThrow('mirror push boom')
    spy.mockRestore()
    expect(store.config.workspaces).toHaveLength(0)
    const repo = store.config.repos[0]
    const remotes = (await git(store.mirrorPath(repo), 'remote')).split('\n').map((s) => s.trim())
    expect(remotes.filter((r) => r.startsWith('ws-'))).toEqual([])
    expect(fs.existsSync(dir)).toBe(true)
    expect(await snapshot(dir)).toEqual(before)
  })

  it('keeps the workspace when only a tag conflicts, and surfaces it on the next Sync', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    await git(dir, ...ident, 'commit', '--allow-empty', '-m', 'vm only')
    await git(dir, 'tag', 'v1') // same tag name, different commit than GitHub's
    const g = path.join(tmp, 'g-scratch')
    await git(tmp, 'clone', '-q', gh.url, g)
    await git(g, ...ident, 'commit', '--allow-empty', '-m', 'gh only')
    await git(g, 'tag', 'v1')
    await git(g, 'push', 'origin', 'v1')
    const ws = await svc.addExisting(hostId, '~/api')
    expect(store.config.workspaces.map((w) => w.id)).toEqual([ws.id])
    await expect(svc.sync(ws)).rejects.toThrow('tag ชนกับใน sandbox: v1')
  })

  it('shows a branch that exists only in the VM under refs/remotes/ws-<id>/', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    await git(dir, 'checkout', '-q', '-b', 'feat-vm')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
    await git(dir, 'add', '-A')
    await git(dir, ...ident, 'commit', '-m', 'vm work')
    const vmSha = (await git(dir, 'rev-parse', 'HEAD')).trim()
    const ws = await svc.addExisting(hostId, '~/api')
    const mirror = store.mirrorPath(store.config.repos[0])
    expect((await git(mirror, 'rev-parse', `refs/remotes/ws-${ws.id}/feat-vm`)).trim()).toBe(vmSha)
  })

  it('leaves HEAD, working tree and .git/config byte-identical', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    await git(dir, 'checkout', '-q', '-b', 'feat-vm')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty')
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'u')
    const before = await snapshot(dir)
    const dirty = fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')
    const ws = await svc.addExisting(hostId, '~/api')
    await svc.sync(ws)
    expect(await snapshot(dir)).toEqual(before)
    expect(before.status).toContain('a.txt')
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe(dirty)
    expect(fs.existsSync(path.join(dir, 'untracked.txt'))).toBe(true)
  })
})
