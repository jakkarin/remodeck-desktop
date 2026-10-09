import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { ROOT, buildInstallScript, helperScript, type InstallInput } from '../../../src/main/gitAccess/scripts'

// R1: NOSYSTEM keeps the machine's system credential helper (e.g. Git Credential Manager) out of every run;
// the unset keeps an askpass program from answering where the helper stays silent.
const PREFIX = 'export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0\nunset GIT_ASKPASS SSH_ASKPASS\n'

const providers = [{ host: 'github.com', gitUsername: 'x-access-token' }]
const input = (tokens: InstallInput['tokens']): InstallInput => ({ tokens, providers, wrappers: [] })

describe('credential helper and install script', () => {
  let home: string
  let t: LocalTarget
  const run = (script: string) => t.exec(PREFIX + script)
  const install = (tokens: InstallInput['tokens']) => run(buildInstallScript(input(tokens)))
  const fill = (path: string) =>
    run(`printf 'protocol=https\\nhost=github.com\\npath=${path}\\n\\n' | git credential fill`)

  const shHome = async () => (await t.exec('printf %s "$HOME"')).stdout

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-x-')).replaceAll('\\', '/')
    t = new LocalTarget(home)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const tokens = [
    { host: 'github.com', path: 'org-a', token: 'A$`x' },
    { host: 'github.com', path: 'org-a/payments', token: 'P' },
    { host: 'github.com', path: 'org-b', token: 'B' }
  ]

  it('answers git credential fill by longest prefix, case and .git insensitively', async () => {
    const r = await install(tokens)
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect((await fill('org-a/x.git')).stdout).toContain('password=A$`x\n')
    expect((await fill('Org-A/Payments.git')).stdout).toContain('password=P\n')
    expect((await fill('org-a/payments/')).stdout).toContain('password=P\n')
    expect((await fill('ORG-A/Payments/Deep/Repo')).stdout).toContain('password=P\n')
    expect((await fill('org-b/y.git')).stdout).toContain('username=x-access-token')
    expect((await fill('org-c/y.git')).code).not.toBe(0) // no answer, prompt disabled
  })

  it('stays silent for other hosts, schemes, and non-get actions', async () => {
    await install(tokens)
    const helper = `sh "${ROOT}/git-credential-remodeck"`
    const ask = (proto: string, host: string, action = 'get') =>
      run(`printf 'protocol=${proto}\\nhost=${host}\\npath=org-a/x\\n\\n' | ${helper} ${action}`)
    expect((await ask('https', 'gitlab.com')).stdout).toBe('')
    expect((await ask('http', 'github.com')).stdout).toBe('')
    expect((await ask('https', 'github.com', 'store')).stdout).toBe('')
    expect((await ask('https', 'github.com', 'erase')).stdout).toBe('')
    expect((await ask('https', 'github.com')).stdout).toContain('password=A$`x')
  })

  it('--token-for prints only the token', async () => {
    await install(tokens)
    const tokenFor = (s: string) => run(`sh "${ROOT}/git-credential-remodeck" --token-for ${s}`)
    expect((await tokenFor('github.com/org-a/payments')).stdout).toBe('P')
    expect((await tokenFor('github.com/org-a/other')).stdout).toBe('A$`x')
    expect((await tokenFor('GitHub.com/Org-B/R.git')).stdout).toBe('B')
    expect((await tokenFor('github.com/nope/x')).stdout).toBe('')
    expect((await tokenFor('../../etc/x')).stdout).toBe('')
  })

  it('runs under dash when the machine has it', async () => {
    await install(tokens)
    if ((await t.exec('command -v dash')).code !== 0) return
    const r = await run(
      `printf 'protocol=https\\nhost=GitHub.com\\npath=Org-A/Payments.git/\\n\\n' | dash "${ROOT}/git-credential-remodeck" get`
    )
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('username=x-access-token\npassword=P\n')
  })

  it('does not let path traversal reach another directory', async () => {
    await install(tokens)
    const r = await run(
      `printf 'protocol=https\\nhost=github.com\\npath=org-b/../org-a/x\\n\\n' | sh "${ROOT}/git-credential-remodeck" get`
    )
    expect(r.stdout).toBe('')
  })

  it('writes awkward token values verbatim with no trailing newline', async () => {
    const awkward = [`a$b\`c'd\\e`, '$(touch${IFS}pwned)', `"q"'`, '%s%n\\n', '-n', 'x'.repeat(512)]
    for (const [i, token] of awkward.entries()) {
      await install([{ host: 'github.com', path: `r${i}`, token }])
      const r = await run(`cat "${ROOT}/tokens/github.com/r${i}/@token"`)
      expect(r.stdout).toBe(token)
    }
    await install([{ host: 'github.com', path: 'q', token: `it's` }])
    expect((await fill('q/x')).stdout).toContain(`password=it's\n`)
  })

  it('erase leaves the token in place', async () => {
    await install(tokens)
    await run(
      `printf 'protocol=https\\nhost=github.com\\npath=org-b/y\\nusername=x-access-token\\npassword=B\\n\\n' | git credential reject`
    )
    expect((await t.exec(`cat "${ROOT}/tokens/github.com/org-b/@token"`)).stdout).toBe('B')
  })

  it('writes providers.conf and a gitconfig pointing at the absolute helper path', async () => {
    await install(tokens)
    expect((await t.exec(`cat "${ROOT}/providers.conf"`)).stdout).toBe('github.com x-access-token\n')
    const cfg = (await t.exec(`cat "${ROOT}/gitconfig"`)).stdout
    expect(cfg).toBe(
      `[credential "https://github.com"]\n\thelper = ${await shHome()}/.config/remodeck/git-access/git-credential-remodeck\n\tuseHttpPath = true\n`
    )
  })

  it('install twice converges and lists the include once', async () => {
    // MSYS would rewrite the /tmp-style HOME in git's argv to C:/..., hiding the stored value from grep; no-op on Linux.
    const noConv = (script: string) => run('export MSYS_NO_PATHCONV=1\n' + script)
    await noConv(buildInstallScript(input(tokens)))
    const r = await noConv(buildInstallScript(input(tokens)))
    expect(r.code).toBe(0)
    const inc = await noConv('git config --global --get-all include.path')
    expect(inc.stdout.trim().split('\n')).toEqual([`${await shHome()}/.config/remodeck/git-access/gitconfig`])
  })

  it('prunes removed scopes and empty directories but keeps sibling overrides', async () => {
    await install(tokens)
    await install([tokens[1], tokens[2]]) // org-a removed, org-a/payments override kept
    expect((await t.exec(`cat "${ROOT}/tokens/github.com/org-a/payments/@token"`)).stdout).toBe('P')
    expect((await t.exec(`test -e "${ROOT}/tokens/github.com/org-a/@token"`)).code).not.toBe(0)
    expect((await fill('org-a/x')).code).not.toBe(0)

    await install([tokens[0], tokens[2]]) // override removed, parent org-a restored
    expect((await t.exec(`test -e "${ROOT}/tokens/github.com/org-a/payments"`)).code).not.toBe(0)
    expect((await fill('org-a/payments')).stdout).toContain('password=A$`x')

    await install([tokens[2]]) // only org-b
    expect((await t.exec(`test -e "${ROOT}/tokens/github.com/org-a"`)).code).not.toBe(0)
    expect((await t.exec(`cat "${ROOT}/tokens/github.com/org-b/@token"`)).stdout).toBe('B')

    await install([])
    expect((await t.exec(`test -d "${ROOT}/tokens" && ls -A "${ROOT}/tokens"`)).stdout).toBe('')
  })

  it('rejects unnormalized scopes and bad token values without echoing the token', () => {
    expect(() => buildInstallScript(input([{ host: 'github.com', path: 'Org', token: 't' }]))).toThrow()
    expect(() => buildInstallScript(input([{ host: 'github.com', path: 'a/../b', token: 't' }]))).toThrow()
    const secret = 'has space'
    expect(() => buildInstallScript(input([{ host: 'github.com', path: 'a', token: secret }]))).toThrow(
      /Invalid token value/
    )
    try {
      buildInstallScript(input([{ host: 'github.com', path: 'a', token: secret }]))
    } catch (e) {
      expect((e as Error).message).not.toContain(secret)
    }
  })

  it('helper source is plain POSIX sh', () => {
    const h = helperScript()
    expect(h.startsWith('#!/bin/sh\n')).toBe(true)
    expect(h).not.toMatch(/\[\[|\bsource\b|\$\{[^}]*,,|<<</)
  })

  // Experiment (git 2.45.1, Git Bash): the user keeps a path-less `store` entry for the host
  // (https://u:old@github.com in ~/.git-credentials) and `credential.helper = store` globally, listed BEFORE our
  // include, so `store` is asked first. Our gitconfig sets useHttpPath = true for https://github.com.
  // Observed: with the path in the query, `store` does NOT match the path-less entry, so
  //  - a repo with a remodeck token still gets our token (the stored "old" password never shadows it), and
  //  - a repo with no remodeck token gets no answer at all: the user's path-less stored login stops working
  //    for that host (git falls through to a prompt). useHttpPath therefore takes over the whole host.
  it('useHttpPath: a path-less store entry no longer answers once our gitconfig is included', async () => {
    await run(`printf 'https://u:old@github.com\\n' > "$HOME/.git-credentials"`)
    await run('git config --global credential.helper store')
    await install(tokens)
    const own = await fill('org-a/x')
    expect(own.stdout).toContain('password=A$`x\n')
    expect(own.stdout).not.toContain('old')
    const other = await fill('org-c/y')
    expect(other.code).not.toBe(0)
    expect(other.stdout).not.toContain('old')
  })

  it.skipIf(process.platform === 'win32')('modes: dir 700, @token 600, helper 700', async () => {
    await install(tokens)
    const mode = async (p: string) => (await t.exec(`stat -c %a "${ROOT}/${p}"`)).stdout.trim()
    expect(await mode('')).toBe('700')
    expect(await mode('tokens')).toBe('700')
    expect(await mode('tokens/github.com/org-a/payments')).toBe('700')
    expect(await mode('tokens/github.com/org-a/@token')).toBe('600')
    expect(await mode('git-credential-remodeck')).toBe('700')
  })
})
