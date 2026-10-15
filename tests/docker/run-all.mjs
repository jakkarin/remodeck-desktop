import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runIntegration } from './integration-runner.mjs'
import { planRun } from './run-plan.mjs'

const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url))
try {
  const plan = planRun(process.argv.slice(2))
  const unitCode = plan.unit
    ? await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [vitest, 'run', ...plan.unit], {
          stdio: 'inherit',
          shell: false,
          windowsHide: true
        })
        child.once('error', reject)
        child.once('exit', (code) => resolve(code ?? 1))
      })
    : 0
  process.exitCode =
    unitCode !== 0 || !plan.integration ? unitCode : await runIntegration(plan.integration)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
