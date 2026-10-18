import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM script without type declarations
import { releaseTagError } from '../../scripts/check-release-tag.mjs'

const script = 'scripts/check-release-tag.mjs'
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const run = (tag?: string): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, [script], {
    env: { ...process.env, TAG: tag ?? '' },
    encoding: 'utf8'
  })

describe('releaseTagError', () => {
  it('accepts v + version', () => {
    expect(releaseTagError('v1.2.3', '1.2.3')).toBeNull()
  })

  it.each(['1.2.3', 'v1.2.4', 'v1.2.3-rc.1', 'V1.2.3'])('rejects %s', (tag) => {
    expect(releaseTagError(tag, '1.2.3')).toContain(tag)
  })

  it('rejects a missing tag', () => {
    expect(releaseTagError(undefined, '1.2.3')).toMatch(/No release tag/)
    expect(releaseTagError('', '1.2.3')).toMatch(/No release tag/)
  })
})

describe('check-release-tag script', () => {
  it('passes for the package.json version', () => {
    const result = run(`v${version}`)
    expect(result.status).toBe(0)
  })

  it('fails with a workflow error annotation otherwise', () => {
    const result = run('v0.0.0-not-this')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::Release tag v0.0.0-not-this does not match')
  })

  it('fails without a tag', () => {
    expect(run().status).toBe(1)
  })
})
