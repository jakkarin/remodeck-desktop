import { GenericContainer, Wait, getContainerRuntimeClient } from 'testcontainers'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildRunnerImage, startRunner } from './integration-runner.mjs'

const FIXTURES = ['sandbox-1', 'sandbox-2', 'sandbox-nogit', 'gitaccess-box']
// Stable tag so Docker's layer cache survives between runs.
const FIXTURE_IMAGE = 'remodeck-e2e-sandbox:latest'
let client
let network
let runner
const sandboxes = []
try {
  // Docker failure propagates. No fixture command is ever executed on the host.
  client = await getContainerRuntimeClient()
  // Internal: the runner reaches its sibling fixtures but has no route to the internet.
  const networkName = `remodeck-e2e-${randomUUID()}`
  network = await client.network.create({ Name: networkName, Driver: 'bridge', Internal: true })
  const [runnerImage] = await Promise.all([
    buildRunnerImage(),
    GenericContainer.fromDockerfile(
      fileURLToPath(new URL('../e2e/sandbox', import.meta.url))
    ).build(FIXTURE_IMAGE, { deleteOnExit: false })
  ])
  runner = await startRunner(runnerImage, { network: { getName: () => networkName } })
  const keyPath = '/run/remodeck-e2e/id_e2e'
  const key = await runner.exec(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', keyPath])
  if (key.exitCode !== 0) throw new Error(`Fixture key generation failed: ${key.stderr}`)
  const publicKey = await runner.exec(['cat', `${keyPath}.pub`])
  if (publicKey.exitCode !== 0) throw new Error('Cannot read synthetic fixture public key')
  const started = await Promise.allSettled(
    FIXTURES.map((name) =>
      new GenericContainer(FIXTURE_IMAGE)
        .withNetworkMode(networkName)
        .withNetworkAliases(name)
        .withEnvironment({
          AUTHORIZED_KEY: publicKey.stdout.trim(),
          HIDE_GIT: name === 'sandbox-nogit' ? '1' : '0'
        })
        .withWaitStrategy(Wait.forLogMessage(/Server listening on 0\.0\.0\.0/))
        .start()
    )
  )
  // Keep every started fixture for cleanup before reporting the first failure.
  for (const result of started) if (result.status === 'fulfilled') sandboxes.push(result.value)
  const failed = started.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  const hosts = Object.fromEntries(FIXTURES.map((name) => [name, { hostname: name, port: 22 }]))
  await runner.copyContentToContainer([
    {
      content: JSON.stringify({ version: 1, keyPath, hosts }),
      target: '/run/remodeck-e2e/fixtures.json'
    }
  ])
  const result = await runner.exec([
    'node',
    'node_modules/vitest/vitest.mjs',
    'run',
    '-c',
    'vitest.e2e.config.ts',
    '--maxWorkers=1',
    ...process.argv.slice(2)
  ])
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (!Number.isInteger(result.exitCode)) throw new Error('E2E Vitest did not report an exit code')
  process.exitCode = result.exitCode
} catch (error) {
  console.error(`Docker E2E tests failed: ${error.message}`)
  process.exitCode = 1
} finally {
  const cleanup = await Promise.allSettled([
    runner?.stop(),
    ...sandboxes.map((sandbox) => sandbox.stop())
  ])
  for (const result of cleanup) {
    if (result.status === 'rejected') {
      console.error(`Test container cleanup failed: ${result.reason.message}`)
      process.exitCode = 1
    }
  }
  if (network) {
    try {
      await client.network.remove(network)
    } catch (error) {
      console.error(`Test network cleanup failed: ${error.message}`)
      process.exitCode = 1
    }
  }
}
