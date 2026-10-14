import { describe, expect, it, vi, type Mock } from 'vitest'
import { BuildService } from '../../../src/main/docker/buildService'
import type { ProcResult } from '../../../src/main/proc/run'

const record = {
  ref: 'default/default/build1',
  name: 'shop',
  status: 'Completed',
  created_at: '2026-10-14T01:00:00Z',
  completed_at: '2026-10-14T01:00:12Z'
}
const ok = (stdout: string): ProcResult => ({ code: 0, stdout, stderr: '' })

function setup(result: ProcResult): { exec: Mock; targetFor: Mock; service: BuildService } {
  const exec = vi.fn(async () => result)
  const targetFor = vi.fn(() => ({ exec }))
  return { exec, targetFor, service: new BuildService(targetFor) }
}

describe('BuildService', () => {
  it('reads real Buildx JSON lines including running builds without an end time', async () => {
    const t = setup(
      ok(
        `${JSON.stringify(record)}\n${JSON.stringify({
          ...record,
          ref: 'default/default/build2',
          status: 'Running',
          completed_at: undefined
        })}\n`
      )
    )
    expect(await t.service.history('h1')).toEqual([
      {
        ref: record.ref,
        name: 'shop',
        status: 'Completed',
        createdAt: 1791939600000,
        durationMs: 12000
      },
      {
        ref: 'default/default/build2',
        name: 'shop',
        status: 'Running',
        createdAt: 1791939600000,
        durationMs: null
      }
    ])
    expect(t.targetFor).toHaveBeenCalledWith('h1')
    expect(t.exec).toHaveBeenCalledWith('docker buildx history ls --format json\n', {
      timeoutMs: 30000
    })
  })

  it('accepts an empty history and JSON arrays', async () => {
    expect(await setup(ok('')).service.history('h')).toEqual([])
    expect(await setup(ok('[]')).service.history('h')).toEqual([])
    expect(await setup(ok(JSON.stringify([record]))).service.history('h')).toHaveLength(1)
  })

  it('rejects malformed records rather than presenting a misleading empty history', async () => {
    for (const stdout of [
      'not json',
      '{}',
      '[null]',
      '{"ref":"x","status":"Completed","created_at":"invalid"}'
    ]) {
      await expect(setup(ok(stdout)).service.history('h')).rejects.toThrow('Invalid build history')
    }
  })

  it('explains unsupported Buildx history without masking daemon errors', async () => {
    const t = setup({ code: 1, stdout: '', stderr: 'unknown command "history" for "buildx"' })
    await expect(t.service.history('h')).rejects.toThrow('Build history requires')
    t.exec.mockResolvedValueOnce({
      code: 1,
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon'
    })
    await expect(t.service.history('h')).rejects.toThrow('Cannot connect to the Docker daemon')
  })
})
