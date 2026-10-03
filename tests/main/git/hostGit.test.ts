import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitError, HostGit } from '../../../src/main/git/hostGit'

describe('HostGit', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regit-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('runs git init', async () => {
    const r = await new HostGit().run(tmp, ['init'])
    expect(r.code).toBe(0)
  })

  it('throws GitError with stderr on failure', async () => {
    const git = new HostGit()
    await git.run(tmp, ['init'])
    const err = await git.run(tmp, ['rev-parse', 'HEAD']).catch((e) => e)
    expect(err).toBeInstanceOf(GitError)
    expect(err.stderr).not.toBe('')
    expect(err.args).toEqual(['rev-parse', 'HEAD'])
    expect(err.message).toBe(`git rev-parse HEAD\n${err.stderr}`)
  })

  it('resolves with non-zero code when allowFail', async () => {
    const git = new HostGit()
    await git.run(tmp, ['init'])
    const r = await git.run(tmp, ['rev-parse', 'HEAD'], { allowFail: true })
    expect(r.code).not.toBe(0)
  })

  it('sets non-interactive env', () => {
    const { env } = new HostGit({ sshPath: 'C:/x/ssh.exe' })
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_SSH_COMMAND).toBe('"C:/x/ssh.exe" -o BatchMode=yes -o ConnectTimeout=10')
  })
})
