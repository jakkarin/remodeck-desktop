import type { PushLogEntry, PushOutcome, Workspace } from '../../shared/types'
import { GitError, type HostGit } from '../git/hostGit'
import { withLock } from '../git/lock'
import { parseRefs, parseSymrefHead } from '../git/parsers'
import type { MirrorService } from '../mirror/mirrorService'
import type { SandboxTarget } from '../sandbox/target'
import { shPath, shQuote, validateSandboxPath } from '../sandbox/shell'
import type { Store } from '../store/store'

const NOT_EMPTY_CODE = 3
/** Target is a leftover of an earlier failed clone (bare `git init`): resume without re-initialising. */
const RESUMABLE_CODE = 4

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

    const outcome = await withLock(mirrorPath, async () => {
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
      let tagConflicts: string[] = []
      if (refs.stdout.trim() !== '') {
        const args = [
          'push',
          '--porcelain',
          name,
          '+refs/remotes/origin/*:refs/remotes/origin/*',
          'refs/tags/*:refs/tags/*'
        ]
        const res = await this.git.run(mirrorPath, args, { allowFail: true })
        if (res.code !== 0) {
          // Push is not atomic: branch refs were updated even if some tags were refused.
          const rejected = rejectedRefs(res.stdout)
          if (rejected.length === 0 || !rejected.every((r) => r.startsWith('refs/tags/'))) {
            throw new GitError(args, res.code, res.stderr)
          }
          tagConflicts = rejected.map((r) => r.slice('refs/tags/'.length))
        }
      }
      return { result, tagConflicts }
    })
    this.rewritten.set(ws.id, new Set(outcome.result))
    if (outcome.tagConflicts.length > 0) {
      throw new Error(`tag ชนกับใน sandbox: ${outcome.tagConflicts.join(', ')}`)
    }
    return { rewritten: outcome.result }
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
      // --no-follow-tags: never publish tags along with the branch, even if push.followTags is set.
      const pushArgs = ['push', '--no-follow-tags', 'origin', `${srcRef}:${dstRef}`]
      const res = await this.git.run(mirrorPath, pushArgs, { allowFail: true })
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

  /**
   * GitHub -> host mirror -> freshly `git init`ed sandbox repo. Only touches origin remote refs, tags and the default branch.
   * Resumable: a target left by a failed clone (only `.git`, no commits, no origin remote) is reused without `git init`.
   */
  async cloneToSandbox(ws: Workspace): Promise<void> {
    validateSandboxPath(ws.sandboxPath)
    const target = this.targetFor(ws.hostId)
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const p = shPath(ws.sandboxPath)

    const check = await target.exec(
      [
        `p=${p}`,
        'if [ -e "$p" ]; then',
        `  [ -d "$p" ] || exit ${NOT_EMPTY_CODE}`,
        '  entries="$(ls -A "$p")"',
        '  [ -z "$entries" ] && exit 0',
        `  [ "$entries" = ".git" ] || exit ${NOT_EMPTY_CODE}`,
        `  [ "$(git -C "$p" rev-parse --git-dir 2>/dev/null)" = ".git" ] || exit ${NOT_EMPTY_CODE}`,
        `  git -C "$p" rev-parse --verify --quiet HEAD >/dev/null && exit ${NOT_EMPTY_CODE}`,
        `  git -C "$p" remote get-url origin >/dev/null 2>&1 && exit ${NOT_EMPTY_CODE}`,
        `  exit ${RESUMABLE_CODE}`,
        'fi',
        ''
      ].join('\n')
    )
    if (check.code === NOT_EMPTY_CODE) throw new Error(`Path ไม่ว่าง: ${ws.sandboxPath}`)
    if (check.code !== 0 && check.code !== RESUMABLE_CODE) throw new Error(check.stderr)
    const resume = check.code === RESUMABLE_CODE

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

    if (!resume) await this.sandboxRun(target, `set -e\np=${p}\nmkdir -p "$p"\ngit init "$p"\n`)

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

/** Destination refs of the `!` (rejected) lines in `git push --porcelain` output. */
function rejectedRefs(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((l) => l.startsWith('!'))
    .map((l) => (l.split('\t')[1] ?? '').split(':')[1] ?? '')
    .filter((r) => r !== '')
}
