import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HostGit } from '../../../src/main/git/hostGit'
import { MirrorService } from '../../../src/main/mirror/mirrorService'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { SyncService } from '../../../src/main/sync/syncService'
import { git, makeFakeGitHub, makeTmp } from '../../helpers/repos'

const ACME = { owner: 'acme', name: 'api' }
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
    const ws = await svc.addExisting(hostId, '~/work/api', ACME)
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
    const ws = await svc.addExisting(hostId, '~/api', ACME)
    const repo = store.config.repos.find((r) => r.id === ws.repoId)
    expect(repo).toMatchObject({ owner: 'acme', name: 'api' })
  })

  it('adopts a repo with an ssh://git@github.com/ origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api', 'ssh://git@github.com/acme/api.git')
    const ws = await svc.addExisting(hostId, '~/api', ACME)
    expect(store.config.repos.find((r) => r.id === ws.repoId)).toMatchObject({
      owner: 'acme',
      name: 'api'
    })
  })

  it('accepts a trailing slash and a path with spaces', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('my work/api')
    const ws = await svc.addExisting(hostId, '~/my work/api/', ACME)
    expect(ws.sandboxPath).toBe('~/my work/api')
  })

  it('rejects a missing path', async () => {
    await expect(svc.addExisting(hostId, '~/nope', ACME)).rejects.toThrow(
      'Path not found in sandbox: ~/nope'
    )
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects a path that is a file', async () => {
    fs.writeFileSync(sb('file'), 'x')
    await expect(svc.addExisting(hostId, '~/file', ACME)).rejects.toThrow(
      'Path not found in sandbox'
    )
  })

  it('rejects a directory that is not a git repo', async () => {
    fs.mkdirSync(sb('plain'))
    await expect(svc.addExisting(hostId, '~/plain', ACME)).rejects.toThrow(
      'Not a git repo: ~/plain'
    )
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects a bare repo', async () => {
    fs.mkdirSync(sb('bare.git'))
    await git(sb('bare.git'), 'init', '--bare')
    await expect(svc.addExisting(hostId, '~/bare.git', ACME)).rejects.toThrow('Bare repo')
  })

  it('rejects a subdirectory of a repo', async () => {
    await gh.seed({ 'sub/a.txt': 'hi' })
    await vmRepo('api')
    await expect(svc.addExisting(hostId, '~/api/sub', ACME)).rejects.toThrow(
      'Path is not the repo root'
    )
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('rejects the .git directory itself', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api')
    await expect(svc.addExisting(hostId, '~/api/.git', ACME)).rejects.toThrow(
      'Path is not the repo root'
    )
  })

  it('accepts a path reached through a symlink', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('real')
    try {
      fs.symlinkSync(sb('real'), sb('link'), 'dir')
    } catch {
      return // symlinks unavailable (Windows without privilege)
    }
    const ws = await svc.addExisting(hostId, '~/link', ACME)
    expect(ws.sandboxPath).toBe('~/link')
  })

  it('rejects a repo without an origin remote', async () => {
    fs.mkdirSync(sb('noorigin'))
    await git(sb('noorigin'), 'init')
    await expect(svc.addExisting(hostId, '~/noorigin', ACME)).rejects.toThrow(
      'Repo has no remote origin'
    )
  })

  it('rejects a non-GitHub origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('gl', 'https://gitlab.com/a/b.git')
    await expect(svc.addExisting(hostId, '~/gl', ACME)).rejects.toThrow(
      'Origin does not point to GitHub: https://gitlab.com/a/b.git'
    )
    expect(store.config.workspaces).toHaveLength(0)
  })

  it('never echoes credentials embedded in a rejected origin', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('cred', 'https://bob:s3cret@gitlab.com/a/b.git')
    const err = await svc.addExisting(hostId, '~/cred', ACME).catch((e: Error) => e)
    expect((err as Error).message).toBe(
      'Origin does not point to GitHub: https://***@gitlab.com/a/b.git'
    )
  })

  it('rejects a relative path before touching anything', async () => {
    await expect(svc.addExisting(hostId, 'api', ACME)).rejects.toThrow(
      'Path must start with / or ~/'
    )
  })

  it('rejects a duplicate hostId + sandboxPath', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    await vmRepo('api')
    await svc.addExisting(hostId, '~/api', ACME)
    await expect(svc.addExisting(hostId, '~/api', ACME)).rejects.toThrow(
      'This workspace already exists'
    )
    expect(store.config.workspaces).toHaveLength(1)
  })

  it('adds a local repo by its Windows drive path, stored normalised', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    const typed = dir.replaceAll('/', '\\') + '\\'
    const ws = await svc.addExisting('local', typed, ACME)
    const expected = dir.replaceAll('\\', '/')
    expect(ws.sandboxPath).toBe(expected[0].toUpperCase() + expected.slice(1))
  })

  it('adds a local repo typed in a different case than on disk', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = (await vmRepo('api')).replaceAll('\\', '/')
    const mixed = dir.replace(/\/home\/api$/, '/HOME/API')
    expect(mixed).not.toBe(dir)
    const ws = await svc.addExisting('local', mixed, ACME)
    expect(ws.hostId).toBe('local')
  })

  it('rejects a local duplicate stored as ~ and typed as an absolute path', async () => {
    const local = new SyncService({
      git: host,
      mirror: new MirrorService(host, () => gh.url),
      store,
      targetFor: () => new LocalTarget(home),
      homeDir: 'C:\\Users\\x'
    })
    const repo = store.upsertRepo('acme', 'api')
    store.addWorkspace(repo.id, 'local', '~/repos/app')
    await expect(local.describeExisting('local', 'C:\\Users\\x\\repos\\app')).rejects.toThrow(
      'This workspace already exists: ~/repos/app'
    )
  })

  it('rejects a local duplicate typed differently', async () => {
    const repo = store.upsertRepo('acme', 'api')
    store.addWorkspace(repo.id, 'local', 'D:/develop/app')
    await expect(svc.describeExisting('local', 'd:\\develop\\app\\')).rejects.toThrow(
      'This workspace already exists: D:/develop/app'
    )
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
    await expect(svc.addExisting(hostId, '~/api', ACME)).rejects.toThrow('mirror push boom')
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
    const ws = await svc.addExisting(hostId, '~/api', ACME)
    expect(store.config.workspaces.map((w) => w.id)).toEqual([ws.id])
    await expect(svc.sync(ws)).rejects.toThrow('Tags conflict with the sandbox: v1')
  })

  it('shows a branch that exists only in the VM under refs/remotes/ws-<id>/', async () => {
    await gh.seed({ 'a.txt': 'hi' })
    const dir = await vmRepo('api')
    await git(dir, 'checkout', '-q', '-b', 'feat-vm')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
    await git(dir, 'add', '-A')
    await git(dir, ...ident, 'commit', '-m', 'vm work')
    const vmSha = (await git(dir, 'rev-parse', 'HEAD')).trim()
    const ws = await svc.addExisting(hostId, '~/api', ACME)
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
    const ws = await svc.addExisting(hostId, '~/api', ACME)
    await svc.sync(ws)
    expect(await snapshot(dir)).toEqual(before)
    expect(before.status).toContain('a.txt')
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe(dirty)
    expect(fs.existsSync(path.join(dir, 'untracked.txt'))).toBe(true)
  })
  describe('describeExisting', () => {
    it('resolves owner/name for a new repo without writing anything', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      const before = JSON.stringify(store.config)
      await expect(svc.describeExisting(hostId, '~/api/')).resolves.toEqual({
        owner: 'acme',
        name: 'api',
        known: false,
        alwaysAllowPush: false
      })
      expect(JSON.stringify(store.config)).toBe(before)
      expect(store.config.repos).toHaveLength(0)
      expect(store.config.workspaces).toHaveLength(0)
      expect(fs.existsSync(path.join(tmp, 'data', 'mirrors'))).toBe(false)
    })

    it('reports a known repo (case-insensitive) with its alwaysAllowPush flag', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      const repo = store.upsertRepo('ACME', 'API')
      store.updateRepo(repo.id, { alwaysAllowPush: true })
      const before = JSON.stringify(store.config)
      await expect(svc.describeExisting(hostId, '~/api')).resolves.toEqual({
        owner: 'acme',
        name: 'api',
        known: true,
        alwaysAllowPush: true
      })
      expect(JSON.stringify(store.config)).toBe(before)
    })

    it('known repo without Always allow push reports false', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      store.upsertRepo('acme', 'api')
      expect(await svc.describeExisting(hostId, '~/api')).toMatchObject({
        known: true,
        alwaysAllowPush: false
      })
    })

    it('validates the path and rejects duplicates like addExisting', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      await expect(svc.describeExisting(hostId, 'api')).rejects.toThrow(
        'Path must start with / or ~/'
      )
      await svc.addExisting(hostId, '~/api', ACME)
      await expect(svc.describeExisting(hostId, '~/api/')).rejects.toThrow(
        'This workspace already exists'
      )
    })
  })

  describe('expected repo confirmation', () => {
    it('refuses when the origin changed after the user confirmed, writing nothing and fetching nothing', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      const dir = await vmRepo('api')
      await git(dir, 'remote', 'set-url', 'origin', 'https://github.com/victim/private.git')
      const spy = vi.spyOn(host, 'run')
      await expect(svc.addExisting(hostId, '~/api', ACME)).rejects.toThrow(
        'The repo origin changed since confirmation (now points to victim/private) — please check again'
      )
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
      expect(store.config.repos).toHaveLength(0)
      expect(store.config.workspaces).toHaveLength(0)
      expect(fs.existsSync(path.join(tmp, 'data', 'mirrors'))).toBe(false)
    })

    it('matches expected case-insensitively', async () => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      const ws = await svc.addExisting(hostId, '~/api', { owner: 'ACME', name: 'Api' })
      expect(ws.sandboxPath).toBe('~/api')
    })

    it.each([
      ['traversal owner', { owner: '../x', name: 'api' }],
      ['empty owner', { owner: '', name: 'api' }],
      ['empty name', { owner: 'acme', name: '' }],
      ['slash in name', { owner: 'acme', name: 'a/b' }]
    ])('rejects an invalid expected (%s)', async (_label, expected) => {
      await gh.seed({ 'a.txt': 'hi' })
      await vmRepo('api')
      await expect(svc.addExisting(hostId, '~/api', expected)).rejects.toThrow()
      expect(store.config.repos).toHaveLength(0)
      expect(store.config.workspaces).toHaveLength(0)
    })
  })
})
