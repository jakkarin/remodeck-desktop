import fs from 'node:fs'
import path from 'node:path'
import { runProcess } from '../../src/main/proc/run'
import { shQuote } from '../../src/main/sandbox/shell'
import { isTestContainer } from '../docker/container-marker.mjs'

const KEY_PATH = '/run/remodeck-e2e/id_e2e'
const SSH = '/usr/bin/ssh'
const ALIASES = ['sandbox-1', 'sandbox-2', 'sandbox-nogit', 'gitaccess-box'] as const

type FixtureAlias = (typeof ALIASES)[number]
type FixtureAddress = { hostname: string; port: number }
type FixtureManifest = {
  version: number
  keyPath: string
  hosts: Record<FixtureAlias, FixtureAddress>
}

/** Reject before any test creates files or launches a process outside the disposable runner. */
function assertContainer(): void {
  if (!isTestContainer()) {
    throw new Error('E2E tests require the disposable Docker runner; use npm run test:e2e')
  }
}

assertContainer()
const manifest = JSON.parse(
  fs.readFileSync(process.env.REMODECK_E2E_FIXTURES ?? '/run/remodeck-e2e/fixtures.json', 'utf8')
) as FixtureManifest
if (
  manifest.version !== 1 ||
  manifest.keyPath !== KEY_PATH ||
  !fs.statSync(KEY_PATH).isFile() ||
  ALIASES.some(
    (alias) => manifest.hosts?.[alias]?.hostname !== alias || manifest.hosts[alias].port !== 22
  )
) {
  throw new Error('The disposable runner did not provide the expected E2E SSH fixtures')
}

export type E2eFixture = {
  getHost(): string
  getMappedPort(port: number): number
  exec(
    args: string[],
    opts?: { user?: 'dev' | 'root' }
  ): Promise<{ exitCode: number; output: string; stdout: string; stderr: string }>
  stop(): Promise<void>
}

/** The host runner owns container creation and cleanup; tests only reach the sibling over SSH. */
export function getE2eFixture(alias: FixtureAlias): E2eFixture {
  const { hostname, port } = manifest.hosts[alias]
  return {
    getHost: () => hostname,
    getMappedPort: (requestedPort) => {
      if (requestedPort !== 22) throw new Error('E2E fixtures expose only SSH')
      return port
    },
    exec: async (args, { user = 'dev' } = {}) => {
      assertContainer()
      const home = user === 'root' ? '/root' : '/home/dev'
      // Keep fixture setup independent of PATH changes installed by the Git access tests.
      const command = [
        'env',
        '-i',
        `HOME=${home}`,
        `USER=${user}`,
        `LOGNAME=${user}`,
        'SHELL=/bin/bash',
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        ...args
      ]
        .map(shQuote)
        .join(' ')
      const result = await runProcess(
        SSH,
        [
          '-F',
          '/dev/null',
          '-i',
          KEY_PATH,
          '-o',
          'BatchMode=yes',
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'IdentityAgent=none',
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'UserKnownHostsFile=/dev/null',
          '-o',
          'GlobalKnownHostsFile=/dev/null',
          '-o',
          'LogLevel=ERROR',
          '-o',
          'ConnectTimeout=10',
          '-p',
          String(port),
          `${user}@${hostname}`,
          command
        ],
        { timeoutMs: 60_000 }
      )
      return {
        exitCode: result.code,
        output: result.stdout + result.stderr,
        stdout: result.stdout,
        stderr: result.stderr
      }
    },
    stop: async () => undefined
  }
}

/** Pin app SSH calls to synthetic credentials instead of the account's default SSH config. */
export function createE2eSsh(home: string, aliases: FixtureAlias[]): string {
  assertContainer()
  const sshDir = path.join(home, '.ssh')
  const config = path.join(sshDir, 'config')
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    config,
    aliases
      .map((alias) => {
        const fixture = getE2eFixture(alias)
        return [
          `Host ${alias}`,
          `  HostName ${fixture.getHost()}`,
          `  Port ${fixture.getMappedPort(22)}`,
          '  User dev',
          `  IdentityFile ${KEY_PATH}`,
          '  IdentitiesOnly yes',
          '  IdentityAgent none',
          '  StrictHostKeyChecking no',
          '  UserKnownHostsFile /dev/null',
          '  GlobalKnownHostsFile /dev/null',
          '  LogLevel ERROR',
          ''
        ].join('\n')
      })
      .join('\n'),
    { mode: 0o600 }
  )
  const wrapper = path.join(sshDir, 'ssh')
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${SSH} -F ${shQuote(config)} "$@"\n`, { mode: 0o700 })
  return wrapper
}
