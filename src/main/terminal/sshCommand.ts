import { shPath } from '../sandbox/shell'

export type TerminalSshOptions = {
  sshHost: string
  rport: number
  bridgePort: number
  token: string
  path: string
}

/** GitHub URL prefixes (https, scp-style ssh, ssh://) rewritten to the bridge; env only, nothing is written to disk. */
const INSTEAD_OF = ['https://github.com/', 'git@github.com:', 'ssh://git@github.com/']

/** ssh args for an interactive shell in the sandbox repo, with the git bridge tunnelled in. */
export function buildTerminalSshArgs(o: TerminalSshOptions): string[] {
  const key = `url.http://127.0.0.1:${o.rport}/s/${o.token}/.insteadOf`
  const vars = INSTEAD_OF.map((v, i) => `GIT_CONFIG_KEY_${i}='${key}' GIT_CONFIG_VALUE_${i}='${v}'`)
  const remoteCmd =
    'cd ' +
    shPath(o.path) +
    ` && export GIT_CONFIG_COUNT=${INSTEAD_OF.length} ${vars.join(' ')} && exec "$SHELL" -l`
  return [
    '-t',
    '-o',
    'ExitOnForwardFailure=yes',
    '-R',
    `127.0.0.1:${o.rport}:127.0.0.1:${o.bridgePort}`,
    o.sshHost,
    remoteCmd
  ]
}

/** A random remote port in [20000, 60000). */
export function randomPort(rand: () => number = Math.random): number {
  return 20000 + Math.floor(rand() * 40000)
}
