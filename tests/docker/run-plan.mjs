/* eslint-disable @typescript-eslint/explicit-function-return-type -- Executed by Node without a TypeScript loader. */
const UNIT_PROJECTS = ['node', 'renderer']

/**
 * Splits `npm test` arguments between the host unit run and the Docker integration run.
 * `--project` picks the suites to run; everything else goes to each suite that runs.
 * A null entry means that suite is skipped.
 */
export function planRun(argv) {
  const projects = []
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--project') projects.push(argv[++i])
    else if (arg.startsWith('--project=')) projects.push(arg.slice('--project='.length))
    else rest.push(arg)
  }
  const unknown = projects.filter((p) => p !== 'integration' && !UNIT_PROJECTS.includes(p))
  if (unknown.length) throw new Error(`Unknown test project: ${unknown.join(', ')}`)
  // A file filter usually matches only one suite; the other must not fail on "no test files".
  const shared = rest.some((arg) => !arg.startsWith('-')) ? [...rest, '--passWithNoTests'] : rest
  const unit = projects.length ? projects.filter((p) => UNIT_PROJECTS.includes(p)) : UNIT_PROJECTS
  return {
    unit: unit.length ? [...unit.flatMap((p) => ['--project', p]), ...shared] : null,
    integration: !projects.length || projects.includes('integration') ? shared : null
  }
}
