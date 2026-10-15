import { describe, expect, it } from 'vitest'
import { planRun } from './run-plan.mjs'

describe('npm test argument routing', () => {
  it('runs both suites with no arguments', () => {
    expect(planRun([])).toEqual({
      unit: ['--project', 'node', '--project', 'renderer'],
      integration: []
    })
  })

  it('lets a file filter match only one suite', () => {
    expect(planRun(['tests/renderer/BuildsView.test.tsx'])).toEqual({
      unit: [
        '--project',
        'node',
        '--project',
        'renderer',
        'tests/renderer/BuildsView.test.tsx',
        '--passWithNoTests'
      ],
      integration: ['tests/renderer/BuildsView.test.tsx', '--passWithNoTests']
    })
  })

  it('passes flags through unchanged', () => {
    expect(planRun(['--reporter=verbose']).integration).toEqual(['--reporter=verbose'])
  })

  it('runs only the named projects', () => {
    expect(planRun(['--project', 'node'])).toEqual({
      unit: ['--project', 'node'],
      integration: null
    })
    expect(planRun(['--project=integration', '--maxWorkers=2'])).toEqual({
      unit: null,
      integration: ['--maxWorkers=2']
    })
  })

  it('rejects unknown projects', () => {
    expect(() => planRun(['--project', 'e2e'])).toThrow('Unknown test project: e2e')
  })
})
