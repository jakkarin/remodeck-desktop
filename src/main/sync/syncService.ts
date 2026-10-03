import type { PushLogEntry, PushOutcome, Workspace } from '../../shared/types'
import type { HostGit } from '../git/hostGit'
import { withLock } from '../git/lock'
import { parseRefs, parseSymrefHead } from '../git/parsers'
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

  private readonly rewritten = new Map<string, Set<string>>()

  /** Branches whose history was rewritten in the sandbox as of the last sync (empty if never synced). */
  rewrittenBranches(wsId: string): Set<string> {
    return new Set(this.rewritten.get(wsId) ?? [])
  }

  /** Two-way sync. Never touches sandbox refs/heads or working tree: only refs/remotes/origin/* and tags are pushed. */
  async sync(ws: Workspace): Promise<{ rewritten: string[] }> {
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const mirrorPath = this.store.mirrorPath(repo)
    const name = this.remoteName(ws.id)
    const prefix = `refs/remotes/${name}/`
    const listWs = async (): Promise<Map<string, string>> =>
      parseRefs(
        (await this.git.run(mirrorPath, ['for-each-ref', '--format=%(refname)%00%(objectname)', prefix])).stdout
      )

    const rewritten = await withLock(mirrorPath, async () => {
      await this.git.run(mirrorPath, ['fetch', '--prune', 'origin'])
      const before = await listWs()
      await this.git.run(mirrorPath, ['fetch', '--prune', '--no-tags', name])
      const after = await listWs()
      const result: string[] = []
      for (const [ref, oldSha] of before) {
        const newSha = after.get(ref)
        const branch = ref.slice(prefix.length)
        if (!newSha || newSha === oldSha || branch === 'HEAD') continue
        const res = await this.git.run(mirrorPath, ['merge-base', '--is-ancestor', oldSha, newSha], {
          allowFail: true
        })
        if (res.code === 1) result.push(branch)
        else if (res.code !== 0) throw new Error(`git merge-base --is-ancestor failed (${res.code}): ${res.stderr}`)
      }
      const refs = await this.git.run(mirrorPath, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/remotes/origin',
        'refs/tags'
      ])
      if (refs.stdout.trim() !== '') {
        await this.git.run(mirrorPath, [
          'push',
          name,
          '+refs/remotes/origin/*:refs/remotes/origin/*',
          'refs/tags/*:refs/tags/*'
        ])
      }
      return result
    })
    this.rewritten.set(ws.id, new Set(rewritten))
    return { rewritten }
  }

  /** Push a sandbox branch (from the mirror) to GitHub as <target>. Never forces. */
  async pushToGitHub(ws: Workspace, branch: string, target: string): Promise<PushOutcome> {
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const mirrorPath = this.store.mirrorPath(repo)
    const srcRef = `refs/remotes/${this.remoteName(ws.id)}/${branch}`
    const dstRef = `refs/heads/${target}`
    const ZERO = '0'.repeat(40)
    const sha = async (ref: string): Promise<string> => {
      const res = await this.git.run(mirrorPath, ['rev-parse', '--verify', '--quiet', ref], { allowFail: true })
      return res.code === 0 ? res.stdout.trim() : ZERO
    }
    const log = (e: Pick<PushLogEntry, 'updates' | 'result' | 'detail'>): void =>
      this.store.appendPushLog({
        time: new Date().toISOString(),
        repo: `${repo.owner}/${repo.name}`,
        workspaceId: ws.id,
        channel: 'review',
        ...e
      })

    return withLock(mirrorPath, async (): Promise<PushOutcome> => {
      const oldSha = await sha(`refs/remotes/origin/${target}`)
      const newSha = await sha(srcRef)
      const updates = [{ oldSha, newSha, ref: dstRef }]
      if (repo.enforceRules && repo.protectedBranches.includes(target)) {
        const message = `branch ${target} ถูกป้องกัน — แก้ได้ใน Settings`
        log({ updates, result: 'blocked', detail: message })
        return { ok: false, reason: 'protected', message }
      }
      const res = await this.git.run(mirrorPath, ['push', '--no-follow-tags', 'origin', `${srcRef}:${dstRef}`], {
        allowFail: true
      })
      if (res.code !== 0) {
        if (/\[rejected\]/.test(res.stderr) && /non-fast-forward|fetch first/.test(res.stderr)) {
          log({ updates, result: 'rejected', detail: res.stderr })
          return {
            ok: false,
            reason: 'non-fast-forward',
            message: `GitHub มี commit ใหม่กว่า — กด Sync แล้วให้ AI rebase บน origin/${target}`
          }
        }
        log({ updates, result: 'error', detail: res.stderr })
        return { ok: false, reason: 'error', message: res.stderr }
      }
      log({ updates, result: 'ok' })
      // Best effort refresh of origin refs; the push already succeeded and is logged.
      await this.git.run(mirrorPath, ['fetch', 'origin'], { allowFail: true }).catch(() => undefined)
      return { ok: true }
    })
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
