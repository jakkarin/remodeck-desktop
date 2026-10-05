// Pure input helpers shared between main and renderer: no node imports.

/** Parses `owner/name`, a github.com https URL, a `git@github.com:` URL or an `ssh://git@github.com/` URL. */
export function parseRepoInput(input: string): { owner: string; name: string } | null {
  let s = input.trim()
  const ssh = s.match(/^git@github\.com:(.+)$/)
  if (ssh) s = ssh[1]
  else s = s.replace(/^(https?:\/\/([^@/\s]+@)?(www\.)?|ssh:\/\/git@)github\.com\//, '')
  s = s.replace(/\/+$/, '').replace(/\.git$/, '')
  const m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  return m ? { owner: m[1], name: m[2] } : null
}

/** An ssh host alias must be non-empty, contain no whitespace and not look like an ssh option. */
export function isValidSshHost(sshHost: string): boolean {
  return sshHost !== '' && !sshHost.startsWith('-') && !/\s/.test(sshHost)
}

export const INVALID_SSH_HOST = 'ssh host ไม่ถูกต้อง'
