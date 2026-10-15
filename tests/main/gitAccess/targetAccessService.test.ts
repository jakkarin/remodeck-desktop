import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProcResult } from '../../../src/main/proc/run'
import type { HostGitAccess } from '../../../src/shared/gitAccess'
import { GitTokenService } from '../../../src/main/gitAccess/gitTokenService'
import { createGithubAdapter } from '../../../src/main/gitAccess/providers'
import { redact } from '../../../src/main/gitAccess/redact'
import { PATH_BLOCK_BEGIN, WRAPPER_VERSION } from '../../../src/main/gitAccess/scripts'
import { SecretStore, type Encryptor } from '../../../src/main/gitAccess/secretStore'
import { TargetAccessService } from '../../../src/main/gitAccess/targetAccessService'
import { LocalTarget, type SandboxTarget } from '../../../src/main/sandbox/target'
import { Store } from '../../../src/main/store/store'
import { GIT_PREFIX } from './testHelpers'

const enc: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (blob) => Buffer.from(blob).reverse().toString('utf8')
}

class FakeTarget implements SandboxTarget {
  scripts: string[] = []
  opts: ({ timeoutMs?: number } | undefined)[] = []
  handler: (script: string) => ProcResult | Promise<ProcResult> = () => ({ code: 0, stdout: '', stderr: '' })
  async exec(script: string, opts?: { timeoutMs?: number }): Promise<ProcResult> {
    this.scripts.push(script)
    this.opts.push(opts)
    return this.handler(script)
  }
  gitUrl(p: string): string {
    return p
  }
}

/** R1: the service builds the script, so the test target prefixes the git-isolation exports. */
class IsolatedLocalTarget extends LocalTarget {
  override exec(script: string, opts?: { timeoutMs?: number }): Promise<ProcResult> {
    return super.exec(GIT_PREFIX + script, opts)
  }
}

let dir: string
let store: Store
let secrets: SecretStore
let tokens: GitTokenService
let hostId: string
let idA: string
let idP: string

const adapters = [createGithubAdapter()]
const ok = (stdout = ''): ProcResult => ({ code: 0, stdout, stderr: '' })

function addToken(p: string, secret: string): string {
  const t = store.upsertGitToken({
    provider: 'github',
    host: 'github.com',
    path: p,
    login: 'octo',
    label: p,
    expiresAt: null
  })
  secrets.set(t.id, secret)
  return t.id
}

