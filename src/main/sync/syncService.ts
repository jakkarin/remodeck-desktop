import fs from 'node:fs'
import type {
  ExistingRepoInfo,
  PushLogEntry,
  PushOutcome,
  Repo,
  Workspace
} from '../../shared/types'
import { parseRepoInput } from '../../shared/validate'
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

// Exit codes of the read-only probe run by inspectExisting.
const NOT_FOUND_CODE = 11
const NOT_REPO_CODE = 12
const BARE_CODE = 13
const NOT_ROOT_CODE = 14
const NO_ORIGIN_CODE = 15

/** Thrown by sync() when the sandbox refused some tags; branch refs were still synced. */
class TagConflictError extends Error {
  constructor(tags: string[]) {
    super(`Tags conflict with the sandbox: ${tags.join(', ')}`)
  }
}

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

  /** Branches whose history was rewritten in the sandbox since the flag was last cleared (manual Sync). */
  rewrittenBranches(wsId: string): Set<string> {
    return new Set(this.rewritten.get(wsId) ?? [])
  }

  /** Forget the rewritten flags of a workspace (called when the user presses Sync). */
  clearRewritten(wsId: string): void {
    this.rewritten.delete(wsId)
  }

  /** Two-way sync. Never touches sandbox refs/heads or working tree: only refs/remotes/origin/* and tags are pushed. */
  async sync(ws: Workspace): Promise<{ rewritten: string[] }> {
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const mirrorPath = this.store.mirrorPath(repo)
    const name = this.remoteName(ws.id)

    const outcome = await withLock(mirrorPath, async () => {
      await this.git.run(mirrorPath, ['fetch', '--prune', 'origin'])
      const result = await this.fetchWorkspace(mirrorPath, ws.id)
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
    if (outcome.tagConflicts.length > 0) {
      throw new TagConflictError(outcome.tagConflicts)
    }
    return { rewritten: outcome.result }
  }

  /** Light sync: fetch only from the sandbox. Writes nothing into the sandbox and leaves the mirror's origin refs alone. */
  async fetchSandbox(ws: Workspace): Promise<{ rewritten: string[] }> {
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const mirrorPath = this.store.mirrorPath(repo)
    const result = await withLock(mirrorPath, () => this.fetchWorkspace(mirrorPath, ws.id))
    return { rewritten: result }
  }

  /** Fetch ws-<id> into the mirror and return branches whose history was rewritten (not a fast-forward). Caller holds the lock. */
  private async fetchWorkspace(mirrorPath: string, wsId: string): Promise<string[]> {
    const name = this.remoteName(wsId)
    const prefix = `refs/remotes/${name}/`
    const listWs = async (): Promise<Map<string, string>> =>
      parseRefs(
        (
          await this.git.run(mirrorPath, [
            'for-each-ref',
            '--format=%(refname)%00%(objectname)',
            prefix
          ])
        ).stdout
      )
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
      else if (res.code !== 0)
        throw new Error(`git merge-base --is-ancestor failed (${res.code}): ${res.stderr}`)
    }
    // Flags accumulate across fetches; a branch leaves the set once it no longer exists in the sandbox.
    const flagged = new Set([...(this.rewritten.get(wsId) ?? []), ...result])
    for (const branch of flagged) if (!after.has(prefix + branch)) flagged.delete(branch)
    this.rewritten.set(wsId, flagged)
    return result
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
      const res = await this.git.run(mirrorPath, ['rev-parse', '--verify', '--quiet', ref], {
        allowFail: true
      })
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
        const message = `branch ${target} is protected — change this in Settings`
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
            message: `GitHub has newer commits — press Sync, then have the AI rebase onto origin/${target}`
          }
        }
        log({ updates, result: 'error', detail: res.stderr })
        return { ok: false, reason: 'error', message: res.stderr }
      }
      log({ updates, result: 'ok' })
      // Best effort refresh of origin refs; the push already succeeded and is logged.
      await this.git
        .run(mirrorPath, ['fetch', 'origin'], { allowFail: true })
        .catch(() => undefined)
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
    if (check.code === NOT_EMPTY_CODE) throw new Error(`Path is not empty: ${ws.sandboxPath}`)
    if (check.code !== 0 && check.code !== RESUMABLE_CODE) throw new Error(check.stderr)
    const resume = check.code === RESUMABLE_CODE

    const { mirrorPath, defaultBranch } = await this.prepareMirror(repo)

    if (!resume) await this.sandboxRun(target, `set -e\np=${p}\nmkdir -p "$p"\ngit init "$p"\n`)

    const name = this.remoteName(ws.id)
    await this.mirror.addWorkspace(mirrorPath, ws.id, target.gitUrl(ws.sandboxPath))
    await this.pushOriginRefs(mirrorPath, name)

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

  /**
   * Make sure the repo's mirror exists and is fresh, and learn GitHub's default branch (stored on the repo).
   * mirror.ensure/addWorkspace take the mirror lock themselves (not reentrant), so each section locks on its own.
   */
  private async prepareMirror(repo: Repo): Promise<{ mirrorPath: string; defaultBranch: string }> {
    const mirrorPath = this.store.mirrorPath(repo)
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
    return { mirrorPath, defaultBranch }
  }

  /** Push the mirror's origin branches and tags to the sandbox repo `name` (a no-op while the mirror is empty). */
  private async pushOriginRefs(mirrorPath: string, name: string): Promise<void> {
    await withLock(mirrorPath, async () => {
      const refs = await this.git.run(mirrorPath, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/remotes/origin',
        'refs/tags'
      ])
      if (refs.stdout.trim() === '') return
      await this.git.run(mirrorPath, [
        'push',
        name,
        '+refs/remotes/origin/*:refs/remotes/origin/*',
        'refs/tags/*:refs/tags/*'
      ])
    })
  }

  /**
   * Register a repo that already exists in the sandbox as a workspace, without modifying it.
   * The only writes to the sandbox repo are the ones sync() always does (origin refs and tags pushed from the mirror):
   * no `git init`, no remote changes, no checkout. On failure only remodeck's own records are rolled back.
   */
  async addExisting(
    hostId: string,
    sandboxPath: string,
    expected: { owner: string; name: string }
  ): Promise<Workspace> {
    const path = this.checkExistingPath(hostId, sandboxPath)
    const want =
      typeof expected?.owner === 'string' && typeof expected?.name === 'string'
        ? parseRepoInput(`${expected.owner}/${expected.name}`)
        : null
    if (!want || want.owner !== expected.owner || want.name !== expected.name)
      throw new Error('The confirmed repo is invalid')
    // The sandbox is untrusted and may have changed origin since the user confirmed: re-probe before any write or fetch.
    const { owner, name } = await this.inspectExisting(hostId, path)
    if (
      owner.toLowerCase() !== want.owner.toLowerCase() ||
      name.toLowerCase() !== want.name.toLowerCase()
    )
      throw new Error(
        `The repo origin changed since confirmation (now points to ${owner}/${name}) — please check again`
      )
    const repo = this.store.upsertRepo(owner, name)
    const ws = this.store.addWorkspace(repo.id, hostId, path)
    try {
      await this.adoptExisting(ws)
    } catch (err) {
      // Undo only our own records; never delete anything in the sandbox.
      this.store.removeWorkspace(ws.id)
      const mirrorPath = this.store.mirrorPath(repo)
      if (fs.existsSync(mirrorPath))
        await this.mirror.removeWorkspace(mirrorPath, ws.id).catch(() => undefined)
      throw err
    }
    return ws
  }

  /** Validates the path and rejects duplicates; returns the normalised path. */
  private checkExistingPath(hostId: string, sandboxPath: string): string {
    validateSandboxPath(sandboxPath)
    const path = sandboxPath.replace(/\/+$/, '')
    if (this.store.config.workspaces.some((w) => w.hostId === hostId && w.sandboxPath === path))
      throw new Error(`This workspace already exists: ${path}`)
    return path
  }

  /**
   * Read-only preview for the confirmation step: which GitHub repo this sandbox path resolves to, and whether
   * remodeck already knows it. Writes nothing (no store change, no mirror, no fetch).
   */
  async describeExisting(hostId: string, sandboxPath: string): Promise<ExistingRepoInfo> {
    const path = this.checkExistingPath(hostId, sandboxPath)
    const { owner, name } = await this.inspectExisting(hostId, path)
    const known = this.store.config.repos.find(
      (r) =>
        r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase()
    )
    return { owner, name, known: !!known, alwaysAllowPush: known?.alwaysAllowPush ?? false }
  }

  /** One read-only probe of the sandbox path; resolves GitHub's owner/name from the repo's origin URL. */
  async inspectExisting(
    hostId: string,
    sandboxPath: string
  ): Promise<{ owner: string; name: string }> {
    const target = this.targetFor(hostId)
    // Compare physical paths on both sides (symlinks, `~`); the toplevel is normalised through `cd` as well
    // because git for Windows prints C:/... where bash's pwd prints /c/...
    const res = await target.exec(
      [
        `p=${shPath(sandboxPath)}`,
        `[ -d "$p" ] || exit ${NOT_FOUND_CODE}`,
        `git -C "$p" rev-parse --git-dir >/dev/null 2>&1 || exit ${NOT_REPO_CODE}`,
        `[ "$(git -C "$p" rev-parse --is-bare-repository)" = false ] || exit ${BARE_CODE}`,
        'top="$(git -C "$p" rev-parse --show-toplevel 2>/dev/null)"',
        'real="$(cd "$p" && pwd -P)"',
        'toppath=""',
        '[ -n "$top" ] && toppath="$(cd "$top" 2>/dev/null && pwd -P)"',
        `[ "$toppath" = "$real" ] || { printf '%s' "$toppath"; exit ${NOT_ROOT_CODE}; }`,
        'url="$(git -C "$p" config --get remote.origin.url 2>/dev/null)"',
        `[ -n "$url" ] || exit ${NO_ORIGIN_CODE}`,
        'printf "%s" "$url"',
        ''
      ].join('\n')
    )
    switch (res.code) {
      case 0:
        break
      case NOT_FOUND_CODE:
        throw new Error(`Path not found in sandbox: ${sandboxPath}`)
      case NOT_REPO_CODE:
        throw new Error(`Not a git repo: ${sandboxPath}`)
      case BARE_CODE:
        throw new Error(`Bare repo (a working tree is required): ${sandboxPath}`)
      case NOT_ROOT_CODE: {
        const root = res.stdout.trim()
        throw new Error(
          `Path is not the repo root: ${sandboxPath}` + (root ? ` (root is ${root})` : '')
        )
      }
      case NO_ORIGIN_CODE:
        throw new Error(`Repo has no remote origin: ${sandboxPath}`)
      default:
        throw new Error(res.stderr)
    }
    const url = res.stdout.trim()
    const parsed = /github\.com[/:]/.test(url) ? parseRepoInput(url) : null
    // Never echo credentials an origin URL may embed (https://user:token@host/...).
    if (!parsed)
      throw new Error(`Origin does not point to GitHub: ${url.replace(/\/\/[^@/\s]+@/, '//***@')}`)
    return parsed
  }

  /** Mirror setup for an adopted workspace, then a normal full sync so the sandbox's branches show up in the mirror. */
  private async adoptExisting(ws: Workspace): Promise<void> {
    const repo = this.store.config.repos.find((r) => r.id === ws.repoId)
    if (!repo) throw new Error(`Unknown repo ${ws.repoId}`)
    const { mirrorPath } = await this.prepareMirror(repo)
    await this.mirror.addWorkspace(
      mirrorPath,
      ws.id,
      this.targetFor(ws.hostId).gitUrl(ws.sandboxPath)
    )
    try {
      await this.sync(ws)
    } catch (err) {
      // Deliberately keep the workspace when only tags conflict: branches are already synced and the
      // next manual Sync reports the conflict again, which is more useful than refusing to add the repo.
      if (!(err instanceof TagConflictError)) throw err
    }
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
