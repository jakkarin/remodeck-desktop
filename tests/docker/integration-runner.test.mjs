/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executed by Node without a TypeScript loader. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { GenericContainer } from 'testcontainers'
import { isTestContainer } from './container-marker.mjs'
import { buildRunnerImage, runIntegration, startRunner } from './integration-runner.mjs'

if (!isTestContainer()) {
  throw new Error('Runner filesystem checks must run inside Docker; use npm run test:integration')
}

async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'remodeck-runner-fixture-'))
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  const files = {
    'package.json': '{}',
    'package-lock.json': '{}',
    'tsconfig.json': '{}',
    'tsconfig.node.json': '{}',
    'tsconfig.web.json': '{}',
    'vitest.config.ts': 'export default {}',
    'vitest.e2e.config.ts': 'export default {}',
    'src/main/example.ts': 'export const example = true',
    'tests/main/example.test.ts': 'export const example = true',
    'tests/docker/Dockerfile': 'FROM node:22-bookworm'
  }
  for (const [name, content] of Object.entries(files)) {
    const path = join(rootDir, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return rootDir
}

function output() {
  let value = ''
  return {
    stream: { write: (chunk) => (value += chunk) },
    read: () => value
  }
}

test('never runs tests when Docker image construction fails', async (t) => {
  const rootDir = await fixture(t)
  let context
  const dockerFailure = new Error('Docker is unavailable')
  await assert.rejects(
    runIntegration([], {
      rootDir,
      stdout: output().stream,
      buildImage: async (path) => {
        context = path
        throw dockerFailure
      }
    }),
    (error) => error === dockerFailure
  )
  await assert.rejects(readdir(context), { code: 'ENOENT' })
})

test('Docker startup failure rejects without executing tests', async (t) => {
  const rootDir = await fixture(t)
  const image = new GenericContainer('unused:local')
  const failure = new Error('Docker startup failed')
  image.start = async () => {
    throw failure
  }
  await assert.rejects(
    runIntegration([], {
      rootDir,
      stdout: output().stream,
      buildImage: async () => image
    }),
    (error) => error === failure
  )
})

test('copies code and configuration without host credential files or caches', async (t) => {
  const rootDir = await fixture(t)
  const excluded = [
    '.env',
    '.npmrc',
    '.git/config',
    '.agents/instructions.ts',
    '.aws/credentials',
    'node_modules/example/index.js',
    'out/main/index.js',
    'state/secrets.json',
    'src/.env',
    'src/.ssh/id_rsa',
    'src/credentials.json',
    'tests/.cache/compiled.ts',
    'tests/node_modules/example/index.js',
    'tests/fixtures/token.pem'
  ]
  for (const name of excluded) {
    const path = join(rootDir, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'host secret')
  }
  let context
  const image = await buildRunnerImage({
    rootDir,
    stdout: output().stream,
    buildImage: async (path) => {
      context = path
      assert.equal(
        await readFile(join(path, 'src/main/example.ts'), 'utf8'),
        'export const example = true'
      )
      assert.equal(
        await readFile(join(path, 'tests/main/example.test.ts'), 'utf8'),
        'export const example = true'
      )
      assert.equal(await readFile(join(path, 'package.json'), 'utf8'), '{}')
      assert.equal(await readFile(join(path, 'Dockerfile'), 'utf8'), 'FROM node:22-bookworm')
      for (const name of excluded) {
        await assert.rejects(readFile(join(path, name)), { code: 'ENOENT' })
      }
      return 'built image'
    }
  })
  assert.equal(image, 'built image')
  await assert.rejects(readdir(context), { code: 'ENOENT' })
})

test('rejects a source symlink before handing any context to Docker', async (t) => {
  const rootDir = await fixture(t)
  await mkdir(join(rootDir, 'secret'))
  await writeFile(join(rootDir, 'secret/leaked.ts'), 'host secret')
  await symlink(join(rootDir, 'secret'), join(rootDir, 'src/external'), 'junction')
  let built = false
  await assert.rejects(
    buildRunnerImage({
      rootDir,
      stdout: output().stream,
      buildImage: async () => {
        built = true
      }
    }),
    /symbolic link/i
  )
  assert.equal(built, false)
})

test('runs only in the unmounted container with synthetic environment and preserves Vitest result', async (t) => {
  const rootDir = await fixture(t)
  const stdout = output()
  const stderr = output()
  const image = new GenericContainer('unused:local')
  const hostHome = process.env.HOME
  const hostToken = process.env.GITHUB_TOKEN
  process.env.HOME = '/real/host/home'
  process.env.GITHUB_TOKEN = 'host-credential'
  t.after(() => {
    if (hostHome === undefined) delete process.env.HOME
    else process.env.HOME = hostHome
    if (hostToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = hostToken
  })
  let stopped = false
  let checkedHarness = false
  image.start = async () => {
    assert.equal(image.hostConfig.Binds, undefined)
    assert.equal(image.networkMode, 'none')
    assert.equal(image.createOpts.WorkingDir, '/workspace')
    assert.equal(image.environment.HOME, '/home/tester')
    assert.equal(image.environment.XDG_CONFIG_HOME, '/home/tester/.config')
    assert.equal(image.environment.GITHUB_TOKEN, undefined)
    assert.equal(image.environment.USERPROFILE, undefined)
    return {
      exec: async (command) => {
        if (!checkedHarness) {
          assert.deepEqual(command, ['node', '--test', 'tests/docker/integration-runner.test.mjs'])
          checkedHarness = true
          return { output: 'checks passed\n', stdout: 'checks passed\n', stderr: '', exitCode: 0 }
        }
        assert.deepEqual(command, [
          'npm',
          'exec',
          '--offline',
          '--',
          'vitest',
          'run',
          '--project',
          'integration',
          '--maxWorkers=4',
          '--reporter=verbose'
        ])
        return { output: 'failure\nerror\n', stdout: 'failure\n', stderr: 'error\n', exitCode: 7 }
      },
      stop: async () => {
        stopped = true
      }
    }
  }
  const code = await runIntegration(['--maxWorkers=4', '--reporter=verbose'], {
    rootDir,
    buildImage: async () => image,
    stdout: stdout.stream,
    stderr: stderr.stream
  })
  assert.equal(code, 7)
  assert.match(stdout.read(), /failure\n$/)
  assert.equal(stderr.read(), 'error\n')
  assert.equal(checkedHarness, true)
  assert.equal(stopped, true)
})

test('stops the container when executing the runner checks throws', async (t) => {
  const rootDir = await fixture(t)
  const image = new GenericContainer('unused:local')
  let stopped = false
  const failure = new Error('exec disconnected')
  image.start = async () => ({
    exec: async () => {
      throw failure
    },
    stop: async () => {
      stopped = true
    }
  })
  await assert.rejects(
    runIntegration([], {
      rootDir,
      buildImage: async () => image,
      stdout: output().stream
    }),
    (error) => error === failure
  )
  assert.equal(stopped, true)
})

test('does not execute Vitest when the container runner checks fail', async (t) => {
  const rootDir = await fixture(t)
  const image = new GenericContainer('unused:local')
  const stdout = output()
  const stderr = output()
  let stopped = false
  image.start = async () => ({
    exec: async (command) => {
      assert.deepEqual(command, ['node', '--test', 'tests/docker/integration-runner.test.mjs'])
      return { output: 'runner failed\n', stdout: '', stderr: 'runner failed\n', exitCode: 13 }
    },
    stop: async () => {
      stopped = true
    }
  })
  assert.equal(
    await runIntegration([], {
      rootDir,
      buildImage: async () => image,
      stdout: stdout.stream,
      stderr: stderr.stream
    }),
    13
  )
  assert.equal(stderr.read(), 'runner failed\n')
  assert.equal(stopped, true)
})

test('bounds Vitest to four workers when no worker limit is supplied', async (t) => {
  const rootDir = await fixture(t)
  const image = new GenericContainer('unused:local')
  image.start = async () => ({
    exec: async (command) => {
      if (command[0] !== 'node') {
        assert.deepEqual(command, [
          'npm',
          'exec',
          '--offline',
          '--',
          'vitest',
          'run',
          '--project',
          'integration',
          '--maxWorkers=4'
        ])
      }
      return { output: '', stdout: '', stderr: '', exitCode: 0 }
    },
    stop: async () => {}
  })
  assert.equal(
    await runIntegration([], {
      rootDir,
      buildImage: async () => image,
      stdout: output().stream
    }),
    0
  )
})

test('attaches the E2E runner to the supplied disposable fixture network', async () => {
  const image = new GenericContainer('unused:local')
  image.start = async () => {
    assert.equal(image.networkMode, 'fixture-network')
    assert.equal(image.hostConfig.Binds, undefined)
    assert.equal(image.createOpts.User, 'tester')
    return 'started container'
  }
  assert.equal(
    await startRunner(image, { network: { getName: () => 'fixture-network' } }),
    'started container'
  )
})

test('a cleanup failure rejects a successful run and preserves a failed Vitest status', async (t) => {
  for (const vitestCode of [0, 7]) {
    await t.test(`Vitest exit ${vitestCode}`, async (t) => {
      const rootDir = await fixture(t)
      const image = new GenericContainer('unused:local')
      const stderr = output()
      const cleanupFailure = new Error('container removal failed')
      image.start = async () => ({
        exec: async (command) => ({
          output: '',
          stdout: '',
          stderr: '',
          exitCode: command[0] === 'node' ? 0 : vitestCode
        }),
        stop: async () => {
          throw cleanupFailure
        }
      })
      const running = runIntegration([], {
        rootDir,
        buildImage: async () => image,
        stdout: output().stream,
        stderr: stderr.stream
      })
      if (vitestCode === 0) {
        await assert.rejects(running, (error) => error === cleanupFailure)
      } else {
        assert.equal(await running, 7)
        assert.match(stderr.read(), /container removal failed/)
      }
    })
  }
})
