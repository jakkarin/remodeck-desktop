import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Config, Host, PushLogEntry, Repo, Workspace } from '../../shared/types'

const newId = (): string => randomUUID().slice(0, 8)

export class Store {
  private cfg: Config

  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.cfg = this.load()
  }

  get config(): Config {
    return this.cfg
  }

  addHost(sshHost: string, label: string): Host {
    const host: Host = { id: newId(), sshHost, label }
    this.cfg.hosts.push(host)
    this.save()
    return host
  }

  removeHost(id: string): void {
    if (this.cfg.workspaces.some((w) => w.hostId === id)) {
      throw new Error(`Host ${id} still has workspaces`)
    }
    this.cfg.hosts = this.cfg.hosts.filter((h) => h.id !== id)
    this.save()
  }

  upsertRepo(owner: string, name: string): Repo {
    const existing = this.cfg.repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) return existing
    const repo: Repo = {
      id: newId(),
      owner,
      name,
      defaultBranch: 'main',
      protectedBranches: ['main', 'master'],
      alwaysAllowPush: false,
      enforceRules: true
    }
    this.cfg.repos.push(repo)
    this.save()
    return repo
  }

  updateRepo(id: string, patch: Partial<Omit<Repo, 'id' | 'owner' | 'name'>>): Repo {
    const i = this.cfg.repos.findIndex((r) => r.id === id)
    if (i < 0) throw new Error(`Unknown repo ${id}`)
    const updated: Repo = { ...this.cfg.repos[i], ...patch }
    this.cfg.repos[i] = updated
    this.save()
    return updated
  }

  addWorkspace(repoId: string, hostId: string, sandboxPath: string): Workspace {
    const ws: Workspace = { id: newId(), repoId, hostId, sandboxPath }
    this.cfg.workspaces.push(ws)
    this.save()
    return ws
  }

  removeWorkspace(id: string): void {
    if (!this.cfg.workspaces.some((w) => w.id === id)) throw new Error(`Unknown workspace ${id}`)
    this.cfg.workspaces = this.cfg.workspaces.filter((w) => w.id !== id)
    this.save()
  }

  mirrorPath(repo: Repo): string {
    return path.join(this.dir, 'mirrors', repo.owner.toLowerCase(), `${repo.name.toLowerCase()}.git`)
  }

  appendPushLog(e: PushLogEntry): void {
    fs.appendFileSync(this.logPath, JSON.stringify(e) + '\n')
  }

  readPushLog(limit: number): PushLogEntry[] {
    let text: string
    try {
      text = fs.readFileSync(this.logPath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const entries: PushLogEntry[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        entries.push(JSON.parse(line) as PushLogEntry)
      } catch {
        // Torn write (crash mid-append) or garbage: skip the line, keep the rest readable.
      }
    }
    return entries.slice(-limit).reverse()
  }

  private get configPath(): string {
    return path.join(this.dir, 'config.json')
  }

  private get logPath(): string {
    return path.join(this.dir, 'push-log.jsonl')
  }

  private load(): Config {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<Config>
      return { hosts: raw.hosts ?? [], repos: raw.repos ?? [], workspaces: raw.workspaces ?? [] }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { hosts: [], repos: [], workspaces: [] }
      throw err
    }
  }

  private save(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.configPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.cfg, null, 2))
    fs.renameSync(tmp, this.configPath)
  }
}
