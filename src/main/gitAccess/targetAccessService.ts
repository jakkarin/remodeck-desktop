import type { GitAccessStatus, InstallOptions } from '../../shared/gitAccess'
import { isLocalHost } from '../../shared/types'
import type { ProcResult } from '../proc/run'
import type { SandboxTarget } from '../sandbox/target'
import type { Store } from '../store/store'
import type { GitTokenService } from './gitTokenService'
import { adapterForHost, type CliSpec, type ProviderAdapter } from './providers'
import { redact } from './redact'
import { buildInstallScript, buildRemoveScript, buildStatusScript, WRAPPER_VERSION } from './scripts'
import { computeStatus, parseStatusOutput } from './statusParse'

const STATUS_TIMEOUT_MS = 30_000
const CHANGE_TIMEOUT_MS = 60_000
const MAX_STDERR_CHARS = 500

export class TargetAccessService {
  private readonly store: Store
  private readonly tokens: GitTokenService
  private readonly adapters: ProviderAdapter[]
  private readonly targetFor: (hostId: string) => SandboxTarget

  constructor(deps: {
    store: Store
    tokens: GitTokenService
    adapters: ProviderAdapter[]
    targetFor(hostId: string): SandboxTarget
  }) {
    this.store = deps.store
    this.tokens = deps.tokens
    this.adapters = deps.adapters
    this.targetFor = deps.targetFor
  }

  status(hostId: string): Promise<GitAccessStatus> {
    return this.guarded([], () => this.readStatus(hostId, []))
  }

  install(hostId: string, tokenIds: string[], opts: InstallOptions = {}): Promise<GitAccessStatus> {
    // filled while tokens resolve and read at throw time, so every error is masked with what is known by then
    const secrets: string[] = []
    return this.guarded(secrets, async () => {
      const ids = [...new Set(tokenIds)]
      if (ids.length === 0) throw new Error('Choose at least one token')

      const entries: { id: string; host: string; path: string; token: string; updatedAt: string }[] = []
      for (const id of ids) {
        const { token } = await this.tokens.sourceFor(id).resolve()
        secrets.push(token)
        const meta = this.store.config.gitTokens.find((t) => t.id === id)
        if (!meta) throw new Error(`Unknown token ${id}`)
        entries.push({ id, host: meta.host, path: meta.path, token, updatedAt: meta.updatedAt })
      }

      const providers: { host: string; gitUsername: string }[] = []
      const wrappers: { cli: CliSpec; defaultHost: string }[] = []
      for (const host of new Set(entries.map((e) => e.host))) {
        const adapter = adapterForHost(this.adapters, host)
        if (!adapter) throw new Error(`${host} isn't supported yet`)
        providers.push({ host, gitUsername: adapter.gitUsername })
        if (adapter.cli && !wrappers.some((w) => w.cli.command === adapter.cli?.command)) {
          wrappers.push({ cli: adapter.cli, defaultHost: adapter.defaultHosts[0] })
        }
      }

      // a choice made once stays until the user unticks it, so a later update keeps the order
      const helperFirst =
        opts.helperFirst ?? this.store.config.hosts.find((h) => h.id === hostId)?.gitAccess?.helperFirst === true
      const script = buildInstallScript({
        tokens: entries.map(({ host, path, token }) => ({ host, path, token })),
        providers,
        wrappers,
        pathBlock: opts.pathBlock === true,
        helperFirst
      })
      const r = await this.run(hostId, script, CHANGE_TIMEOUT_MS, 'Install', secrets)
      const wrapperInstalled = /^wrapper=[^:\r\n]+:installed\r?$/m.test(r.stdout)
      this.store.setHostGitAccess(hostId, {
        installedAt: new Date().toISOString(),
        installed: Object.fromEntries(entries.map((e) => [e.id, e.updatedAt])),
        wrapperVersion: wrapperInstalled ? WRAPPER_VERSION : null,
        ...(helperFirst ? { helperFirst: true } : {})
      })
      return this.readStatus(hostId, secrets)
    })
  }

  async remove(hostId: string): Promise<void> {
    await this.guarded([], async () => {
      await this.run(hostId, buildRemoveScript(this.clis()), CHANGE_TIMEOUT_MS, 'Remove', [])
      this.store.setHostGitAccess(hostId, null)
    })
  }

  private clis(): CliSpec[] {
    return this.adapters.flatMap((a) => (a.cli ? [a.cli] : []))
  }

  private async readStatus(hostId: string, secrets: string[]): Promise<GitAccessStatus> {
    const hosts = [...new Set(this.adapters.flatMap((a) => [...a.defaultHosts]))]
    const script = buildStatusScript(this.clis(), hosts)
    const r = await this.run(hostId, script, STATUS_TIMEOUT_MS, 'Status check', secrets)
    const host = this.store.config.hosts.find((h) => h.id === hostId)
    return computeStatus(
      parseStatusOutput(r.stdout),
      host?.gitAccess,
      this.store.config.gitTokens,
      WRAPPER_VERSION
    )
  }

  /** A failure reports stderr only: stdout of the install script is never part of an error. */
  private async run(
    hostId: string,
    script: string,
    timeoutMs: number,
    label: string,
    secrets: string[]
  ): Promise<ProcResult> {
    // The scripts write ~/.gitconfig, ~/.bashrc and plain-text tokens: never on the user's own computer.
    const host = this.store.config.hosts.find((h) => h.id === hostId)
    if (host && isLocalHost(host)) throw new Error('Git access is not used on This computer')
    const r = await this.targetFor(hostId).exec(script, { timeoutMs })
    if (r.code !== 0) {
      const detail = redact(r.stderr, secrets).trim().slice(0, MAX_STDERR_CHARS)
      throw new Error(`${label} failed (exit ${r.code})${detail ? `: ${detail}` : ''}`)
    }
    return r
  }

  private async guarded<T>(secrets: string[], fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw new Error(redact(e instanceof Error ? e.message : String(e), secrets))
    }
  }
}
