import { runIntegration } from './integration-runner.mjs'

try {
  process.exitCode = await runIntegration(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`[integration] ${error.message}\n`)
  process.stderr.write('Docker is required for integration tests; no host fallback is available.\n')
  process.exitCode = 1
}
