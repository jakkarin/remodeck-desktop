import Module, { createRequire } from 'node:module'
import { vi } from 'vitest'

const hostProcessGuard = vi.hoisted(() => {
  const block = (name: string): never => {
    throw new Error(
      `Host subprocesses are blocked in unit tests (${name}). ` +
        'Move this test to INTEGRATION_TEST_FILES in tests/docker/integration-files.ts ' +
        'and run npm run test:integration with Docker.'
    )
  }

  return {
    childProcess: {
      spawn: vi.fn(() => block('spawn')),
      exec: vi.fn(() => block('exec')),
      execFile: vi.fn(() => block('execFile')),
      fork: vi.fn(() => block('fork')),
      spawnSync: vi.fn(() => block('spawnSync')),
      execSync: vi.fn(() => block('execSync')),
      execFileSync: vi.fn(() => block('execFileSync'))
    },
    pty: {
      spawn: vi.fn(() => block('node-pty.spawn')),
      fork: vi.fn(() => block('node-pty.fork')),
      createTerminal: vi.fn(() => block('node-pty.createTerminal')),
      open: vi.fn(() => block('node-pty.open')),
      native: null
    }
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  const blocked = hostProcessGuard.childProcess
  return { ...actual, ...blocked, default: { ...actual, ...blocked } }
})

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  const blocked = hostProcessGuard.childProcess
  return { ...actual, ...blocked, default: { ...actual, ...blocked } }
})

vi.mock('node-pty', () => ({ ...hostProcessGuard.pty, default: hostProcessGuard.pty }))

// Vitest's ESM mocks do not intercept nodePtySpawner's lazy CommonJS require.
// Resolve its filename without loading the native package, and supply the same denied exports.
const guardRequire = createRequire(import.meta.url)
const ptyModulePath = guardRequire.resolve('node-pty')
const guardedPtyModule = new Module(ptyModulePath)
guardedPtyModule.filename = ptyModulePath
guardedPtyModule.loaded = true
guardedPtyModule.exports = hostProcessGuard.pty
guardRequire.cache[ptyModulePath] = guardedPtyModule
