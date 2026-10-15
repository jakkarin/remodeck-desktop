import * as childProcess from 'node:child_process'
import * as legacyChildProcess from 'child_process'
import childProcessDefault from 'node:child_process'
import legacyChildProcessDefault from 'child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { nodePtySpawner } from '../../src/main/terminal/terminalService'

const guardRequire = createRequire(import.meta.url)
const ptyModulePath = guardRequire.resolve('node-pty')
type PtyLaunchName = 'spawn' | 'fork' | 'createTerminal' | 'open'
type GuardedPty = Record<PtyLaunchName, (...args: unknown[]) => unknown> & { native: null }

function assertPtyCacheGuard(): GuardedPty {
  const cached = guardRequire.cache[ptyModulePath]
  expect(cached).toBeDefined()
  const pty = cached!.exports as GuardedPty
  // Verify setup before any import could load the actual native module.
  for (const name of ['spawn', 'fork', 'createTerminal', 'open'] as const) {
    expect(vi.isMockFunction(pty[name])).toBe(true)
  }
  expect(pty.native).toBeNull()
  return pty
}

const writeSentinel = 'require("node:fs").writeFileSync(process.argv[1], "unsafe")'
const writeSentinelFromEnv =
  "node --eval \"require('node:fs').writeFileSync(process.env.REMODECK_HOST_GUARD_SENTINEL, 'unsafe')\""

const launches = [
  ['spawn', (marker: string) => [process.execPath, ['-e', writeSentinel, marker]]],
  ['execFile', (marker: string) => [process.execPath, ['-e', writeSentinel, marker]]],
  ['spawnSync', (marker: string) => [process.execPath, ['-e', writeSentinel, marker]]],
  ['execFileSync', (marker: string) => [process.execPath, ['-e', writeSentinel, marker]]],
  [
    'exec',
    (marker: string) => [writeSentinelFromEnv, { env: { REMODECK_HOST_GUARD_SENTINEL: marker } }]
  ],
  [
    'execSync',
    (marker: string) => [writeSentinelFromEnv, { env: { REMODECK_HOST_GUARD_SENTINEL: marker } }]
  ],
  ['fork', (marker: string) => [marker]]
] as const

describe.each([
  ['node:child_process', childProcess],
  ['child_process', legacyChildProcess],
  ['node:child_process default', childProcessDefault],
  ['child_process default', legacyChildProcessDefault]
] as const)('host process guard for %s', (_specifier, api) => {
  it.each(launches)('blocks %s before a child can write files', (name, args) => {
    const marker = join(tmpdir(), `remodeck-host-guard-${randomUUID()}`)
    const launch = api[name] as (...args: unknown[]) => unknown

    // If setup is missing, stop before even attempting a host launch.
    expect(vi.isMockFunction(launch)).toBe(true)
    expect(() => launch(...args(marker))).toThrow(
      /Host subprocesses are blocked in unit tests.*INTEGRATION_TEST_FILES/
    )
    expect(existsSync(marker)).toBe(false)
  })
})

describe.each([
  ['CommonJS', async () => guardRequire('node-pty') as GuardedPty],
  ['ESM', async () => (await import('node-pty')) as unknown as GuardedPty],
  ['ESM default', async () => (await import('node-pty')).default as unknown as GuardedPty]
] as const)('native PTY guard for %s', (_specifier, load) => {
  it.each(['spawn', 'fork', 'createTerminal', 'open'] as const)(
    'blocks %s before a native launch',
    async (name) => {
      assertPtyCacheGuard()
      const pty = await load()
      const marker = join(tmpdir(), `remodeck-host-pty-guard-${randomUUID()}`)
      const launch = pty[name]
      expect(vi.isMockFunction(launch)).toBe(true)
      expect(() =>
        name === 'open'
          ? launch({ cols: 80, rows: 24 })
          : launch(process.execPath, ['-e', writeSentinel, marker], { cols: 80, rows: 24 })
      ).toThrow(/Host subprocesses are blocked in unit tests.*INTEGRATION_TEST_FILES/)
      expect(existsSync(marker)).toBe(false)
    }
  )
})

describe('native PTY guard at the application seam', () => {
  it('blocks the production lazy node-pty require before launching a terminal', () => {
    assertPtyCacheGuard()
    const marker = join(tmpdir(), `remodeck-host-pty-guard-${randomUUID()}`)
    expect(() =>
      nodePtySpawner()(process.execPath, ['-e', writeSentinel, marker], { cols: 80, rows: 24 })
    ).toThrow(/Host subprocesses are blocked in unit tests.*INTEGRATION_TEST_FILES/)
    expect(existsSync(marker)).toBe(false)
  })

  it('keeps the CommonJS and ESM guards installed after restoring spies', async () => {
    assertPtyCacheGuard()
    vi.restoreAllMocks()
    const cached = assertPtyCacheGuard()
    const imported = (await import('node-pty')) as unknown as GuardedPty
    expect(() => cached.spawn()).toThrow(/Host subprocesses are blocked in unit tests/)
    expect(() => imported.spawn()).toThrow(/Host subprocesses are blocked in unit tests/)
  })
})
