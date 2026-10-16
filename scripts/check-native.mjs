import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Test native modules in the Electron runtime that will ship with the application.
if (!process.versions.electron) {
  const { default: electron } = await import('electron')
  const result = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30_000
  })
  if (result.error) throw result.error
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  process.exit(result.status ?? 1)
}

const { default: pty } = await import('node-pty')
const marker = 'remodeck-native-smoke'
const windows = process.platform === 'win32'
const terminal = pty.spawn(
  windows ? process.env.ComSpec || 'C:/Windows/System32/cmd.exe' : '/bin/sh',
  windows ? ['/d', '/c', `echo ${marker}`] : ['-c', `printf ${marker}`],
  { name: 'xterm-color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env }
)
let output = ''
terminal.onData((data) => {
  output += data
})
const timeout = setTimeout(() => {
  terminal.kill()
  throw new Error('Native terminal smoke test timed out')
}, 15_000)
terminal.onExit(({ exitCode }) => {
  clearTimeout(timeout)
  assert.equal(exitCode, 0)
  assert.ok(output.includes(marker), 'Terminal did not echo the expected marker')
  console.log(
    `Electron ${process.versions.electron}: node-pty loaded and spawned a working terminal`
  )
  process.exit(0)
})
