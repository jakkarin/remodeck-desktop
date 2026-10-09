import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitTokenService } from '../../../src/main/gitAccess/gitTokenService'
import type { ProviderAdapter } from '../../../src/main/gitAccess/providers'
import { SecretStore, type Encryptor } from '../../../src/main/gitAccess/secretStore'
import { Store } from '../../../src/main/store/store'

let dir: string
let store: Store
let secrets: SecretStore
let adapter: ProviderAdapter & { validateToken: ReturnType<typeof vi.fn> }
let svc: GitTokenService

const enc: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (blob) => Buffer.from(blob).reverse().toString('utf8')
}

const input = { host: 'github.com', path: '/Org-A/', label: ' A ', token: 'tok' }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-token-service-'))
  store = new Store(path.join(dir, 'data'))
  secrets = new SecretStore(path.join(dir, 'data'), enc)
  adapter = {
    id: 'github',
    defaultHosts: ['github.com'],
    gitUsername: 'x-access-token',
    cli: null,
    validatePath: (p) =>
      p.split('/').length <= 2 ? null : 'GitHub scope must be an owner or an owner/repo',
    validateToken: vi.fn(async () => ({ login: 'octo', expiresAt: null }))
  }
  svc = new GitTokenService({ store, secrets, adapters: [adapter] })
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('GitTokenService', () => {
  it('validates, stores the normalized scope and keeps the token secret', async () => {
    const t = await svc.add(input)
    expect(adapter.validateToken).toHaveBeenCalledWith('github.com', 'org-a', 'tok')
    expect(t).toMatchObject({ host: 'github.com', path: 'org-a', label: 'A', login: 'octo' })
    expect(store.config.gitTokens).toEqual([t])
    expect(secrets.get(t.id)).toBe('tok')
  })

  it('falls back to the scope key when the label is blank', async () => {
    const t = await svc.add({ ...input, label: '  ' })
    expect(t.label).toBe('github.com/org-a')
  })

  it('rejects hosts without a provider', async () => {
    await expect(svc.add({ ...input, host: 'gitlab.com' })).rejects.toThrow(
      "gitlab.com isn't supported yet"
    )
    expect(adapter.validateToken).not.toHaveBeenCalled()
  })

  it('rejects paths the provider refuses', async () => {
    await expect(svc.add({ ...input, path: 'a/b/c' })).rejects.toThrow()
    expect(adapter.validateToken).not.toHaveBeenCalled()
  })

  it('rejects token values with invalid characters', async () => {
    await expect(svc.add({ ...input, token: 'a b' })).rejects.toThrow(
      'Token contains invalid characters'
    )
    expect(adapter.validateToken).not.toHaveBeenCalled()
  })

  it('writes nothing when the provider rejects the token', async () => {
    adapter.validateToken.mockRejectedValueOnce(new Error('Token is invalid or expired'))
    await expect(svc.add(input)).rejects.toThrow('Token is invalid or expired')
    expect(store.config.gitTokens).toEqual([])
    expect(() => secrets.get('anything')).toThrow(/No secret/)
  })

  it('rolls back a new token when the secret cannot be saved', async () => {
    const unavailable = new SecretStore(path.join(dir, 'other'), {
      ...enc,
      isAvailable: () => false
    })
    const failing = new GitTokenService({ store, secrets: unavailable, adapters: [adapter] })
    await expect(failing.add(input)).rejects.toThrow(/encryption isn't available/i)
    expect(store.config.gitTokens).toEqual([])
  })

  it('adding to an existing scope rotates the token and keeps its id', async () => {
    const first = await svc.add(input)
    const second = await svc.add({ ...input, token: 'tok2' })
    expect(second.id).toBe(first.id)
    expect(store.config.gitTokens).toHaveLength(1)
    expect(secrets.get(first.id)).toBe('tok2')
  })

  it('replace re-validates with the token scope and swaps the secret', async () => {
    const t = await svc.add(input)
    adapter.validateToken.mockResolvedValueOnce({
      login: 'octo2',
      expiresAt: '2027-01-01T00:00:00.000Z'
    })
    const replaced = await svc.replace(t.id, 'tok2')
    expect(adapter.validateToken).toHaveBeenLastCalledWith('github.com', 'org-a', 'tok2')
    expect(replaced).toMatchObject({
      id: t.id,
      label: 'A',
      login: 'octo2',
      expiresAt: '2027-01-01T00:00:00.000Z'
    })
    expect(secrets.get(t.id)).toBe('tok2')
  })

  it('replace does not recreate a token removed during validation', async () => {
    const t = await svc.add(input)
    adapter.validateToken.mockImplementationOnce(async () => {
      svc.remove(t.id)
      return { login: 'octo', expiresAt: null }
    })
    await expect(svc.replace(t.id, 'tok2')).rejects.toThrow(`Unknown token ${t.id}`)
    expect(store.config.gitTokens).toEqual([])
    expect(() => secrets.get(t.id)).toThrow(/No secret/)
  })

  it('replace of an unknown token throws', async () => {
    await expect(svc.replace('nope', 'tok2')).rejects.toThrow('Unknown token')
  })

  it('setLabel changes only the label', async () => {
    const t = await svc.add(input)
    expect(svc.setLabel(t.id, ' Renamed ').label).toBe('Renamed')
  })

  it('remove deletes the secret and the config entry', async () => {
    const t = await svc.add(input)
    svc.remove(t.id)
    expect(store.config.gitTokens).toEqual([])
    expect(() => secrets.get(t.id)).toThrow(/No secret/)
  })

  it('remove of an unknown token throws and keeps the secret it does not own', async () => {
    const t = await svc.add(input)
    expect(() => svc.remove('nope')).toThrow('Unknown git token nope')
    expect(secrets.get(t.id)).toBe('tok')
  })

  it('hostsUsing returns the hosts whose installs include the token', async () => {
    const t = await svc.add(input)
    const a = store.addHost('dev-a', 'A')
    const b = store.addHost('dev-b', 'B')
    store.setHostGitAccess(a.id, {
      installedAt: '2026-10-09T00:00:00.000Z',
      installed: { [t.id]: t.updatedAt },
      wrapperVersion: 1
    })
    store.setHostGitAccess(b.id, {
      installedAt: '2026-10-09T00:00:00.000Z',
      installed: {},
      wrapperVersion: 1
    })
    expect(svc.hostsUsing(t.id).map((h) => h.id)).toEqual([a.id])
  })

  it('sourceFor resolves the stored secret and expiry', async () => {
    adapter.validateToken.mockResolvedValueOnce({ login: 'octo', expiresAt: null })
    const t = await svc.add(input)
    await expect(svc.sourceFor(t.id).resolve()).resolves.toEqual({ token: 'tok', expiresAt: null })
  })

  it('sourceFor throws for an unknown id', () => {
    expect(() => svc.sourceFor('nope')).toThrow('Unknown token')
  })
})
