import crypto from 'node:crypto'
import type { ApprovalDecision, ApprovalRequest } from '../../shared/types'
import type { Store } from '../store/store'

type Deps = {
  store: Store
  prompt: (req: ApprovalRequest) => Promise<ApprovalDecision>
  notify: (message: string) => void
  timeoutMs?: number
}

export class ApprovalService {
  private readonly sessionGrants = new Set<string>()
  private readonly timeoutMs: number

  constructor(private readonly deps: Deps) {
    this.timeoutMs = deps.timeoutMs ?? 60_000
  }

  async request(req: Omit<ApprovalRequest, 'id'>): Promise<boolean> {
    const repo = this.deps.store.config.repos.find((r) => r.id === req.repoId)
    if (!repo) return false

    if (repo.alwaysAllowPush) {
      const refs = req.updates.map((u) => u.ref.replace(/^refs\/heads\//, '')).join(', ')
      this.deps.notify(`Push ${refs} → ${req.repoLabel}`)
      return true
    }
    if (this.sessionGrants.has(req.sessionId)) return true

    const decision = await this.ask({ ...req, id: crypto.randomUUID() })
    switch (decision) {
      case 'always':
        this.deps.store.updateRepo(req.repoId, { alwaysAllowPush: true })
        return true
      case 'session':
        this.sessionGrants.add(req.sessionId)
        return true
      case 'once':
        return true
      default:
        return false
    }
  }

  revokeSession(sessionId: string): void {
    this.sessionGrants.delete(sessionId)
  }

  private async ask(req: ApprovalRequest): Promise<ApprovalDecision> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ApprovalDecision>((resolve) => {
      timer = setTimeout(() => resolve('deny'), this.timeoutMs)
    })
    try {
      return await Promise.race([this.deps.prompt(req), timeout])
    } catch {
      return 'deny'
    } finally {
      clearTimeout(timer)
    }
  }
}
