/**
 * End-to-end against real Linux sandboxes (Docker containers running sshd + git).
 * Drives the main-process API from createApp exactly as the renderer would; a local
 * `git http-backend` stands in for GitHub. Run with `npm run test:e2e`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/main/app'
import { IPC_CHANNELS, type MainApi } from '../../src/shared/ipc'
import type { ApprovalRequest, Host, Workspace } from '../../src/shared/types'
import { startHttpBackend } from '../helpers/httpBackend'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show(): void {
      // The test notification has no UI.
    }
  },
  shell: { openExternal: async () => undefined }
}))

const EV = IPC_CHANNELS.events
const IMAGE = 'remodeck-e2e-sandbox:latest'
const SECRET = 'e2e-secret-github-token'
// Git for Windows' ssh honours $HOME, so a throwaway ~/.ssh/config can define the sandbox aliases.
const GIT_BIN = 'C:/Program Files/Git/usr/bin'
const SSH = process.platform === 'win32' ? `${GIT_BIN}/ssh.exe` : 'ssh'
const SSH_KEYGEN = process.platform === 'win32' ? `${GIT_BIN}/ssh-keygen.exe` : 'ssh-keygen'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-e2e-'))
const slash = (p: string): string => p.replaceAll('\\', '/')

function hg(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function sx(c: StartedTestContainer, script: string, user = 'dev'): Promise<string> {
  const r = await c.exec(['bash', '-lc', script], { user })
  if (r.exitCode !== 0) throw new Error(`sandbox exit ${r.exitCode}: ${script}\n${r.output}`)
  return r.output.trim()
}

async function waitFor<T>(
  what: string,
  fn: () => T | undefined | false,
  timeoutMs = 60_000,
  dump?: () => string
): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${dump ? `\n--- output ---\n${dump()}` : ''}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

let api: MainApi
let dispose: () => Promise<void>
let backend: Awaited<ReturnType<typeof startHttpBackend>>
let c1: StartedTestContainer
let c2: StartedTestContainer
let cNoGit: StartedTestContainer
const events: { channel: string; args: unknown[] }[] = []
const upstream = path.join(tmp, 'gh', 'acme', 'widget.git')
const seed = path.join(tmp, 'seed')
const dataDir = path.join(tmp, 'data')
const mirror = path.join(dataDir, 'mirrors', 'acme', 'widget.git')

const startSandbox = (
  pubKey: string,
  env: Record<string, string> = {}
): Promise<StartedTestContainer> =>
  new GenericContainer(IMAGE)
    .withEnvironment({ AUTHORIZED_KEY: pubKey, ...env })
    .withExposedPorts(22)
    .withWaitStrategy(Wait.forLogMessage(/Server listening on 0\.0\.0\.0/))
    .start()

beforeAll(async () => {
  // Isolate host git and ssh from the developer's real config and credentials.
  const home = path.join(tmp, 'home')
  fs.mkdirSync(path.join(home, '.ssh'), { recursive: true })
  const gitconfig = path.join(tmp, 'gitconfig')
  fs.writeFileSync(
    gitconfig,
    [
      '[user]',
      '  name = Host User',
      '  email = host@example.invalid',
      '[init]',
      '  defaultBranch = main',
      '[credential]',
      '  helper =',
      `  helper = "!f() { test \\"$1\\" = get && echo username=x-access-token && echo password=${SECRET}; }; f"`,
      ''
    ].join('\n')
  )
  Object.assign(process.env, {
    HOME: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1'
  })

  const key = path.join(home, '.ssh', 'id_e2e')
  execFileSync(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', key])
  const pub = fs.readFileSync(`${key}.pub`, 'utf8').trim()

  await GenericContainer.fromDockerfile(path.resolve('tests/e2e/sandbox')).build(IMAGE, {
    deleteOnExit: false
  })
  ;[c1, c2, cNoGit] = await Promise.all([
    startSandbox(pub),
    startSandbox(pub),
    startSandbox(pub, { HIDE_GIT: '1' })
  ])

  const alias = (name: string, c: StartedTestContainer): string =>
    [
      `Host ${name}`,
      '  HostName 127.0.0.1',
      `  Port ${c.getMappedPort(22)}`,
      '  User dev',
      `  IdentityFile ${slash(key)}`,
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking no',
      '  UserKnownHostsFile /dev/null',
      '  LogLevel ERROR',
      ''
    ].join('\n')
  fs.writeFileSync(
    path.join(home, '.ssh', 'config'),
    alias('sandbox-1', c1) + alias('sandbox-2', c2) + alias('sandbox-nogit', cNoGit)
  )

  // "GitHub": acme/widget with one commit on main.
  fs.mkdirSync(upstream, { recursive: true })
  hg(upstream, 'init', '-q', '--bare')
  hg(upstream, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  fs.mkdirSync(seed)
  hg(seed, 'init', '-q')
  hg(seed, 'remote', 'add', 'origin', upstream)
  fs.writeFileSync(path.join(seed, 'README.md'), '# widget\n')
  hg(seed, 'add', '.')
  hg(seed, 'commit', '-qm', 'initial')
  hg(seed, 'push', '-q', 'origin', 'main')
  backend = await startHttpBackend(path.join(tmp, 'gh'))

  const win = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => undefined,
    show: () => undefined,
    focus: () => undefined,
    webContents: { send: (channel: string, ...args: unknown[]) => events.push({ channel, args }) }
  }
  const app = await createApp({
    dataDir,
    window: () => win as never,
    sshPath: SSH,
    githubBase: backend.url
  })
  api = app.api
  dispose = app.dispose
})

afterAll(async () => {
  await dispose?.()
  await backend?.close()
  await Promise.all([c1, c2, cNoGit].map((c) => c?.stop()))
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

describe('remodeck against real sandboxes', () => {
  let h1: Host
  let h2: Host
  let ws1: Workspace
  let ws2: Workspace

  it('connects to a sandbox and probes git', async () => {
    h1 = await api.hosts.add('sandbox-1', 'Sandbox 1')
    const st = await api.hosts.connect(h1.id)
    expect(st.state).toBe('connected')
    expect((await api.hosts.probeGit(h1.id))?.version).toMatch(/^git version /)
  })

  it('a sandbox without git connects; probeGit is null until git is installed and forced', async () => {
    const h = await api.hosts.add('sandbox-nogit', 'No git')
    const st = await api.hosts.connect(h.id)
    expect(st.state).toBe('connected')
    expect(await api.hosts.probeGit(h.id)).toBeNull()
    await sx(cNoGit, 'mv /opt/git-hidden /usr/bin/git', 'root')
    expect((await api.hosts.probeGit(h.id, true))?.version).toMatch(/^git version /)
  })

  it('clone puts the default branch in the sandbox with a GitHub origin', async () => {
    ws1 = await api.workspaces.clone(h1.id, 'acme/widget', '~/work/widget')
    const out = await sx(
      c1,
      'cd ~/work/widget && git rev-parse --abbrev-ref HEAD && git remote get-url origin && cat README.md && git rev-parse HEAD'
    )
    expect(out.split('\n')).toEqual([
      'main',
      'https://github.com/acme/widget.git',
      '# widget',
      hg(upstream, 'rev-parse', 'main')
    ])
  })

  it('refuses to clone into a non-empty path and leaves it untouched', async () => {
    await sx(c1, 'mkdir -p ~/busy && echo keep > ~/busy/file')
    await expect(api.workspaces.clone(h1.id, 'acme/widget', '~/busy')).rejects.toThrow(/not empty/)
    expect(await sx(c1, 'ls -A ~/busy && cat ~/busy/file')).toBe('file\nkeep')
  })

  it('sync brings AI branches into review; AI tags stay out of the mirror', async () => {
    await sx(
      c1,
      'cd ~/work/widget && git checkout -q -b feat-a && echo a > a.txt && git add a.txt && git commit -qm "add a" && git tag ai-tag'
    )
    await api.workspaces.sync(ws1.id)
    const feat = (await api.workspaces.branches(ws1.id)).find((b) => b.name === 'feat-a')
    expect(feat).toMatchObject({ base: 'origin/main', ahead: 1, behind: 0, rewritten: false })
    expect((await api.workspaces.commits(ws1.id, 'feat-a')).map((c) => c.subject)).toEqual([
      'add a'
    ])
    expect(await api.workspaces.diff(ws1.id, 'feat-a')).toContain('a.txt')
    expect(hg(mirror, 'tag', '-l')).not.toContain('ai-tag')
  })

  it('review push publishes the branch to GitHub, without tags', async () => {
    expect(await api.workspaces.push(ws1.id, 'feat-a', 'feat-a')).toEqual({ ok: true })
    const sandboxSha = await sx(c1, 'git -C ~/work/widget rev-parse feat-a')
    expect(hg(upstream, 'rev-parse', 'refs/heads/feat-a')).toBe(sandboxSha)
    expect(hg(upstream, 'tag', '-l')).toBe('')
    expect((await api.pushLog.read(1))[0]).toMatchObject({ channel: 'review', result: 'ok' })
  })

  it('review push to a protected branch is blocked', async () => {
    const before = hg(upstream, 'rev-parse', 'main')
    expect(await api.workspaces.push(ws1.id, 'feat-a', 'main')).toMatchObject({
      ok: false,
      reason: 'protected'
    })
    expect(hg(upstream, 'rev-parse', 'main')).toBe(before)
  })

  it('GitHub changes reach the sandbox as origin/* only; local branches and work are untouched', async () => {
    const localMain = await sx(c1, 'git -C ~/work/widget rev-parse main')
    await sx(c1, 'echo wip > ~/work/widget/wip.txt')
    fs.writeFileSync(path.join(seed, 'CHANGELOG.md'), 'v2\n')
    hg(seed, 'add', '.')
    hg(seed, 'commit', '-qm', 'upstream change')
    hg(seed, 'push', '-q', 'origin', 'main')
    await api.workspaces.sync(ws1.id)
    const out = await sx(
      c1,
      'cd ~/work/widget && git rev-parse origin/main main && git rev-parse --abbrev-ref HEAD && cat wip.txt'
    )
    expect(out.split('\n')).toEqual([hg(upstream, 'rev-parse', 'main'), localMain, 'feat-a', 'wip'])
    await sx(c1, 'rm ~/work/widget/wip.txt')
  })

  it('a history rewrite in the sandbox is flagged', async () => {
    await sx(c1, 'cd ~/work/widget && git commit -q --amend -m "add a (amended)"')
    expect((await api.workspaces.sync(ws1.id)).rewritten).toEqual(['feat-a'])
    expect(
      (await api.workspaces.branches(ws1.id)).find((b) => b.name === 'feat-a')?.rewritten
    ).toBe(true)
  })

  it('lists worktrees the AI creates', async () => {
    await sx(c1, 'cd ~/work/widget && git worktree add -q ../widget-wt -b wt-branch')
    const wts = await api.workspaces.worktrees(ws1.id)
    expect(wts.map((w) => [w.path, w.branch])).toEqual([
      ['/home/dev/work/widget', 'feat-a'],
      ['/home/dev/work/widget-wt', 'wt-branch']
    ])
  })

  it('two sandboxes on one repo: same branch name stays separate; a non-fast-forward push is refused', async () => {
    h2 = await api.hosts.add('sandbox-2', 'Sandbox 2')
    expect((await api.hosts.connect(h2.id)).state).toBe('connected')
    ws2 = await api.workspaces.clone(h2.id, 'acme/widget', '~/widget')
    await sx(
      c2,
      'cd ~/widget && git checkout -q -b feat-a && echo other > other.txt && git add . && git commit -qm "other a"'
    )
    await api.workspaces.sync(ws2.id)
    const sha1 = (await api.workspaces.branches(ws1.id)).find((b) => b.name === 'feat-a')?.sha
    const sha2 = (await api.workspaces.branches(ws2.id)).find((b) => b.name === 'feat-a')?.sha
    expect(sha2).toBe(await sx(c2, 'git -C ~/widget rev-parse feat-a'))
    expect(sha1).not.toBe(sha2)
    const githubFeatA = hg(upstream, 'rev-parse', 'refs/heads/feat-a')
    expect(await api.workspaces.push(ws2.id, 'feat-a', 'feat-a')).toMatchObject({
      ok: false,
      reason: 'non-fast-forward'
    })
    expect(hg(upstream, 'rev-parse', 'refs/heads/feat-a')).toBe(githubFeatA)
    expect(await api.workspaces.push(ws2.id, 'feat-a', 'feat-a-2')).toEqual({ ok: true })
    expect(hg(upstream, 'rev-parse', 'refs/heads/feat-a-2')).toBe(sha2)
  })

  it('adds an existing sandbox repo without touching its HEAD, working tree or config', async () => {
    // A repo that already lives in the sandbox: its origin points at GitHub, plus a VM-only branch and a dirty tree.
    await sx(
      c1,
      'git clone -q ~/work/widget ~/existing && cd ~/existing && git remote set-url origin https://github.com/acme/widget.git && ' +
        'git checkout -q -b vm-only && echo v > v.txt && git add v.txt && git commit -qm "vm only" && echo dirty >> README.md && echo u > untracked.txt'
    )
    const probe = (): Promise<string> =>
      sx(
        c1,
        'cd ~/existing && git rev-parse HEAD && git symbolic-ref HEAD && git status --porcelain && cat .git/config && git for-each-ref refs/heads'
      )
    const before = await probe()

    const info = await api.workspaces.inspectExisting(h1.id, '~/existing')
    expect(info).toMatchObject({ owner: 'acme', name: 'widget' })
    const expected = { owner: info.owner, name: info.name }
    const ws = await api.workspaces.addExisting(h1.id, '~/existing', expected)
    expect(ws).toMatchObject({ hostId: h1.id, sandboxPath: '~/existing' })
    await expect(api.workspaces.addExisting(h1.id, '~/existing', expected)).rejects.toThrow(
      /This workspace already exists/
    )

    expect((await api.workspaces.branches(ws.id)).map((b) => b.name)).toContain('vm-only')
    await api.workspaces.sync(ws.id)
    expect((await api.workspaces.commits(ws.id, 'vm-only')).map((c) => c.subject)).toContain(
      'vm only'
    )
    expect(await probe()).toBe(before)
    expect(before).toContain('M README.md')
  })

  describe('integrated terminal', () => {
    let tabId: string
    let approvalsSeen = 0
    const output = (): string =>
      events
        .filter((e) => e.channel === EV['terminal-data'] && e.args[0] === tabId)
        .map((e) => e.args[1] as string)
        .join('')
    const approvals = (): ApprovalRequest[] =>
      events
        .filter((e) => e.channel === EV['approval-request'])
        .map((e) => e.args[0] as ApprovalRequest)
    let marker = 0
    /** Types a command into the tab; resolves with its exit code. */
    const run = async (
      cmd: string,
      onApproval?: (req: ApprovalRequest) => void
    ): Promise<number> => {
      const m = `__RX${++marker}_`
      api.terminal.write(tabId, `${cmd}; echo ${m}$?__\r`)
      if (onApproval) {
        const req = await waitFor(
          'approval popup',
          () => approvals()[approvalsSeen],
          60_000,
          output
        )
        approvalsSeen++
        onApproval(req)
      }
      const re = new RegExp(`${m}(\\d+)__`)
      const hit = await waitFor(`exit code of: ${cmd}`, () => re.exec(output()), 60_000, output)
      return Number(hit[1])
    }

    it('opens a shell in the workspace path', async () => {
      ;({ tabId } = await api.terminal.open(ws1.id))
      api.terminal.resize(tabId, 200, 50)
      expect(await run('test "$PWD" = "$HOME/work/widget"')).toBe(0)
    })

    it('pull/fetch works through the bridge without a popup', async () => {
      expect(await run('git fetch -q origin && git rev-parse origin/main > /tmp/fetched')).toBe(0)
      expect(await sx(c1, 'cat /tmp/fetched')).toBe(hg(upstream, 'rev-parse', 'main'))
      expect(approvals()).toHaveLength(0)
    })

    it('push asks for approval on the desktop; Allow once publishes it', async () => {
      const cmd =
        'git checkout -q -b feat-b && echo b > b.txt && git add b.txt && git commit -qm b && git push -q origin feat-b'
      let req: ApprovalRequest | undefined
      const code = await run(cmd, (r) => {
        req = r
        api.approval.respond(r.id, 'once')
      })
      expect(code).toBe(0)
      expect(req?.updates.map((u) => u.ref)).toEqual(['refs/heads/feat-b'])
      expect(hg(upstream, 'rev-parse', 'refs/heads/feat-b')).toBe(
        await sx(c1, 'git -C ~/work/widget rev-parse feat-b')
      )
    })

    it('Deny rejects the push and GitHub is unchanged', async () => {
      const before = hg(upstream, 'rev-parse', 'refs/heads/feat-b')
      const code = await run(
        'echo c > c.txt && git add c.txt && git commit -qm c && git push -q origin feat-b',
        (r) => api.approval.respond(r.id, 'deny')
      )
      expect(code).not.toBe(0)
      expect(hg(upstream, 'rev-parse', 'refs/heads/feat-b')).toBe(before)
      expect((await api.pushLog.read(1))[0]).toMatchObject({ channel: 'bridge', result: 'denied' })
    })

    it('pushing to a protected branch is blocked without a popup', async () => {
      const before = hg(upstream, 'rev-parse', 'main')
      const seen = approvals().length
      // A fast-forward of main, so git itself sends it (a non-ff would be refused client-side).
      const cmd =
        'git checkout -q -b to-main origin/main && echo m > m.txt && git add m.txt && git commit -qm m && git push -q origin to-main:main'
      expect(await run(cmd)).not.toBe(0)
      expect(approvals()).toHaveLength(seen)
      expect(hg(upstream, 'rev-parse', 'main')).toBe(before)
      expect((await api.pushLog.read(1))[0]).toMatchObject({ channel: 'bridge', result: 'blocked' })
    })

    it('the GitHub credential reaches GitHub but never the sandbox', async () => {
      const basic = 'Basic ' + Buffer.from(`x-access-token:${SECRET}`).toString('base64')
      expect(backend.requests.some((r) => r.authorization === basic)).toBe(true)
      expect(await sx(c1, `grep -rIl ${SECRET} ~ /tmp 2>/dev/null || true`)).toBe('')
    })

    it('a sandbox session not opened by the app has no route to GitHub', async () => {
      const out = await sx(
        c1,
        'cd ~/work/widget && { git config --get-regexp "^url\\." || true; env | grep GIT_CONFIG || true; }'
      )
      expect(out).toBe('')
    })

    it('an AI commit in the terminal appears after the idle light sync, without contacting GitHub', async () => {
      api.workspaces.setActive(ws1.id)
      const lightEvents = (): number =>
        events.filter(
          (e) =>
            e.channel === EV['workspace-synced'] &&
            e.args[0] === ws1.id &&
            (e.args[1] as { kind: string }).kind === 'light'
        ).length
      const seen = lightEvents()
      const requestsBefore = backend.requests.length
      const code = await run(
        'git checkout -q -b feat-light origin/main && printf "one\\ntwo\\n" > light.txt && git add light.txt && git commit -qm light'
      )
      expect(code).toBe(0)
      await waitFor('light workspace-synced event', () => lightEvents() > seen, 10_000, output)
      expect(backend.requests.length).toBe(requestsBefore)
      expect((await api.workspaces.branches(ws1.id)).map((b) => b.name)).toContain('feat-light')
    })

    it('files and per-file diff of the committed branch are available', async () => {
      const files = await api.workspaces.files(ws1.id, 'feat-light')
      expect(files).toEqual([{ path: 'light.txt', status: 'A', additions: 2, deletions: 0 }])
      const diff = await api.workspaces.diff(ws1.id, 'feat-light', { file: 'light.txt' })
      expect(diff).toContain('+two')
      expect(diff).not.toContain('README.md')
    })

    it('Disconnect closes the tab', async () => {
      api.hosts.disconnect(h1.id)
      await waitFor('terminal exit', () =>
        events.some(
          (e) => e.channel === EV['terminal-exit'] && e.args[0] === tabId && e.args[1] === -1
        )
      )
    })
  })
})
