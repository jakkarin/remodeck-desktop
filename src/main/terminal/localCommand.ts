import { bridgeGitEnv } from './sshCommand'

export type LocalTerminalOptions = {
  bashPath: string
  bridgePort: number
  token: string
  path: string
  homeDir: string
}

/** Interactive bash in the repo on this computer; git reaches GitHub through the bridge on 127.0.0.1. */
export function buildLocalTerminal(o: LocalTerminalOptions): {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
} {
  const home = o.homeDir.replaceAll('\\', '/').replace(/\/$/, '')
  const cwd =
    o.path === '~' ? home : o.path.startsWith('~/') ? `${home}/${o.path.slice(2)}` : o.path
  return {
    file: o.bashPath,
    args: ['--login', '-i'],
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      ...bridgeGitEnv(`http://127.0.0.1:${o.bridgePort}/s/${o.token}/`)
    }
  }
}

/** One command in a login bash on this computer. */
export function buildLocalHostCommand(
  bashPath: string,
  cmd: string
): { file: string; args: string[] } {
  return { file: bashPath, args: ['--login', '-c', cmd] }
}
