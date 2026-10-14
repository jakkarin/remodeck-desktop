import { realpathSync, statSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { runProcess, type ProcResult } from '../proc/run'
import { shQuote } from './shell'

export interface SandboxTarget {
  exec(script: string, opts?: { timeoutMs?: number }): Promise<ProcResult>
  gitUrl(path: string): string
}

export function sshExecArgs(sshHost: string): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshHost, 'bash', '-s']
}

/** A real sandbox host reached over ssh; the script is piped to `bash -s`. */
export class SshTarget implements SandboxTarget {
  constructor(
    private readonly sshHost: string,
    private readonly sshPath: string
  ) {}

  exec(script: string, opts?: { timeoutMs?: number }): Promise<ProcResult> {
    return runProcess(this.sshPath, sshExecArgs(this.sshHost), {
      input: script,
      timeoutMs: opts?.timeoutMs
    })
  }

  gitUrl(path: string): string {
    return path.startsWith('~') ? `ssh://${this.sshHost}/${path}` : `ssh://${this.sshHost}${path}`
  }
}

const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe'
const OS_HOME = homedir()

function canonicalPath(path: string): string {
  return realpathSync.native(path)
}

function comparablePath(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** Fail before spawning if a caller points the test double at a real home or its ancestors. */
function validateLocalHome(homeDir: string): string {
  if (
    !isAbsolute(homeDir) ||
    (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\)/i.test(homeDir))
  ) {
    throw new Error('LocalTarget HOME must be an absolute existing directory')
  }
  const home = canonicalPath(homeDir)
  if (!statSync(home).isDirectory() || comparablePath(home) === comparablePath(parse(home).root)) {
    throw new Error('LocalTarget HOME must be a non-root directory')
  }
  // userInfo reads the account database independently of HOME/USERPROFILE overrides.
  for (const realHome of [
    userInfo().homedir,
    OS_HOME,
    homedir(),
    process.env.HOME,
    process.env.USERPROFILE
  ]) {
    if (!realHome || !isAbsolute(realHome)) continue
    // Inherited homes may no longer exist, but still must not be accepted as the chosen home.
    let actualHome = resolve(realHome)
    try {
      actualHome = canonicalPath(actualHome)
    } catch {
      // Preserve the absolute spelling when canonicalization is unavailable.
    }
    const fromChosen = relative(comparablePath(home), comparablePath(actualHome))
    if (
      fromChosen === '' ||
      (!fromChosen.startsWith(`..${sep}`) && fromChosen !== '..' && !isAbsolute(fromChosen))
    ) {
      throw new Error('LocalTarget HOME must not be a real user home or its ancestor')
    }
  }
  return home.replaceAll('\\', '/')
}

/** Test double: runs the script with local bash, treating homeDir as the sandbox home. */
export class LocalTarget implements SandboxTarget {
  private readonly homeDir: string

  constructor(homeDir: string) {
    this.homeDir = validateLocalHome(homeDir)
  }

  async exec(script: string, execOpts?: { timeoutMs?: number }): Promise<ProcResult> {
    validateLocalHome(this.homeDir)
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value !== undefined &&
        !/^(?:BASH_ENV|ENV|HOME|XDG_CONFIG_HOME|GIT_CONFIG_GLOBAL)$/i.test(key)
      )
        env[key] = value
    }
    env.HOME = this.homeDir
    env.XDG_CONFIG_HOME = `${this.homeDir}/.config`
    // A launcher that discards HOME must abort before any supplied script can modify dotfiles.
    // Compare physical Bash paths so Git Bash's C:/ and /c/ spellings are equivalent.
    const guard = `__local_target_expected_home=$(builtin cd -P -- ${shQuote(this.homeDir)} && builtin pwd -P) || exit 125
__local_target_actual_home=$(builtin cd -P -- "$HOME" && builtin pwd -P) || exit 125
if [ "$__local_target_actual_home" != "$__local_target_expected_home" ]; then
  builtin printf '%s\\n' 'LocalTarget refused to run: HOME differs from the isolated directory' >&2
  exit 125
fi
unset __local_target_expected_home __local_target_actual_home
`
    return runProcess(
      process.platform === 'win32' ? GIT_BASH : 'bash',
      ['--noprofile', '--norc', '-s'],
      {
        cwd: this.homeDir,
        input: guard + script,
        env,
        timeoutMs: execOpts?.timeoutMs
      }
    )
  }

  gitUrl(path: string): string {
    if (path === '~') return this.homeDir
    if (path.startsWith('~/')) return `${this.homeDir.replace(/\/$/, '')}/${path.slice(2)}`
    return path
  }
}
