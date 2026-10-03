import { shPath } from '../sandbox/shell'

export type TerminalSshOptions = {
  sshHost: string
  rport: number
  bridgePort: number
  token: string
  path: string
}

/** ssh args for an interactive shell in the sandbox repo, with the git bridge tunnelled in. */
export function buildTerminalSshArgs(o: TerminalSshOptions): string[] {
  const remoteCmd =
    'cd ' +
    shPath(o.path) +
    ` && export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='url.http://127.0.0.1:${o.rport}/s/${o.token}/.insteadOf' GIT_CONFIG_VALUE_0='https://github.com/' && exec "$SHELL" -l`
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
