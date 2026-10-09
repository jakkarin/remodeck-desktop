import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { ROOT, buildInstallScript, buildRemoveScript, buildStatusScript } from '../../../src/main/gitAccess/scripts'
import { parseStatusOutput } from '../../../src/main/gitAccess/statusParse'
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
const statusScript = buildStatusScript([gh], ['github.com'])
const removeScript = buildRemoveScript([gh])
const FAKE_GH = `#!/bin/sh\necho "gh version 2.62.0 (2024-11-14)"\n`

describe('status and remove scripts', () => {
  let home: string
  let t: LocalTarget
  // MSYS would rewrite the /tmp-style HOME in git's argv to C:/..., so the stored include path would not match; no-op on Linux.
  const run = (script: string) => t.exec(GIT_PREFIX + 'export MSYS_NO_PATHCONV=1\n' + script)
  const status = async () => parseStatusOutput((await run(statusScript)).stdout)
  const withFakeGh = () =>
    run(`mkdir -p "$HOME/fakebin" && cat > "$HOME/fakebin/gh" <<'EOF'\n${FAKE_GH}EOF\nchmod 755 "$HOME/fakebin/gh"`)

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-s-')).replaceAll('\\', '/')
    t = new LocalTarget(home)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('reports nothing on a clean host', async () => {
    const r = await run(statusScript)
    expect(r.code).toBe(0)
    expect(parseStatusOutput(r.stdout)).toMatchObject({
      helper: false,
      include: false,
      scopes: [],
      wrapper: { state: 'none', version: null },
      otherHelpers: []
    })
  })

  it('reports an installed host, the real CLI and its version', async () => {
    await withFakeGh()
    expect((await run(installScript)).stderr).toBe('')
    const r = await run('export PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"\n' + statusScript)
    expect(r.stderr).toBe('')
    const raw = parseStatusOutput(r.stdout)
    expect(raw).toMatchObject({
      helper: true,
      include: true,
      wrapper: { state: 'ours', version: 1 },
      cliVersion: '2.62.0'
    })
    expect(raw.scopes.sort()).toEqual(['github.com/org-a', 'github.com/org-a/payments', 'github.com/org-b'])
    expect(raw.cliPath).toMatch(/\/fakebin\/gh$/)
    expect(raw.otherHelpers).toEqual([])
  })

  it('reports a foreign wrapper and an unrelated cli_path', async () => {
    await withFakeGh()
    await run('mkdir -p "$HOME/.local/bin" && printf \'#!/bin/sh\\n# mine\\n\' > "$HOME/.local/bin/gh"; chmod 755 "$HOME/.local/bin/gh"')
    const raw = parseStatusOutput((await run('export PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"\n' + statusScript)).stdout)
    expect(raw.wrapper).toEqual({ state: 'foreign', version: null })
    expect(raw.cliPath).toMatch(/\/fakebin\/gh$/)
  })

  it('reports where gh resolves in a non-login shell', async () => {
    await withFakeGh()
    await run(installScript)
    const raw = parseStatusOutput((await run('export PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"\n' + statusScript)).stdout)
    expect(raw.nonLoginResolves).toMatch(/\/\.local\/bin\/gh$/)
  })

  it('lists credential helpers that are not ours', async () => {
    await run(installScript)
    await run('git config --global credential.helper store\ngit config --global credential.https://github.com.helper cache')
    const raw = await status()
    expect(raw.otherHelpers.sort()).toEqual(['cache', 'store'])
  })

  it('is read-only: the files under HOME and their contents are unchanged', async () => {
    await withFakeGh()
    await run(installScript)
    await run('git config --global credential.helper store')
    const snap = () =>
      run('cd "$HOME" && find . -type f | sort | while IFS= read -r f; do cksum "$f"; done').then((r) => r.stdout)
    const before = await snap()
    expect(before).toContain('@token')
    const r = await run('export PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"\n' + statusScript)
    expect(r.code).toBe(0)
    expect(await snap()).toBe(before)
  })

  describe('remove', () => {
    it('deletes the include, root and our wrapper, and survives a second run', async () => {
      await run(installScript)
      await run('git config --global user.name keepme')
      const r = await run(removeScript)
      expect(r.code).toBe(0)
      expect(r.stderr).toBe('')
      expect((await run(`test -e "${ROOT}"`)).code).not.toBe(0)
      expect((await run('test -e "$HOME/.local/bin/gh"')).code).not.toBe(0)
      expect((await run('git config --global --get-all include.path')).stdout.trim()).toBe('')
      expect((await run('git config --global user.name')).stdout.trim()).toBe('keepme')
      const again = await run(removeScript)
      expect(again.code).toBe(0)
      expect(again.stderr).toBe('')
    })

    it('exits 0 when nothing is installed', async () => {
      const r = await run(removeScript)
      expect(r.code).toBe(0)
      expect(r.stderr).toBe('')
    })

    it('leaves a foreign wrapper, other includes and other remodeck data alone', async () => {
      await run(installScript)
      await run(
        'printf \'#!/bin/sh\\n# mine\\n\' > "$HOME/.local/bin/gh"\n' +
          'git config --global --add include.path "$HOME/other.gitconfig"\n' +
          'mkdir -p "$HOME/.config/remodeck/other" && echo x > "$HOME/.config/remodeck/other/f"'
      )
      const r = await run(removeScript)
      expect(r.code).toBe(0)
      expect((await run('cat "$HOME/.local/bin/gh"')).stdout).toBe('#!/bin/sh\n# mine\n')
      expect((await run('cat "$HOME/.config/remodeck/other/f"')).stdout).toBe('x\n')
      const inc = (await run('git config --global --get-all include.path')).stdout.trim()
      expect(inc).toMatch(/\/other\.gitconfig$/)
      expect(inc).not.toContain('git-access')
      expect((await run(`test -e "${ROOT}"`)).code).not.toBe(0)
    })

    it('falls back to the escaped regex when git has no --fixed-value (exit 129)', async () => {
      await run(installScript)
      await run('git config --global --add include.path "$HOME/other.gitconfig"')
      const oldGit = 'git() { case " $* " in *" --fixed-value "*) return 129 ;; esac; command git "$@"; }\n'
      const r = await run(oldGit + removeScript)
      expect(r.code).toBe(0)
      const inc = (await run('git config --global --get-all include.path')).stdout.trim()
      expect(inc).toMatch(/\/other\.gitconfig$/)
      expect(inc).not.toContain('git-access')
    })

    it('does not follow a symlinked wrapper', async () => {
      await run(installScript)
      await run('mv "$HOME/.local/bin/gh" "$HOME/real-gh" && ln -s "$HOME/real-gh" "$HOME/.local/bin/gh"')
      // MSYS on Windows makes a copy instead of a link; nothing to verify there
      if ((await run('test -L "$HOME/.local/bin/gh"')).code !== 0) return
      await run(removeScript)
      expect((await run('test -f "$HOME/real-gh"')).code).toBe(0)
      expect((await run('test -L "$HOME/.local/bin/gh"')).code).toBe(0)
    })
  })
})
