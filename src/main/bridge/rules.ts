import type { RefUpdate, Repo } from '../../shared/types'

const HEADS = 'refs/heads/'

const isZeroSha = (sha: string): boolean => /^0+$/.test(sha)

export function evaluateRules(
  updates: RefUpdate[],
  policy: Pick<Repo, 'enforceRules' | 'protectedBranches'>
): { allowed: true } | { allowed: false; reason: string } {
  if (!policy.enforceRules) return { allowed: true }
  for (const u of updates) {
    if (isZeroSha(u.newSha)) return { allowed: false, reason: `Deleting is not allowed: ${u.ref}` }
    if (u.ref.startsWith(HEADS)) {
      const name = u.ref.slice(HEADS.length)
      if (policy.protectedBranches.includes(name)) {
        return { allowed: false, reason: `branch ${name} is protected` }
      }
    }
  }
  return { allowed: true }
}
