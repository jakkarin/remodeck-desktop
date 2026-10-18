import { runProcess, type ProcResult } from '../proc/run'
import { BASH_MISSING, resolveBashPath } from '../proc/bashPath'

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

/**
 * Runs scripts on this computer with homeDir as HOME under the local bash: on Windows always Git for Windows'
 * (never `bash` from PATH, which is usually WSL's).
 * bashPath defaults to the resolved one; null means it is missing, which makes exec reject.
 */
export class LocalTarget implements SandboxTarget {
  private readonly homeDir: string

  constructor(
    homeDir: string,
    private readonly bashPath: string | null = resolveBashPath()
  ) {
    this.homeDir = homeDir.replaceAll('\\', '/')
  }

  async exec(script: string, execOpts?: { timeoutMs?: number }): Promise<ProcResult> {
    const opts = {
      input: script,
      env: { ...process.env, HOME: this.homeDir } as Record<string, string>,
      timeoutMs: execOpts?.timeoutMs
    }
    if (this.bashPath === null) throw new Error(BASH_MISSING)
    return runProcess(this.bashPath, ['-s'], opts)
  }

  gitUrl(path: string): string {
    if (path === '~') return this.homeDir
    if (path.startsWith('~/')) return `${this.homeDir.replace(/\/$/, '')}/${path.slice(2)}`
    return path
  }
}
