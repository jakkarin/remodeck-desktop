import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget } from '../../../src/main/sandbox/target'
import {
  PATH_BLOCK_BEGIN,
  PATH_BLOCK_END,
  buildInstallScript,
  buildRemoveScript,
  buildStatusScript,
  type InstallInput
} from '../../../src/main/gitAccess/scripts'
import { parseStatusOutput, type RawStatus } from '../../../src/main/gitAccess/statusParse'
import type { ProcResult } from '../../../src/main/proc/run'
import type { CliSpec } from '../../../src/main/gitAccess/providers'
import { GIT_PREFIX } from './testHelpers'

const gh: CliSpec = {
  command: 'gh',
  tokenEnv: 'GH_TOKEN',
  repoFlags: ['-R', '--repo'],
  repoEnv: 'GH_REPO'
}
const base: InstallInput = {
  tokens: [{ host: 'github.com', path: 'org-a', token: 'A' }],
  providers: [{ host: 'github.com', gitUsername: 'x-access-token' }],
  wrappers: [{ cli: gh, defaultHost: 'github.com' }]
}
const UBUNTU_RC =
  '# ~/.bashrc\ncase $- in\n    *i*) ;;\n      *) return;;\nesac\nalias ll="ls -l"\n'

describe('PATH block in ~/.bashrc', () => {
  let home: string
  let t: LocalTarget
  const run = (script: string): Promise<ProcResult> =>
    t.exec(GIT_PREFIX + 'export MSYS_NO_PATHCONV=1\n' + script)
  const rc = async (): Promise<string> => (await run('cat "$HOME/.bashrc"')).stdout
  const writeRc = (text: string): Promise<ProcResult> =>
    run(`cat > "$HOME/.bashrc" <<'EOF'\n${text}EOF`)

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-p-')).replaceAll('\\', '/')
    t = new LocalTarget(home)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('leaves ~/.bashrc alone when not asked', async () => {
    await writeRc(UBUNTU_RC)
    const r = await run(buildInstallScript(base))
    expect(r.code).toBe(0)
    expect(r.stdout).not.toMatch(/path_block=/)
    expect(await rc()).toBe(UBUNTU_RC)
  })

  it('puts the block at the very top, before the non-interactive guard, and keeps the rest byte-for-byte', async () => {
    await writeRc(UBUNTU_RC)
    const r = await run(buildInstallScript({ ...base, pathBlock: true }))
    expect(r.stderr).toBe('')
    expect(r.stdout).toMatch(/^path_block=added$/m)
    const text = await rc()
    expect(text.startsWith(PATH_BLOCK_BEGIN + '\n')).toBe(true)
    expect(text.endsWith(PATH_BLOCK_END + '\n' + UBUNTU_RC)).toBe(true)
    expect(text.indexOf(PATH_BLOCK_END)).toBeLessThan(text.indexOf('case $- in'))
  })

  it('makes a non-interactive bash that sources ~/.bashrc find ~/.local/bin first, without duplicating it', async () => {
    await writeRc(UBUNTU_RC)
    await run(buildInstallScript({ ...base, pathBlock: true }))
    const first = await run(
      '. "$HOME/.bashrc"; case "$PATH" in "$HOME/.local/bin:"*) echo first ;; esac'
    )
    expect(first.stdout.trim()).toBe('first')
    const twice = await run(
      '. "$HOME/.bashrc"; . "$HOME/.bashrc"; printf %s "$PATH" | tr : "\\n" | grep -Fxc "$HOME/.local/bin"'
    )
    expect(twice.stdout.trim()).toBe('1')
  })

  it('is idempotent across installs', async () => {
    await writeRc(UBUNTU_RC)
    await run(buildInstallScript({ ...base, pathBlock: true }))
    const r = await run(buildInstallScript({ ...base, pathBlock: true }))
    expect(r.stdout).toMatch(/^path_block=present$/m)
    expect((await rc()).split(PATH_BLOCK_BEGIN).length - 1).toBe(1)
  })

  it('creates ~/.bashrc when there is none', async () => {
    const r = await run(buildInstallScript({ ...base, pathBlock: true }))
    expect(r.stdout).toMatch(/^path_block=added$/m)
    expect((await rc()).startsWith(PATH_BLOCK_BEGIN)).toBe(true)
  })

  it('never edits a symlinked ~/.bashrc', async () => {
    await run(`printf 'real\\n' > "$HOME/dot-bashrc" && ln -s "$HOME/dot-bashrc" "$HOME/.bashrc"`)
    const isLink = (await run('[ -L "$HOME/.bashrc" ] && echo yes')).stdout.trim() === 'yes'
    if (!isLink) return // MSYS ln -s copies instead of linking; covered on Linux
    const r = await run(buildInstallScript({ ...base, pathBlock: true }))
    expect(r.stdout).toMatch(/^path_block=symlink$/m)
    expect((await run('cat "$HOME/dot-bashrc"')).stdout).toBe('real\n')
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the file mode of an existing ~/.bashrc',
    async () => {
      await writeRc(UBUNTU_RC)
      await run('chmod 640 "$HOME/.bashrc"')
      await run(buildInstallScript({ ...base, pathBlock: true }))
      expect((await run('stat -c %a "$HOME/.bashrc"')).stdout.trim()).toBe('640')
    }
  )

  it('status reports the block', async () => {
    const status = async (): Promise<RawStatus> =>
      parseStatusOutput((await run(buildStatusScript([gh], ['github.com']))).stdout)
    expect((await status()).pathBlock).toBe('absent')
    await writeRc(UBUNTU_RC)
    await run(buildInstallScript({ ...base, pathBlock: true }))
    expect((await status()).pathBlock).toBe('present')
  })

  it('remove deletes only our block and restores the original file', async () => {
    await writeRc(UBUNTU_RC)
    await run(buildInstallScript({ ...base, pathBlock: true }))
    const r = await run(buildRemoveScript([gh]))
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^path_block=removed$/m)
    expect(await rc()).toBe(UBUNTU_RC)
  })

  it('remove leaves ~/.bashrc untouched when the end marker is missing', async () => {
    const broken = `${PATH_BLOCK_BEGIN}\nexport PATH="$HOME/.local/bin:$PATH"\n${UBUNTU_RC}`
    await writeRc(broken)
    const r = await run(buildRemoveScript([gh]))
    expect(r.code).toBe(0)
    expect(r.stdout).not.toMatch(/path_block=removed/)
    expect(await rc()).toBe(broken)
  })
})
