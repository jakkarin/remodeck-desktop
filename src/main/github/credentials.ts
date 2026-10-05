import type { HostGit } from '../git/hostGit'

export type Credential = { username: string; password: string }

export function parseCredentialOutput(out: string): Credential | null {
  const fields = new Map<string, string>()
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) fields.set(line.slice(0, i), line.slice(i + 1))
  }
  const password = fields.get('password')
  if (!password) return null
  return { username: fields.get('username') ?? '', password }
}

export async function getGitHubCredential(git: Pick<HostGit, 'run'>): Promise<Credential | null> {
  try {
    const res = await git.run(null, ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      allowFail: true
    })
    if (res.code !== 0) return null
    return parseCredentialOutput(res.stdout)
  } catch {
    return null
  }
}
