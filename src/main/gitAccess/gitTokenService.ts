import type { Host } from '../../shared/types'
import {
  isValidTokenValue,
  normalizeScopePath,
  scopeKey,
  validateScope,
  type GitToken
} from '../../shared/gitAccess'
import type { Store } from '../store/store'
import type { SecretStore } from './secretStore'
import { adapterForHost, type ProviderAdapter } from './providers'

export type AddGitTokenInput = { host: string; path: string; label: string; token: string }

export interface CredentialSource {
  readonly tokenId: string
  resolve(): Promise<{ token: string; expiresAt: string | null }>
}

/** Reads the secret and the current expiry at resolve time, so a rotated token is picked up. */
export class StoredTokenSource implements CredentialSource {
  constructor(
    readonly tokenId: string,
    private readonly store: Store,
    private readonly secrets: SecretStore
  ) {}

  async resolve(): Promise<{ token: string; expiresAt: string | null }> {
    const t = this.store.config.gitTokens.find((x) => x.id === this.tokenId)
    if (!t) throw new Error(`Unknown token ${this.tokenId}`)
    return { token: this.secrets.get(this.tokenId), expiresAt: t.expiresAt }
  }
}

export class GitTokenService {
  private readonly store: Store
  private readonly secrets: SecretStore
  private readonly adapters: ProviderAdapter[]

  constructor(deps: { store: Store; secrets: SecretStore; adapters: ProviderAdapter[] }) {
    this.store = deps.store
    this.secrets = deps.secrets
    this.adapters = deps.adapters
  }

  /** Validates the token against the provider before anything is written. An existing scope is rotated. */
  async add(input: AddGitTokenInput): Promise<GitToken> {
    const host = input.host.trim().toLowerCase()
    const path = normalizeScopePath(input.path)
    const scopeErr = validateScope(host, path)
    if (scopeErr) throw new Error(scopeErr)
    const adapter = this.adapterFor(host)
    const pathErr = adapter.validatePath(path)
    if (pathErr) throw new Error(pathErr)
    if (!isValidTokenValue(input.token)) throw new Error('Token contains invalid characters')
    const { login, expiresAt } = await adapter.validateToken(host, path, input.token)
    const existing = this.store.config.gitTokens.find((x) => x.host === host && x.path === path)
    // a blank label on a rotation keeps the name the user gave the token
    const label = input.label.trim() || existing?.label || scopeKey({ host, path })

    if (existing) {
      // The id is already known, so the secret goes first: a failed save leaves config untouched.
      this.secrets.set(existing.id, input.token)
      return this.store.upsertGitToken({
        provider: adapter.id,
        host,
        path,
        login,
        label,
        expiresAt
      })
    }

    // A new id only exists after the upsert, so a failed save rolls the new entry back.
    const t = this.store.upsertGitToken({
      provider: adapter.id,
      host,
      path,
      login,
      label,
      expiresAt
    })
    try {
      this.secrets.set(t.id, input.token)
    } catch (err) {
      this.store.removeGitToken(t.id)
      throw err
    }
    return t
  }

  /** Re-validates with the token's own host and path, then swaps the secret and the stored login and expiry. */
  async replace(id: string, token: string): Promise<GitToken> {
    const current = this.require(id)
    const adapter = this.adapterFor(current.host)
    if (!isValidTokenValue(token)) throw new Error('Token contains invalid characters')
    const { login, expiresAt } = await adapter.validateToken(current.host, current.path, token)
    // The token may have been removed while the provider was answering.
    this.require(id)
    this.secrets.set(id, token)
    return this.store.upsertGitToken({
      provider: current.provider,
      host: current.host,
      path: current.path,
      login,
      label: current.label,
      expiresAt
    })
  }

  setLabel(id: string, label: string): GitToken {
    return this.store.setGitTokenLabel(id, label)
  }

  /** Removes the config entry first (it throws for unknown ids), then the secret. */
  remove(id: string): void {
    this.store.removeGitToken(id)
    this.secrets.delete(id)
  }

  sourceFor(id: string): CredentialSource {
    this.require(id)
    return new StoredTokenSource(id, this.store, this.secrets)
  }

  hostsUsing(id: string): Host[] {
    return this.store.config.hosts.filter(
      (h) =>
        h.gitAccess !== undefined && Object.prototype.hasOwnProperty.call(h.gitAccess.installed, id)
    )
  }

  private require(id: string): GitToken {
    const t = this.store.config.gitTokens.find((x) => x.id === id)
    if (!t) throw new Error(`Unknown token ${id}`)
    return t
  }

  private adapterFor(host: string): ProviderAdapter {
    const adapter = adapterForHost(this.adapters, host)
    if (!adapter) throw new Error(`${host} isn't supported yet`)
    return adapter
  }
}
