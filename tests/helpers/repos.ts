import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-'))
}

/** Runs git in `cwd`; resolves stdout, rejects on non-zero exit. */
export function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}\n${stderr}`))
      else resolve(stdout)
    })
  })
}

const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

/** A local bare repo standing in for GitHub, plus a scratch clone used to commit and push. */
export function makeFakeGitHub(tmp: string): {
  url: string
  seed(files: Record<string, string>, branch?: string): Promise<string>
} {
  const url = path.join(tmp, 'fake-github.git')
  const scratch = path.join(tmp, 'fake-github-scratch')
  let ready: Promise<void> | null = null
  const init = (): Promise<void> =>
    (ready ??= (async () => {
      fs.mkdirSync(url, { recursive: true })
      await git(url, 'init', '--bare', '-b', 'main')
      fs.mkdirSync(scratch, { recursive: true })
      await git(scratch, 'init', '-b', 'main')
      await git(scratch, 'remote', 'add', 'origin', url)
    })())

  return {
    url,
    async seed(files, branch = 'main') {
      await init()
      const exists = (await git(url, 'branch', '--list', branch)).trim() !== ''
      if (exists) {
        await git(scratch, 'fetch', 'origin', branch)
        await git(scratch, 'checkout', '-B', branch, `origin/${branch}`)
      } else {
        await git(scratch, 'checkout', '-B', branch)
      }
      for (const [name, content] of Object.entries(files)) {
        const file = path.join(scratch, name)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, content)
      }
      await git(scratch, 'add', '-A')
      await git(scratch, ...ident, 'commit', '--allow-empty', '-m', 'seed')
      await git(scratch, 'push', 'origin', `${branch}:${branch}`)
      return (await git(scratch, 'rev-parse', 'HEAD')).trim()
    }
  }
}
