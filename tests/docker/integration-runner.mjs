/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executed by Node without a TypeScript loader. */
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const rootFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'vitest.config.ts',
  'vitest.e2e.config.ts'
]
const codeExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.sh'
])
const excludedDirectories = new Set(['node_modules', 'coverage', 'out', 'dist'])

async function copyRegularFile(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link: ${source}`)
  if (!info.isFile()) throw new Error(`Expected a regular test input file: ${source}`)
  await copyFile(source, destination)
}

async function copyCodeTree(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link: ${source}`)
  if (!info.isDirectory()) throw new Error(`Expected a test input directory: ${source}`)
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name)) continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Refusing to copy symbolic link: ${from}`)
    if (entry.isDirectory()) await copyCodeTree(from, to)
    else if (codeExtensions.has(extname(entry.name))) await copyRegularFile(from, to)
  }
}

// A stable tag that outlives the run keeps the `npm ci` layer cached; each build retags it.
export const RUNNER_IMAGE = 'remodeck-test-runner:local'

async function defaultBuildImage(context) {
  const { GenericContainer } = await import('testcontainers')
  return GenericContainer.fromDockerfile(context).build(RUNNER_IMAGE, { deleteOnExit: false })
}

/** Build from copied test inputs; the Docker daemon never receives the repository or host home. */
export async function buildRunnerImage({
  rootDir = repositoryRoot,
  buildImage = defaultBuildImage,
  stdout = process.stdout
} = {}) {
  const context = await mkdtemp(join(tmpdir(), 'remodeck-test-image-'))
  try {
    for (const name of rootFiles) {
      await copyRegularFile(join(rootDir, name), join(context, name))
    }
    await copyCodeTree(join(rootDir, 'src'), join(context, 'src'))
    await copyCodeTree(join(rootDir, 'tests'), join(context, 'tests'))
    await copyRegularFile(join(rootDir, 'tests/docker/Dockerfile'), join(context, 'Dockerfile'))
    stdout.write('[tests] Building disposable Linux test image (Docker required)...\n')
    return await buildImage(context)
  } finally {
    await rm(context, { recursive: true, force: true })
  }
}

/** The application test container receives neither bind mounts nor the host environment. */
export async function startRunner(image, { network, networkMode = 'none' } = {}) {
  image
    .withWorkingDir('/workspace')
    .withUser('tester')
    .withEnvironment({
      CI: '1',
      HOME: '/home/tester',
      XDG_CONFIG_HOME: '/home/tester/.config',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      NODE_ENV: 'test'
    })
    .withCommand(['sleep', 'infinity'])
    .withStartupTimeout(120_000)
  if (network) image.withNetwork(network)
  else image.withNetworkMode(networkMode)
  return image.start()
}

export async function runIntegration(args = [], options = {}) {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  let container
  let exitCode
  let failure
  let failed = false
  try {
    const image = await buildRunnerImage({ ...options, stdout })
    container = await startRunner(image)
    stdout.write('[integration] Checking the runner inside the test container...\n')
    const harness = await container.exec([
      'node',
      '--test',
      'tests/docker/integration-runner.test.mjs'
    ])
    stdout.write(harness.stdout)
    stderr.write(harness.stderr)
    if (!Number.isInteger(harness.exitCode))
      throw new Error('Runner checks did not report an exit code')
    exitCode = harness.exitCode
    if (exitCode === 0) {
      stdout.write('[integration] Running Vitest inside the test container...\n')
      const workerArgs = args.some(
        (arg) => arg === '--maxWorkers' || arg.startsWith('--maxWorkers=')
      )
        ? []
        : ['--maxWorkers=4']
      const result = await container.exec([
        'npm',
        'exec',
        '--offline',
        '--',
        'vitest',
        'run',
        '--project',
        'integration',
        ...workerArgs,
        ...args
      ])
      stdout.write(result.stdout)
      stderr.write(result.stderr)
      if (!Number.isInteger(result.exitCode)) throw new Error('Vitest did not report an exit code')
      exitCode = result.exitCode
    }
  } catch (error) {
    failure = error
    failed = true
  } finally {
    if (container) {
      try {
        await container.stop()
      } catch (error) {
        if (failed || exitCode !== 0) {
          stderr.write(`[integration] Container cleanup failed: ${error.message}\n`)
        } else {
          failure = error
          failed = true
        }
      }
    }
  }
  if (failed) throw failure
  return exitCode
}
