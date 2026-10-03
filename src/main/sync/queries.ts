import type { BranchInfo, CommitInfo, WorktreeInfo } from '../../shared/types'
import type { HostGit } from '../git/hostGit'
import { countDirty, parseRefs, parseWorktrees } from '../git/parsers'
import { shPath, shQuote } from '../sandbox/shell'
import type { SandboxTarget } from '../sandbox/target'

async function refExists(git: HostGit, mirrorPath: string, ref: string): Promise<boolean> {
  const res = await git.run(mirrorPath, ['show-ref', '--verify', '--quiet', ref], { allowFail: true })
  return res.code === 0
}

/** Sandbox branches as mirrored under refs/remotes/ws-<id>/*, compared against GitHub (refs/remotes/origin/*). */
export async function listBranches(
  git: HostGit,
  mirrorPath: string,
  wsId: string,
  defaultBranch: string,
  rewritten: Set<string>
): Promise<BranchInfo[]> {
  const prefix = `refs/remotes/ws-${wsId}/`
  const refs = parseRefs(
    (await git.run(mirrorPath, ['for-each-ref', '--format=%(refname)%00%(objectname)', prefix])).stdout
  )
  const defaultRef = `refs/remotes/origin/${defaultBranch}`
  const hasDefault = await refExists(git, mirrorPath, defaultRef)
  const result: BranchInfo[] = []
  for (const [ref, sha] of refs) {
    const name = ref.slice(prefix.length)
    if (name === 'HEAD') continue
    const base = (await refExists(git, mirrorPath, `refs/remotes/origin/${name}`))
      ? `origin/${name}`
      : `origin/${defaultBranch}`
    const counts = await git.run(mirrorPath, ['rev-list', '--left-right', '--count', `refs/remotes/${base}...${ref}`], {
      allowFail: true
    })
    const [behind = 0, ahead = 0] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : []
    let merged = false
    if (hasDefault) {
      const anc = await git.run(mirrorPath, ['merge-base', '--is-ancestor', ref, defaultRef], { allowFail: true })
      merged = anc.code === 0
    }
    result.push({ name, sha, base, ahead, behind, merged, rewritten: rewritten.has(name) })
  }
  return result
}

/** Commits reachable from `ref` but not `base`, newest first. */
export async function listCommits(
  git: HostGit,
  mirrorPath: string,
  base: string,
  ref: string,
  limit = 200
): Promise<CommitInfo[]> {
  const out = await git.run(mirrorPath, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x00%s%x00%an%x00%aI',
    `${base}..${ref}`
  ])
  return out.stdout
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [sha, subject, author, date] = l.split('\0')
      return { sha, subject, author, date }
    })
}

export async function getDiff(git: HostGit, mirrorPath: string, base: string, ref: string): Promise<string> {
  return (await git.run(mirrorPath, ['diff', `${base}...${ref}`])).stdout
}

const LIST_END = '@@REGIT-LIST-END@@'
const WT_MARK = '@@REGIT-WT@@ '

/** Worktrees of the sandbox repo with their dirty-entry counts, gathered in one round trip. */
export async function listWorktrees(target: SandboxTarget, sandboxPath: string): Promise<WorktreeInfo[]> {
  const script =
    `cd ${shPath(sandboxPath)} || exit 1\n` +
    `git worktree list --porcelain || exit 1\n` +
    `echo ${shQuote(LIST_END)}\n` +
    `git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do\n` +
    `  printf '%s%s\n' ${shQuote(WT_MARK)} "$wt"\n` +
    `  git -C "$wt" status --porcelain=v2 || true\n` +
    `done\n`
  const res = await target.exec(script)
  if (res.code !== 0) throw new Error(res.stderr)
  const [listPart, statusPart = ''] = res.stdout.split(LIST_END)
  const dirty = new Map<string, number>()
  for (const block of statusPart.split(WT_MARK).slice(1)) {
    const nl = block.indexOf('\n')
    const wtPath = (nl === -1 ? block : block.slice(0, nl)).replace(/\r$/, '')
    dirty.set(wtPath, countDirty(nl === -1 ? '' : block.slice(nl + 1)))
  }
  return parseWorktrees(listPart).map((w) => ({ ...w, dirty: dirty.get(w.path) ?? 0 }))
}
