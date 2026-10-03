import type { Workspace } from '../../shared/types'
import type { HostGit } from '../git/hostGit'
import { withLock } from '../git/lock'
import { parseSymrefHead } from '../git/parsers'
import type { MirrorService } from '../mirror/mirrorService'
import type { SandboxTarget } from '../sandbox/target'
import { shPath, shQuote } from '../sandbox/shell'
import type { Store } from '../store/store'

const NOT_EMPTY_CODE = 3

export class SyncService {
  private readonly git: HostGit
  private readonly mirror: MirrorService
  private readonly store: Store
  private readonly targetFor: (hostId: string) => SandboxTarget

  constructor(deps: {
    git: HostGit
    mirror: MirrorService
    store: Store
    targetFor: (hostId: string) => SandboxTarget
  }) {
    this.git = deps.git
    this.mirror = deps.mirror
    this.store = deps.store
    this.targetFor = deps.targetFor
  }

  private remoteName(wsId: string): string {
    return 'ws-' + wsId
  }

  /** GitHub -> host mirror -> freshly `git init`ed sandbox repo. Only touches origin remote refs, tags and the default branch. */
  async cloneToSandbox(ws: Workspace): Promise<void> {
    const target = this.targetFor(ws.hostId)
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const p = shPath(ws.sandboxPath)

    const check = await target.exec(
      `p=${p}\nif [ -e "$p" ]; then\n  [ -d "$p" ] || exit ${NOT_EMPTY_CODE}\n  [ -z "$(ls -A "$p")" ] || exit ${NOT_EMPTY_CODE}\nfi\n`
    )
    if (check.code === NOT_EMPTY_CODE) throw new Error(`Path ไม่ว่าง: ${ws.sandboxPath}`)
    if (check.code !== 0) throw new Error(check.stderr)

    const mirrorPath = this.store.mirrorPath(repo)
    // mirror.ensure/addWorkspace take the mirror lock themselves (not reentrant), so lock per section.
    await this.mirror.ensure(repo, mirrorPath)
    let defaultBranch = repo.defaultBranch
    await withLock(mirrorPath, async () => {
      await this.git.run(mirrorPath, ['fetch', '--prune', 'origin'])
      const head = await this.git.run(mirrorPath, ['ls-remote', '--symref', 'origin', 'HEAD'])
      const detected = parseSymrefHead(head.stdout)
      if (detected) {
        defaultBranch = detected
        this.store.updateRepo(repo.id, { defaultBranch: detected })
      }
    })

    await this.sandboxRun(target, `set -e\np=${p}\nmkdir -p "$p"\ngit init "$p"\n`)

    const name = this.remoteName(ws.id)
    await this.mirror.addWorkspace(mirrorPath, ws.id, target.gitUrl(ws.sandboxPath))
    await withLock(mirrorPath, async () => {
      const refs = await this.git.run(mirrorPath, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin', 'refs/tags'])
      if (refs.stdout.trim() === '') return
      await this.git.run(mirrorPath, [
        'push',
        name,
        '+refs/remotes/origin/*:refs/remotes/origin/*',
        'refs/tags/*:refs/tags/*'
      ])
    })

    const url = `https://github.com/${repo.owner}/${repo.name}.git`
    const remoteRef = shQuote(`refs/remotes/origin/${defaultBranch}`)
    const branch = shQuote(defaultBranch)
    const originBranch = shQuote(`origin/${defaultBranch}`)
    await this.sandboxRun(
      target,
      `set -e\ncd ${p}\ngit remote add origin ${shQuote(url)}\n` +
        `if git show-ref --verify --quiet ${remoteRef}; then git checkout -q -b ${branch} ${originBranch}; fi\n`
    )
  }

  private async sandboxRun(target: SandboxTarget, script: string): Promise<void> {
    const res = await target.exec(script)
    if (res.code !== 0) throw new Error(res.stderr)
  }
}
