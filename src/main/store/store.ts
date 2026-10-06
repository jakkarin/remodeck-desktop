import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PREFS,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  THEMES,
  type Config,
  type Host,
  type Prefs,
  type PushLogEntry,
  type Repo,
  type Workspace
} from '../../shared/types'
import { INVALID_SSH_HOST, isValidSshHost } from '../../shared/validate'

const newId = (): string => randomUUID().slice(0, 8)

const isFontSize = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= TERMINAL_FONT_MIN && v <= TERMINAL_FONT_MAX

/** Non-empty trimmed strings, deduped; null when the value is not an array of non-empty strings. */
function cleanBranches(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const b of v) {
    if (typeof b !== 'string' || b.trim() === '') return null
    const t = b.trim()
    if (!out.includes(t)) out.push(t)
  }
  return out
}

/** Field-by-field merge over defaults; any invalid stored value falls back to its default. */
function loadPrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: THEMES.includes(r.theme as Prefs['theme'])
      ? (r.theme as Prefs['theme'])
      : DEFAULT_PREFS.theme,
    terminalFontSize: isFontSize(r.terminalFontSize)
      ? r.terminalFontSize
      : DEFAULT_PREFS.terminalFontSize,
    defaultProtectedBranches: cleanBranches(r.defaultProtectedBranches) ?? [
      ...DEFAULT_PREFS.defaultProtectedBranches
    ]
  }
}

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
    if (!isValidSshHost(sshHost)) throw new Error(INVALID_SSH_HOST)
    const host: Host = { id: newId(), sshHost, label, protected: false }
    this.cfg.hosts.push(host)
    this.save()
    return host
  }

  updateHost(id: string, patch: { label?: string; protected?: boolean }): Host {
    const i = this.cfg.hosts.findIndex((h) => h.id === id)
    if (i < 0) throw new Error(`Unknown host ${id}`)
    const next: Host = { ...this.cfg.hosts[i] }
    if (patch.label !== undefined) {
      const label = typeof patch.label === 'string' ? patch.label.trim() : ''
      if (label === '') throw new Error('Host label must not be empty')
      next.label = label
    }
    if (patch.protected !== undefined) {
      if (typeof patch.protected !== 'boolean') throw new Error('Host protected must be a boolean')
      next.protected = patch.protected
    }
    this.cfg.hosts[i] = next
    this.save()
    return next
  }

  updatePrefs(patch: Partial<Prefs>): Prefs {
    const next: Prefs = { ...this.cfg.prefs }
    if (patch.theme !== undefined) {
      if (!THEMES.includes(patch.theme)) throw new Error(`Invalid theme ${String(patch.theme)}`)
      next.theme = patch.theme
    }
    if (patch.terminalFontSize !== undefined) {
      if (!isFontSize(patch.terminalFontSize))
        throw new Error(
          `Terminal font size must be an integer from ${TERMINAL_FONT_MIN} to ${TERMINAL_FONT_MAX}`
        )
      next.terminalFontSize = patch.terminalFontSize
    }
    if (patch.defaultProtectedBranches !== undefined) {
      const branches = cleanBranches(patch.defaultProtectedBranches)
      if (!branches) throw new Error('Default protected branches must be non-empty strings')
      next.defaultProtectedBranches = branches
    }
    this.cfg.prefs = next
    this.save()
    return next
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
      (r) =>
        r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) return existing
    const repo: Repo = {
      id: newId(),
      owner,
      name,
      defaultBranch: 'main',
      protectedBranches: [...this.cfg.prefs.defaultProtectedBranches],
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
    return path.join(
      this.dir,
      'mirrors',
      repo.owner.toLowerCase(),
      `${repo.name.toLowerCase()}.git`
    )
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
      return {
        hosts: (raw.hosts ?? []).map((h) => ({ ...h, protected: h.protected === true })),
        repos: raw.repos ?? [],
        workspaces: raw.workspaces ?? [],
        prefs: loadPrefs(raw.prefs)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return { hosts: [], repos: [], workspaces: [], prefs: loadPrefs(undefined) }
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
