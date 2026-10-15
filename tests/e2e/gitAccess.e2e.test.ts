/**
 * Git access on a real Linux host (Docker container running sshd + git), driven over real ssh through
 * TargetAccessService. Covers what the Git Bash unit tests cannot: symlinks, file modes, Debian's ~/.bashrc
 * and ~/.profile, and a plain `ssh host cmd` like an agent would run. `gh` is a stub that prints the token it got.
 * Run with `npm run test:e2e`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GitTokenService } from '../../src/main/gitAccess/gitTokenService'
import { createGithubAdapter } from '../../src/main/gitAccess/providers'
import { PATH_BLOCK_BEGIN } from '../../src/main/gitAccess/scripts'
import { SecretStore, type Encryptor } from '../../src/main/gitAccess/secretStore'
import { TargetAccessService } from '../../src/main/gitAccess/targetAccessService'
import { runProcess } from '../../src/main/proc/run'
import { SshTarget } from '../../src/main/sandbox/target'
import { Store } from '../../src/main/store/store'
import { createE2eSsh, getE2eFixture, type E2eFixture } from './fixtures'

const ALIAS = 'gitaccess-box'
const OURS = '/home/dev/.config/remodeck/git-access/git-credential-remodeck'

const enc: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (blob) => Buffer.from(blob).reverse().toString('utf8')
}

// stands in for the real gh: shows which token the wrapper handed over, and answers as the git helper
// of a user logged in with `gh auth login` (password GH-LOGIN)
const FAKE_GH = [
  '#!/bin/sh',
  'case "${1:-} ${2:-}" in',
  '  "--version ") echo "gh version 2.50.0 (stub)"; exit 0 ;;',
  '  "auth git-credential") [ "${3:-}" = get ] && printf "username=gh-user\\npassword=GH-LOGIN\\n"; exit 0 ;;',
  'esac',
  'echo "token=${GH_TOKEN:-none}"',
  ''
].join('\n')
// exactly what `gh auth setup-git` writes
const GH_SETUP_GIT = `[credential "https://github.com"]\n\thelper =\n\thelper = !/usr/local/bin/gh auth git-credential\n`

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-e2e-ga-'))
let box: E2eFixture
let ssh: string
let store: Store
let svc: TargetAccessService
let hostId: string
const ids: Record<string, string> = {}

async function sx(script: string, user: 'dev' | 'root' = 'dev'): Promise<string> {
  const r = await box.exec(['bash', '-c', script], { user })
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${script}\n${r.output}`)
  return r.output
}

/** Like an agent over a plain ssh session: sshd runs `bash -c`, which on Debian reads ~/.bashrc. */
async function agent(cmd: string): Promise<string> {
  const r = await runProcess(ssh, ['-o', 'BatchMode=yes', ALIAS, cmd], { timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(`agent exit ${r.code}: ${cmd}\n${r.stderr}`)
  return r.stdout.trim()
}

async function password(repoPath: string): Promise<string> {
  const out = await sx(
    `cd ~ && printf 'protocol=https\\nhost=github.com\\npath=${repoPath}\\n\\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null || true`
  )
  return /^password=(.*)$/m.exec(out)?.[1] ?? ''
}

beforeAll(async () => {
  const home = path.join(tmp, 'home')
  ssh = createE2eSsh(home, [ALIAS])
  process.env.HOME = home
  box = getE2eFixture(ALIAS)
  await sx(`cat > /usr/local/bin/gh <<'EOF'\n${FAKE_GH}EOF\nchmod 755 /usr/local/bin/gh`, 'root')
  // a repo cloned from org A, as an agent would have it
  await sx('git init -q ~/work && git -C ~/work remote add origin https://github.com/org-a/app.git')

  const dataDir = path.join(tmp, 'data')
  store = new Store(dataDir)
  const secrets = new SecretStore(dataDir, enc)
  const adapters = [createGithubAdapter()]
  const tokens = new GitTokenService({ store, secrets, adapters })
  hostId = store.addHost(ALIAS, 'Box').id
  // stored directly: adding through GitTokenService would validate against the GitHub API
  for (const [p, value] of [
    ['org-a', 'TOKEN-A'],
    ['org-a/special', 'TOKEN-SPECIAL'],
    ['org-b', 'TOKEN-B']
  ]) {
    const t = store.upsertGitToken({
      provider: 'github',
      host: 'github.com',
      path: p,
      login: 'e2e',
      label: p,
      expiresAt: null
    })
    secrets.set(t.id, value)
    ids[p] = t.id
  }
  svc = new TargetAccessService({
    store,
    tokens,
    adapters,
    targetFor: () => new SshTarget(ALIAS, ssh)
  })
}, 900_000)

afterAll(async () => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('git access on a real Linux host', () => {
  const all = (): string[] => Object.values(ids)

  beforeEach(async () => {
    // every test starts from a clean host with Debian's own ~/.bashrc
    await svc.remove(hostId)
    await sx(
      'cp /etc/skel/.bashrc ~/.bashrc && rm -f ~/.gitconfig && git config --global user.name "AI Agent"'
    )
  })

  it('installs over ssh and git picks the token by longest prefix', async () => {
    const status = await svc.install(hostId, all())
    expect(status.helperInstalled).toBe(true)
    expect(status.includeActive).toBe(true)
    expect([...status.scopesOnTarget].sort()).toEqual([
      'github.com/org-a',
      'github.com/org-a/special',
      'github.com/org-b'
    ])
    expect(await password('org-a/app.git')).toBe('TOKEN-A')
    expect(await password('org-a/special.git')).toBe('TOKEN-SPECIAL')
    expect(await password('org-b/lib.git')).toBe('TOKEN-B')
    expect(await password('org-c/x.git')).toBe('')
  })

  it('writes token files and the root with owner-only modes', async () => {
    await svc.install(hostId, all())
    const modes = await sx(
      'cd ~/.config/remodeck/git-access && stat -c "%a %n" . tokens tokens/github.com/org-a/@token git-credential-remodeck'
    )
    expect(modes).toBe(
      '700 .\n700 tokens\n600 tokens/github.com/org-a/@token\n700 git-credential-remodeck\n'
    )
    expect(await sx('stat -c %a ~/.local/bin/gh')).toBe('755\n')
  })

  it('without the PATH block, a plain ssh command skips the wrapper; with it, gh gets the repo token', async () => {
    const before = await svc.install(hostId, all())
    expect(before.wrapper.state).toBe('ours')
    expect(before.wrapper.loginShell).toBe(true)
    expect(await agent('cd ~/work && gh')).toBe('token=none')

    const after = await svc.install(hostId, all(), { pathBlock: true })
    expect(after.pathBlock).toBe('present')
    expect(await agent('cd ~/work && gh')).toBe('token=TOKEN-A')
    expect(await agent('cd ~/work && gh -R org-b/lib')).toBe('token=TOKEN-B')
    expect(await agent('cd ~ && gh')).toBe('token=none')
    // the block sits above Debian's "If not running interactively, don't do anything" guard
    const rc = await sx('cat ~/.bashrc')
    expect(rc.startsWith(PATH_BLOCK_BEGIN)).toBe(true)
    expect(rc.indexOf(PATH_BLOCK_BEGIN)).toBeLessThan(rc.indexOf('case $- in'))
  })

  it('status sees the wrapper in non-login shells once the PATH block is in', async () => {
    const before = await svc.install(hostId, all())
    expect(before.wrapper.nonLoginShell).toBe(false)
    const after = await svc.install(hostId, all(), { pathBlock: true })
    expect(after.wrapper.nonLoginShell).toBe(true)
  })

  it('keeps the mode of ~/.bashrc and never edits a symlinked one', async () => {
    await sx('chmod 640 ~/.bashrc')
    await svc.install(hostId, all(), { pathBlock: true })
    expect(await sx('stat -c %a ~/.bashrc')).toBe('640\n')

    await svc.remove(hostId)
    await sx(
      'cp /etc/skel/.bashrc ~/dotfiles-bashrc && rm ~/.bashrc && ln -s ~/dotfiles-bashrc ~/.bashrc'
    )
    const status = await svc.install(hostId, all(), { pathBlock: true })
    expect(status.pathBlock).toBe('symlink')
    expect(await sx('cmp ~/dotfiles-bashrc /etc/skel/.bashrc && echo same')).toBe('same\n')
    expect(await sx('test -L ~/.bashrc && echo link')).toBe('link\n')
  })

  it('with gh auth setup-git, remodeck is behind until the user ticks helper-first', async () => {
    await sx(`cat >> ~/.gitconfig <<'EOF'\n${GH_SETUP_GIT}EOF`)
    const behind = await svc.install(hostId, all())
    expect(behind.otherHelpers).toEqual(['gh'])
    expect(behind.helperOrder).toBe('behind')
    expect(await password('org-a/app.git')).toBe('GH-LOGIN')

    const first = await svc.install(hostId, all(), { helperFirst: true })
    expect(first.helperOrder).toBe('first')
    expect(await password('org-a/app.git')).toBe('TOKEN-A')
    expect(await password('org-c/x.git')).toBe('GH-LOGIN')
    expect(store.config.hosts.find((h) => h.id === hostId)?.gitAccess?.helperFirst).toBe(true)
  })

  it('helper-first survives a later gh auth setup-git after one more update', async () => {
    await svc.install(hostId, all(), { helperFirst: true })
    await sx(`cat >> ~/.gitconfig <<'EOF'\n${GH_SETUP_GIT}EOF`)
    const missing = await svc.status(hostId)
    expect(missing.helperOrder).toBe('missing')
    // no option passed: the saved choice is reused
    const fixed = await svc.install(hostId, all())
    expect(fixed.helperOrder).toBe('first')
    expect(await password('org-a/app.git')).toBe('TOKEN-A')
  })

  it('remove deletes only what remodeck added', async () => {
    await sx(`cat >> ~/.gitconfig <<'EOF'\n${GH_SETUP_GIT}EOF`)
    const gitconfigBefore = await sx('cat ~/.gitconfig')
    await svc.install(hostId, all(), { pathBlock: true, helperFirst: true })
    await svc.remove(hostId)

    expect(await sx('test -e ~/.config/remodeck/git-access || echo gone')).toBe('gone\n')
    expect(await sx('test -e ~/.local/bin/gh || echo gone')).toBe('gone\n')
    expect(await sx('cmp ~/.bashrc /etc/skel/.bashrc && echo same')).toBe('same\n')
    const gitconfigAfter = await sx('cat ~/.gitconfig')
    expect(gitconfigAfter).not.toContain('remodeck')
    expect(gitconfigAfter).toContain(GH_SETUP_GIT)
    // an emptied [include] header may stay behind; everything else is as it was
    expect(gitconfigAfter.replace(/\[include\]\n/g, '')).toBe(gitconfigBefore)
    expect(await password('org-a/app.git')).toBe('GH-LOGIN')
    expect(await sx(`grep -c '${OURS}' ~/.gitconfig || true`)).toBe('0\n')
  })
})
