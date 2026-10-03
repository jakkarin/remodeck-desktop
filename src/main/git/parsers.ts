/** `git ls-remote --symref <url> HEAD` output -> default branch name. */
export function parseSymrefHead(lsRemote: string): string | null {
  for (const line of lsRemote.split('\n')) {
    const m = /^ref:\s+refs\/heads\/(\S+)\s+HEAD\s*$/.exec(line.trimEnd())
    if (m) return m[1]
  }
  return null
}

/** `for-each-ref --format=%(refname)%00%(objectname)` output -> refname -> sha. */
export function parseRefs(out: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of out.split('\n')) {
    if (!line) continue
    const [ref, sha] = line.split('\0')
    if (ref && sha) map.set(ref, sha)
  }
  return map
}

/** `git worktree list --porcelain` output. */
export function parseWorktrees(
  porcelain: string
): { path: string; branch: string | null; head: string | null }[] {
  const result: { path: string; branch: string | null; head: string | null }[] = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    let wtPath: string | null = null
    let branch: string | null = null
    let head: string | null = null
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length)
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
    if (wtPath !== null) result.push({ path: wtPath, branch, head })
  }
  return result
}

/** `git status --porcelain=v2` output -> number of changed/untracked entries. */
export function countDirty(statusV2: string): number {
  return statusV2.split('\n').filter((l) => /^([12u?]) /.test(l)).length
}