function service(target: SandboxTarget): TargetAccessService {
  return new TargetAccessService({ store, tokens, adapters, targetFor: () => target })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-target-access-'))
  store = new Store(path.join(dir, 'data'))
  secrets = new SecretStore(path.join(dir, 'data'), enc)
  tokens = new GitTokenService({ store, secrets, adapters })
  hostId = store.addHost('box', 'Box').id
  idA = addToken('org-a', 'tok-secret-A')
  idP = addToken('org-p/repo', 'tok-secret-P')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('redact', () => {
  it('masks every occurrence of every secret', () => {
    expect(redact('a tok b tok c key', ['tok', 'key'])).toBe('a *** b *** c ***')
  })

  it('masks the longest secret first so a containing secret leaves no tail', () => {
    expect(redact('x abcdef y', ['abc', 'abcdef'])).toBe('x *** y')
  })

  it('ignores empty secrets and leaves text without secrets alone', () => {
    expect(redact('plain text', ['', 'zzz'])).toBe('plain text')
  })
})

describe('TargetAccessService on This computer', () => {
  it('refuses status, install and remove without running anything', async () => {
    const target = new FakeTarget()
    const svc = service(target)
    const msg = 'Git access is not used on This computer'
    await expect(svc.status('local')).rejects.toThrow(msg)
    await expect(svc.install('local', [idA])).rejects.toThrow(msg)
    await expect(svc.remove('local')).rejects.toThrow(msg)
    expect(target.scripts).toHaveLength(0)
    expect(store.config.hosts[0].gitAccess).toBeUndefined()
  })
})

describe('TargetAccessService with a recording target', () => {
  it('installs both tokens, records them and reports status', async () => {
    const target = new FakeTarget()
    target.handler = (s) => (s.includes('umask 077') ? ok('wrapper=gh:installed\n') : ok('helper=1\ninclude=1\n'))
    const status = await service(target).install(hostId, [idA, idP])

    expect(target.scripts).toHaveLength(2)
    expect(target.scripts[0]).toContain('tok-secret-A')
    expect(target.scripts[0]).toContain('tok-secret-P')
    expect(target.scripts[1]).not.toContain('tok-secret')
    expect(target.opts).toEqual([{ timeoutMs: 60_000 }, { timeoutMs: 30_000 }])

    const tokenA = store.config.gitTokens.find((t) => t.id === idA)!
    const tokenP = store.config.gitTokens.find((t) => t.id === idP)!
    const access = store.config.hosts.find((h) => h.id === hostId)!.gitAccess!
    expect(access.installed).toEqual({ [idA]: tokenA.updatedAt, [idP]: tokenP.updatedAt })
    expect(access.wrapperVersion).toBe(WRAPPER_VERSION)
    expect(status.helperInstalled).toBe(true)
  })

  it('adds the ~/.bashrc PATH block only when asked', async () => {
    const target = new FakeTarget()
    target.handler = (s) => (s.includes('umask 077') ? ok('wrapper=gh:installed\n') : ok())
    await service(target).install(hostId, [idA])
    await service(target).install(hostId, [idA], { pathBlock: true })
    expect(target.scripts[0]).not.toContain(PATH_BLOCK_BEGIN)
    expect(target.scripts[2]).toContain(PATH_BLOCK_BEGIN)
  })

  it('remembers helperFirst for later updates until it is turned off', async () => {
    const target = new FakeTarget()
    target.handler = (s) => (s.includes('umask 077') ? ok('wrapper=gh:installed\n') : ok())
    const reset = 'helper =\\n\\thelper = %s'
    const svc = service(target)
    const access = (): HostGitAccess | undefined => store.config.hosts.find((h) => h.id === hostId)!.gitAccess

    await svc.install(hostId, [idA])
    expect(target.scripts[0]).not.toContain(reset)
    expect(access()?.helperFirst).toBeUndefined()

    await svc.install(hostId, [idA], { helperFirst: true })
    expect(target.scripts[2]).toContain(reset)
    expect(access()?.helperFirst).toBe(true)

    await svc.install(hostId, [idA])
    expect(target.scripts[4]).toContain(reset)

    await svc.install(hostId, [idA], { helperFirst: false })
    expect(target.scripts[6]).not.toContain(reset)
    expect(access()?.helperFirst).toBeUndefined()
  })

  it('records wrapperVersion null when the wrapper was skipped', async () => {
    const target = new FakeTarget()
    target.handler = (s) => (s.includes('umask 077') ? ok('wrapper=gh:skipped\n') : ok())
    await service(target).install(hostId, [idA])
    expect(store.config.hosts[1].gitAccess!.wrapperVersion).toBeNull()
  })

  it('redacts the token from a failing script error and keeps stdout out of it', async () => {
    const target = new FakeTarget()
    target.handler = () => ({ code: 1, stdout: 'STDOUT-LINE', stderr: 'bad: tok-secret-A and tok-secret-P\n' })
    const err = await service(target).install(hostId, [idA, idP]).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain('***')
    expect(msg).not.toContain('tok-secret')
    expect(msg).not.toContain('STDOUT-LINE')
    expect(store.config.hosts[1].gitAccess).toBeUndefined()
  })

  it('truncates long stderr', async () => {
    const target = new FakeTarget()
    target.handler = () => ({ code: 2, stdout: '', stderr: 'x'.repeat(5000) })
    const err = (await service(target).status(hostId).catch((e: Error) => e)) as Error
    expect(err.message.length).toBeLessThan(600)
  })

  it('redacts a timeout rejection', async () => {
    const target = new FakeTarget()
    target.handler = () => {
      throw new Error('ssh timed out with tok-secret-A')
    }
    await expect(service(target).install(hostId, [idA])).rejects.toThrow('ssh timed out with ***')
  })

  it('rejects an unknown token id before running anything', async () => {
    const target = new FakeTarget()
    await expect(service(target).install(hostId, [idA, 'nope'])).rejects.toThrow('Unknown token')
    expect(target.scripts).toEqual([])
  })

  it('rejects an empty selection', async () => {
    const target = new FakeTarget()
    await expect(service(target).install(hostId, [])).rejects.toThrow('Choose at least one token')
    expect(target.scripts).toEqual([])
  })

  it('removes and clears the recorded access', async () => {
    const target = new FakeTarget()
    store.setHostGitAccess(hostId, { installedAt: 'x', installed: { [idA]: 'u' }, wrapperVersion: 1 })
    await service(target).remove(hostId)
    expect(target.scripts).toHaveLength(1)
    expect(target.scripts[0]).toContain('include.path')
    expect(target.opts[0]).toEqual({ timeoutMs: 60_000 })
    expect(store.config.hosts[1].gitAccess).toBeUndefined()
  })

  it('keeps the recorded access when remove fails', async () => {
    const target = new FakeTarget()
    store.setHostGitAccess(hostId, { installedAt: 'x', installed: {}, wrapperVersion: 1 })
    target.handler = () => ({ code: 1, stdout: '', stderr: 'nope' })
    await expect(service(target).remove(hostId)).rejects.toThrow('nope')
    expect(store.config.hosts[1].gitAccess).toBeDefined()
  })

  it('status only runs the status script', async () => {
    const target = new FakeTarget()
    target.handler = () => ok('helper=1\nscope=github.com/org-a\n')
    store.setHostGitAccess(hostId, {
      installedAt: 'x',
      installed: { [idA]: store.config.gitTokens.find((t) => t.id === idA)!.updatedAt },
      wrapperVersion: 1
    })
    const status = await service(target).status(hostId)
    expect(target.scripts).toHaveLength(1)
    expect(target.scripts[0]).not.toContain('umask 077')
    expect(target.opts[0]).toEqual({ timeoutMs: 30_000 })
    expect(status.scopesOnTarget).toEqual(['github.com/org-a'])
    expect(status.stale).toEqual([])
    expect(status.missing).toEqual([])
  })
})

describe('TargetAccessService with a LocalTarget', () => {
  it('installs, reports a clean status, then flags a replaced token as stale', async () => {
    const home = path.join(dir, 'home')
    fs.mkdirSync(home)
    const svc = service(new IsolatedLocalTarget(home))

    const status = await svc.install(hostId, [idA, idP])
    expect(status.helperInstalled).toBe(true)
    expect(status.stale).toEqual([])
    expect(status.missing).toEqual([])
    expect(fs.readFileSync(path.join(home, '.config/remodeck/git-access/tokens/github.com/org-a/@token'), 'utf8')).toBe(
      'tok-secret-A'
    )

    await new Promise((r) => setTimeout(r, 5))
    store.upsertGitToken({
      provider: 'github',
      host: 'github.com',
      path: 'org-a',
      login: 'octo',
      label: 'org-a',
      expiresAt: null
    })
    const after = await svc.status(hostId)
    expect(after.stale).toEqual([idA])
    expect(after.missing).toEqual([])
  }, 30_000)
})
