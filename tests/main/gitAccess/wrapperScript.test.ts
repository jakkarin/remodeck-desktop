import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { buildInstallScript, cliWrapperScript, WRAPPER_VERSION } from '../../../src/main/gitAccess/scripts'
import type { CliSpec } from '../../../src/main/gitAccess/providers'
import { GIT_PREFIX } from './testHelpers'

const gh: CliSpec = { command: 'gh', tokenEnv: 'GH_TOKEN', repoFlags: ['-R', '--repo'], repoEnv: 'GH_REPO' }
const tokens = [
  { host: 'github.com', path: 'org-a', token: 'A' },
  { host: 'github.com', path: 'org-a/payments', token: 'P' },
  { host: 'github.com', path: 'org-b', token: 'B' }
]
const installScript = buildInstallScript({
  tokens,
  providers: [{ host: 'github.com', gitUsername: 'x-access-token' }],
  wrappers: [{ cli: gh, defaultHost: 'github.com' }]
})

// Prints the token it sees and its arguments, once joined and once bracketed one per line.
const FAKE_GH = `#!/bin/sh
printf 'token=%s args=%s\\n' "\${GH_TOKEN:-none}" "$*"
for a in "$@"; do printf '[%s]\\n' "$a"; done
`

describe('gh wrapper', () => {
  let home: string
  let t: LocalTarget
  const run = (script: string) => t.exec(GIT_PREFIX + script)
  const PATHS = 'export PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"\n'
  /** Runs `cmd` with the wrapper first on PATH; `dir` is a repo with that origin, or a bare directory. */
  const inDir = (cmd: string, origin?: string, env = '') =>
    run(
      `${PATHS}${env}\nmkdir -p "$HOME/w" && cd "$HOME/w" && rm -rf .git\n` +
        (origin ? `git init -q . && git remote add origin '${origin}'\n` : '') +
        cmd
    )
  const line1 = async (cmd: string, origin?: string, env?: string) =>
    (await inDir(cmd, origin, env)).stdout.split('\n')[0]

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-w-')).replaceAll('\\', '/')
    t = new LocalTarget(home)
    await run(`mkdir -p "$HOME/fakebin" && cat > "$HOME/fakebin/gh" <<'EOF'\n${FAKE_GH}EOF\nchmod 755 "$HOME/fakebin/gh"`)
    const r = await run(installScript)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('wrapper=gh:installed')
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('picks the token from the origin remote in every URL shape', async () => {
    expect(await line1('gh pr create', 'https://github.com/org-a/payments.git')).toBe('token=P args=pr create')
    expect(await line1('gh x', 'git@github.com:Org-A/x.git')).toBe('token=A args=x')
    expect(await line1('gh x', 'ssh://git@github.com/org-b/y')).toBe('token=B args=x')
    expect(await line1('gh x', 'https://user@github.com/org-b/y.git')).toBe('token=B args=x')
    expect(await line1('gh x', 'ssh://git@github.com:22/org-b/y.git')).toBe('token=B args=x')
  })

  it('reads the configured origin, not the bridge insteadOf rewrite of it', async () => {
    const key = 'url.http://127.0.0.1:1/s/tok/.insteadOf'
    const env =
      `export GIT_CONFIG_COUNT=3 GIT_CONFIG_KEY_0='${key}' GIT_CONFIG_VALUE_0='https://github.com/' ` +
      `GIT_CONFIG_KEY_1='${key}' GIT_CONFIG_VALUE_1='git@github.com:' ` +
      `GIT_CONFIG_KEY_2='${key}' GIT_CONFIG_VALUE_2='ssh://git@github.com/'`
    expect(await line1('gh x', 'https://github.com/org-a/payments.git', env)).toBe('token=P args=x')
    expect(await line1('gh x', 'git@github.com:org-b/y.git', env)).toBe('token=B args=x')
  })

  it('passes through untouched when no token matches or there is no repo', async () => {
    expect(await line1('gh x')).toBe('token=none args=x')
    expect(await line1('gh x', 'https://github.com/org-z/y.git')).toBe('token=none args=x')
    expect(await line1('gh x', 'https://gitlab.com/org-a/y.git')).toBe('token=none args=x')
  })

  it('reads -R / --repo outside a repo, in all forms', async () => {
    expect(await line1('gh -R org-b/y pr list')).toBe('token=B args=-R org-b/y pr list')
    expect(await line1('gh --repo=org-a/payments x')).toBe('token=P args=--repo=org-a/payments x')
    expect(await line1('gh pr list --repo org-a/payments')).toBe('token=P args=pr list --repo org-a/payments')
    expect(await line1('gh -R github.com/org-b/y x')).toBe('token=B args=-R github.com/org-b/y x')
    expect(await line1('gh -R gitlab.com/org-b/y x')).toBe('token=none args=-R gitlab.com/org-b/y x')
  })

  it('the repo flag wins over the origin remote, and GH_REPO sits between them', async () => {
    expect(await line1('gh -R org-b/y x', 'https://github.com/org-a/payments.git')).toBe('token=B args=-R org-b/y x')
    expect(await line1('gh x', 'https://github.com/org-a/payments.git', 'export GH_REPO=org-b/y')).toBe(
      'token=B args=x'
    )
    expect(await line1('gh -R org-a/payments x', undefined, 'export GH_REPO=org-b/y')).toBe(
      'token=P args=-R org-a/payments x'
    )
  })

  it('uses GH_REPO outside a repo', async () => {
    expect(await line1('gh x', undefined, 'export GH_REPO=org-b/y')).toBe('token=B args=x')
  })

  it('keeps a token that is already set, and treats an empty one as unset', async () => {
    const origin = 'https://github.com/org-a/payments.git'
    expect(await line1('gh x', origin, 'export GH_TOKEN=preset')).toBe('token=preset args=x')
    expect((await inDir('gh x', origin, 'export GITHUB_TOKEN=other')).stdout.split('\n')[0]).toBe('token=none args=x')
    expect(await line1('gh x', origin, 'export GH_TOKEN=')).toBe('token=P args=x')
    expect(await line1('gh x', origin, 'export GITHUB_TOKEN=')).toBe('token=P args=x')
  })

  it('passes arguments with spaces and quotes through unchanged', async () => {
    const r = await inDir(`gh issue create -t 'a b' "it's" '$x \`y\`' '' -R org-b/y`)
    expect(r.stdout.split('\n').slice(1, -1)).toEqual([
      '[issue]', '[create]', '[-t]', '[a b]', "[it's]", '[$x `y`]', '[]', '[-R]', '[org-b/y]'
    ])
  })

  it('writes the marker on line 2 with mode 755', async () => {
    expect((await t.exec('sed -n 2p "$HOME/.local/bin/gh"')).stdout).toBe(`# remodeck-cli-wrapper gh v${WRAPPER_VERSION}\n`)
    expect((await t.exec('sed -n 2p "$HOME/.local/bin/gh"')).stdout).toBe('# remodeck-cli-wrapper gh v1\n')
    if (process.platform !== 'win32') {
      expect((await t.exec('stat -c %a "$HOME/.local/bin" "$HOME/.local/bin/gh"')).stdout).toBe('755\n755\n')
    }
  })

  it('never modifies a foreign gh and reports it as skipped', async () => {
    await run(`printf '#!/bin/sh\\necho mine\\n' > "$HOME/.local/bin/gh"`)
    const before = (await t.exec('cat "$HOME/.local/bin/gh"')).stdout
    const r = await run(installScript)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('wrapper=gh:skipped')
    expect(r.stdout).not.toContain('wrapper=gh:installed')
    expect((await t.exec('cat "$HOME/.local/bin/gh"')).stdout).toBe(before)
  })

  it('skips a file whose marker version is not all digits, as status and remove do', async () => {
    await run(`printf '#!/bin/sh\\n# remodeck-cli-wrapper gh v1abc\\necho mine\\n' > "$HOME/.local/bin/gh"`)
    const before = (await t.exec('cat "$HOME/.local/bin/gh"')).stdout
    const r = await run(installScript)
    expect(r.stdout).toContain('wrapper=gh:skipped')
    expect(r.stdout).not.toContain('wrapper=gh:installed')
    expect((await t.exec('cat "$HOME/.local/bin/gh"')).stdout).toBe(before)
  })

  it('replaces an older marker version and leaves no tmp file behind', async () => {
    await run(`printf '#!/bin/sh\\n# remodeck-cli-wrapper gh v0\\nold\\n' > "$HOME/.local/bin/gh"`)
    const r = await run(installScript)
    expect(r.stdout).toContain('wrapper=gh:installed')
    expect((await t.exec('sed -n 2p "$HOME/.local/bin/gh"')).stdout).toBe('# remodeck-cli-wrapper gh v1\n')
    expect((await t.exec('ls -A "$HOME/.local/bin"')).stdout).toBe('gh\n')
  })

  it('exits 127 with a message when there is no real gh', async (ctx) => {
    const probe = (await t.exec('dirname "$(command -v git)"')).stdout.trim()
    const path = `export PATH="$HOME/.local/bin:${probe}:/usr/bin:/bin"\n`
    // the wrapper skips itself, so it only exits 127 when no other gh is on that PATH
    const real = (await run(`PATH="${probe}:/usr/bin:/bin" command -v gh`)).stdout.trim()
    if (real) ctx.skip(`a real gh resolves on the minimal PATH (${real})`)
    const r = await run(`${path}gh x`)
    expect(r.code).toBe(127)
    expect(r.stderr).toContain('gh not found')
  })

  it('runs under dash when the machine has it', async (ctx) => {
    if ((await t.exec('command -v dash')).code !== 0) ctx.skip('dash is not installed')
    const r = await inDir('dash "$HOME/.local/bin/gh" x', 'https://github.com/org-a/payments.git')
    expect(r.stderr).toBe('')
    expect(r.stdout.split('\n')[0]).toBe('token=P args=x')
  })

  it('skips itself when it is found through a relative PATH entry', async () => {
    const r = await run(`${PATHS}cd "$HOME/.local/bin" && PATH=".:$HOME/fakebin" ./gh x`)
    expect(r.stdout.split('\n')[0]).toBe('token=none args=x')
  })

  it('wrapper source is plain POSIX sh and keeps the CLI details', () => {
    const s = cliWrapperScript(gh, 'github.com', 3)
    expect(s.split('\n').slice(0, 2)).toEqual(['#!/bin/sh', '# remodeck-cli-wrapper gh v3'])
    expect(s).not.toMatch(/\[\[|\bsource\b|\$\{[^}]*,,|<<</)
  })
})
