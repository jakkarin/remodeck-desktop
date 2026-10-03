import { spawn } from 'node:child_process'

export type ProcResult = { code: number; stdout: string; stderr: string }

export type RunOpts = {
  cwd?: string
  input?: string | Buffer
  env?: Record<string, string>
  timeoutMs?: number
}

/** Spawns a process without a shell. Rejects only on spawn failure or timeout. */
export function runProcess(cmd: string, args: string[], opts: RunOpts = {}): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }

    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        child.kill()
        finish(() => reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`)))
      }, opts.timeoutMs)
    }

    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) =>
      finish(() =>
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8')
        })
      )
    )

    child.stdin.on('error', () => {})
    if (opts.input !== undefined) child.stdin.write(opts.input)
    child.stdin.end()
  })
}
