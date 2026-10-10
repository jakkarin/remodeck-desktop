import { runProcess, type ProcResult } from '../proc/run'
import { resolveSshPath } from '../proc/sshPath'

export class GitError extends Error {
  constructor(
    public args: string[],
    public code: number,
    public stderr: string
  ) {
    super(`git ${args.join(' ')}\n${stderr}`)
    this.name = 'GitError'
  }
}

export class HostGit {
  private readonly gitPath: string
  readonly env: Record<string, string>

  constructor(opts: { gitPath?: string; sshPath?: string } = {}) {
    this.gitPath = opts.gitPath ?? 'git'
    const sshPath = opts.sshPath ?? resolveSshPath()
    this.env = {
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: `"${sshPath}" -o BatchMode=yes -o ConnectTimeout=10`
    }
  }

  async run(
    cwd: string | null,
    args: string[],
    opts: { input?: string; allowFail?: boolean; onStderr?: (chunk: string) => void } = {}
  ): Promise<ProcResult> {
    const res = await runProcess(this.gitPath, args, {
      cwd: cwd ?? undefined,
      input: opts.input,
      onStderr: opts.onStderr,
      env: { ...(process.env as Record<string, string>), ...this.env }
    })
    if (res.code !== 0 && !opts.allowFail) throw new GitError(args, res.code, res.stderr)
    return res
  }
}
