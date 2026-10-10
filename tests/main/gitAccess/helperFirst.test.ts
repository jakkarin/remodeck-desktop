import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget } from '../../../src/main/sandbox/target'
import {
  buildInstallScript,
  buildRemoveScript,
  buildStatusScript,
  type InstallInput
} from '../../../src/main/gitAccess/scripts'
import { parseStatusOutput, type RawStatus } from '../../../src/main/gitAccess/statusParse'
import type { ProcResult } from '../../../src/main/proc/run'
import type { CliSpec } from '../../../src/main/gitAccess/providers'
import { GIT_PREFIX } from './testHelpers'

const gh: CliSpec = { command: 'gh', tokenEnv: 'GH_TOKEN', repoFlags: ['-R', '--repo'], repoEnv: 'GH_REPO' }
const base: InstallInput = {
  tokens: [{ host: 'github.com', path: 'org-a', token: 'A' }],
  providers: [{ host: 'github.com', gitUsername: 'x-access-token' }],
  wrappers: []
}
// like `gh auth setup-git`: a reset, then an inline helper; it is quoted in the file because ; starts a comment,
// so the copy remodeck makes must keep the quoting too
const FALLBACK = `"!f() { echo \\"username=fb\\"; echo \\"password=FALLBACK\\"; }; f"`
const USER_CONFIG = `[include]\n\tpath = ~/other.gitconfig\n[user]\n\tname = me\n[credential "https://github.com"]\n\thelper =\n\thelper = ${FALLBACK}\n`

describe('remodeck helper asked first', () => {
  let home: string
  let t: LocalTarget
  // On Windows, native git cannot open the /tmp-style HOME of Git Bash, so HOME becomes C:/...; no-op on Linux.
  const run = (script: string): Promise<ProcResult> =>
    t.exec(
      GIT_PREFIX +
        'if command -v cygpath >/dev/null 2>&1; then HOME=$(cygpath -m "$HOME"); export HOME MSYS_NO_PATHCONV=1; fi\ncd "$HOME"\n' +
        script
    )
  const password = async (path: string): Promise<string> => {
    const r = await run(`printf 'protocol=https\\nhost=github.com\\npath=${path}\\n\\n' | git credential fill`)
    return /^password=(.*)$/m.exec(r.stdout)?.[1] ?? ''
  }
  const status = async (): Promise<RawStatus> =>
    parseStatusOutput((await run(buildStatusScript([gh], ['github.com']))).stdout)
  const gitconfig = async (): Promise<string> => (await run('cat "$HOME/.gitconfig"')).stdout

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-hf-')).replaceAll('\\', '/')
    t = new LocalTarget(home)
    await run(`cat > "$HOME/.gitconfig" <<'EOF'\n${USER_CONFIG}EOF`)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('without the option, an include line added to an [include] above the reset is wiped: missing', async () => {
    expect((await run(buildInstallScript(base))).code).toBe(0)
    expect(await password('org-a/r.git')).toBe('FALLBACK')
    expect((await status()).helperOrder).toBe('missing')
  })

  it('without the option, an include after the other helper is asked second: behind', async () => {
    await run(`cat > "$HOME/.gitconfig" <<'EOF'\n${USER_CONFIG.slice(USER_CONFIG.indexOf('[user]'))}EOF`)
    expect((await run(buildInstallScript(base))).code).toBe(0)
    expect(await password('org-a/r.git')).toBe('FALLBACK')
    expect((await status()).helperOrder).toBe('behind')
  })

  it('asks remodeck first and keeps the other helper as fallback', async () => {
    const r = await run(buildInstallScript({ ...base, helperFirst: true }))
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect(await password('org-a/r.git')).toBe('A')
    expect(await password('org-b/r.git')).toBe('FALLBACK')
    expect((await status()).helperOrder).toBe('first')
  })

  it('puts the include in its own section at the end and leaves the rest of the file as it was', async () => {
    await run(buildInstallScript({ ...base, helperFirst: true }))
    const text = await gitconfig()
    expect(text.startsWith(USER_CONFIG)).toBe(true)
    expect(text.slice(USER_CONFIG.length)).toMatch(/^\[include\]\n\tpath = .*\/\.config\/remodeck\/git-access\/gitconfig\n$/)
  })

  it('does not copy its own helper or pile up fallbacks across installs', async () => {
    await run(buildInstallScript({ ...base, helperFirst: true }))
    await run(buildInstallScript({ ...base, helperFirst: true }))
    const ours = (await run('cat "$HOME/.config/remodeck/git-access/gitconfig"')).stdout
    expect(ours.split('password=FALLBACK').length - 1).toBe(1)
    expect(ours.split('git-credential-remodeck').length - 1).toBe(1)
    expect((await gitconfig()).split('remodeck/git-access/gitconfig').length - 1).toBe(1)
  })

  it('reports missing after a later reset, and an update fixes it', async () => {
    await run(buildInstallScript({ ...base, helperFirst: true }))
    await run(`printf '[credential "https://github.com"]\\n\\thelper =\\n\\thelper = !true\\n' >> "$HOME/.gitconfig"`)
    expect((await status()).helperOrder).toBe('missing')
    await run(buildInstallScript({ ...base, helperFirst: true }))
    expect((await status()).helperOrder).toBe('first')
    expect(await password('org-a/r.git')).toBe('A')
  })

  it('status is none when nothing is installed', async () => {
    expect((await status()).helperOrder).toBe('none')
  })

  it('remove leaves the user helper config in place', async () => {
    await run(buildInstallScript({ ...base, helperFirst: true }))
    expect((await run(buildRemoveScript([gh]))).code).toBe(0)
    const text = await gitconfig()
    expect(text).not.toContain('remodeck')
    expect(text).toContain(USER_CONFIG.split('[credential')[1])
    expect(await password('org-a/r.git')).toBe('FALLBACK')
  })
})
