import { runProcess, type ProcResult } from '../proc/run'
import { BASH_MISSING } from '../proc/bashPath'

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

const GIT_BASH_FALLBACK = 'C:/Program Files/Git/bin/bash.exe'

/**
 * Runs scripts on this computer with homeDir as HOME. The app passes Git for Windows' bash (or null when it is
 * missing, which makes exec reject); tests leave bashPath out to use whatever bash is available.
 */
export class LocalTarget implements SandboxTarget {
  private readonly homeDir: string

  constructor(
    homeDir: string,
    private readonly bashPath?: string | null
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
    if (this.bashPath !== undefined) return runProcess(this.bashPath, ['-s'], opts)
    try {
      return await runProcess('bash', ['-s'], opts)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      return runProcess(GIT_BASH_FALLBACK, ['-s'], opts)
    }
  }

  gitUrl(path: string): string {
    if (path === '~') return this.homeDir
    if (path.startsWith('~/')) return `${this.homeDir.replace(/\/$/, '')}/${path.slice(2)}`
    return path
  }
}
