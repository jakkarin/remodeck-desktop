import fs from 'node:fs'
import type { Repo } from '../../shared/types'
import type { HostGit } from '../git/hostGit'
import { withLock } from '../git/lock'

const ORIGIN_REFSPECS = ['+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*']

/** One bare mirror per GitHub repo; each sandbox workspace is a remote `ws-<id>` in it. */
export class MirrorService {
  constructor(
    private readonly git: HostGit,
    private readonly originUrl: (repo: Repo) => string
  ) {}

  ensure(repo: Repo, mirrorPath: string): Promise<void> {
    return withLock(mirrorPath, () => this.ensureLocked(repo, mirrorPath))
  }

  addWorkspace(mirrorPath: string, wsId: string, url: string): Promise<void> {
    return withLock(mirrorPath, () => this.addWorkspaceLocked(mirrorPath, wsId, url))
  }

  removeWorkspace(mirrorPath: string, wsId: string): Promise<void> {
    return withLock(mirrorPath, async () => {
      const name = `ws-${wsId}`
      const remotes = (await this.git.run(mirrorPath, ['remote'])).stdout.split('\n').map((s) => s.trim())
      if (remotes.includes(name)) await this.git.run(mirrorPath, ['remote', 'remove', name])
    })
  }

  rebuild(repo: Repo, mirrorPath: string, workspaces: { id: string; url: string }[]): Promise<void> {
    return withLock(mirrorPath, async () => {
      fs.rmSync(mirrorPath, { recursive: true, force: true })
      await this.ensureLocked(repo, mirrorPath)
      for (const ws of workspaces) await this.addWorkspaceLocked(mirrorPath, ws.id, ws.url)
    })
  }

  private async ensureLocked(repo: Repo, mirrorPath: string): Promise<void> {
    if (!fs.existsSync(mirrorPath)) {
      fs.mkdirSync(mirrorPath, { recursive: true })
      await this.git.run(mirrorPath, ['init', '--bare'])
    }
    await this.setRemote(mirrorPath, 'origin', this.originUrl(repo), ORIGIN_REFSPECS)
  }

  private async addWorkspaceLocked(mirrorPath: string, wsId: string, url: string): Promise<void> {
    const name = `ws-${wsId}`
    await this.setRemote(mirrorPath, name, url, [`+refs/heads/*:refs/remotes/${name}/*`])
    // Sandbox (AI-created) tags must never enter the mirror: they could be pushed on to GitHub.
    await this.git.run(mirrorPath, ['config', `remote.${name}.tagOpt`, '--no-tags'])
  }

  private async setRemote(mirrorPath: string, name: string, url: string, refspecs: string[]): Promise<void> {
    const remotes = (await this.git.run(mirrorPath, ['remote'])).stdout.split('\n').map((s) => s.trim())
    if (remotes.includes(name)) await this.git.run(mirrorPath, ['remote', 'set-url', name, url])
    else await this.git.run(mirrorPath, ['remote', 'add', name, url])
    const key = `remote.${name}.fetch`
    await this.git.run(mirrorPath, ['config', '--replace-all', key, refspecs[0]])
    for (const spec of refspecs.slice(1)) await this.git.run(mirrorPath, ['config', '--add', key, spec])
  }
}
