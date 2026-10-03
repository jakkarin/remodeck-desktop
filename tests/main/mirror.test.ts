import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostGit } from '../../src/main/git/hostGit'
import { MirrorService } from '../../src/main/mirror/mirrorService'
import type { Repo } from '../../src/shared/types'
import { git, makeFakeGitHub, makeTmp } from '../helpers/repos'

const repo: Repo = {
  id: 'r1',
  owner: 'o',
  name: 'n',
  defaultBranch: 'main',
  protectedBranches: ['main'],
  alwaysAllowPush: false,
  enforceRules: true
}

describe('MirrorService', () => {
  let tmp: string
  let mirror: string
  let gh: ReturnType<typeof makeFakeGitHub>
  let svc: MirrorService
  beforeEach(() => {
    tmp = makeTmp()
    mirror = path.join(tmp, 'mirror.git')
    gh = makeFakeGitHub(tmp)
    svc = new MirrorService(new HostGit(), () => gh.url)
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const refspecs = ['+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']

  it('ensure is idempotent and sets exactly the two fetch refspecs', async () => {
    await svc.ensure(repo, mirror)
    await svc.ensure(repo, mirror)
    const out = await git(mirror, 'config', '--get-all', 'remote.origin.fetch')
    expect(out.trim().split('\n')).toEqual(refspecs)
    expect((await git(mirror, 'config', 'remote.origin.url')).trim()).toBe(gh.url)
  })

  it('ensure updates a changed origin url', async () => {
    await svc.ensure(repo, mirror)
    const other = new MirrorService(new HostGit(), () => path.join(tmp, 'other.git'))
    await other.ensure(repo, mirror)
    expect((await git(mirror, 'config', 'remote.origin.url')).trim()).toBe(path.join(tmp, 'other.git'))
  })

  it('addWorkspace twice yields a single remote with the ws refspec', async () => {
    await svc.ensure(repo, mirror)
    await svc.addWorkspace(mirror, 'w1', '/sandbox/w1')
    await svc.addWorkspace(mirror, 'w1', '/sandbox/w1')
    const remotes = (await git(mirror, 'remote')).trim().split('\n')
    expect(remotes.filter((r) => r === 'ws-w1')).toHaveLength(1)
    const out = await git(mirror, 'config', '--get-all', 'remote.ws-w1.fetch')
    expect(out.trim()).toBe('+refs/heads/*:refs/remotes/ws-w1/*')
    expect((await git(mirror, 'config', '--get-all', 'remote.ws-w1.tagOpt')).trim()).toBe('--no-tags')
  })

  it('removeWorkspace drops the remote and its refs', async () => {
    const sha = await gh.seed({ a: '1' })
    await svc.ensure(repo, mirror)
    await svc.addWorkspace(mirror, 'w1', gh.url)
    await git(mirror, 'fetch', 'ws-w1')
    expect(await git(mirror, 'for-each-ref', 'refs/remotes/ws-w1/')).toContain(sha)
    await svc.removeWorkspace(mirror, 'w1')
    expect(await git(mirror, 'remote')).not.toContain('ws-w1')
    expect((await git(mirror, 'for-each-ref', 'refs/remotes/ws-w1/')).trim()).toBe('')
  })

  it('rebuild recovers a mirror with a corrupted HEAD', async () => {
    await gh.seed({ a: '1' })
    await svc.ensure(repo, mirror)
    await svc.addWorkspace(mirror, 'w1', gh.url)
    fs.writeFileSync(path.join(mirror, 'HEAD'), 'garbage')
    await svc.rebuild(repo, mirror, [{ id: 'w1', url: gh.url }])
    const remotes = (await git(mirror, 'remote')).trim().split('\n').sort()
    expect(remotes).toEqual(['origin', 'ws-w1'])
    expect((await git(mirror, 'config', '--get-all', 'remote.origin.fetch')).trim().split('\n')).toEqual(refspecs)
  })

  it('ensure re-inits when the dir exists but HEAD is missing', async () => {
    fs.mkdirSync(mirror, { recursive: true })
    fs.writeFileSync(path.join(mirror, 'leftover'), 'x')
    await svc.ensure(repo, mirror)
    expect(fs.existsSync(path.join(mirror, 'HEAD'))).toBe(true)
    expect((await git(mirror, 'rev-parse', '--is-bare-repository')).trim()).toBe('true')
    expect((await git(mirror, 'config', '--get-all', 'remote.origin.fetch')).trim().split('\n')).toEqual(refspecs)
  })
})
