import { describe, it, expect } from 'vitest'
import { computeStats, toContainerDetails } from '../../src/shared/containerDetails'

describe('containerDetails', () => {
  it('computeStats: cpu% and mem minus inactive_file', () => {
    const raw = {
      cpu_stats: { cpu_usage: { total_usage: 400 }, system_cpu_usage: 2000, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000 },
      memory_stats: { usage: 50_000_000, limit: 1_000_000_000, stats: { inactive_file: 8_000_000 } }
    }
    expect(computeStats(raw)).toEqual({ cpu: 40, memBytes: 42_000_000, memLimit: 1_000_000_000 })
  })
  it('computeStats: cgroup v1 cache, percpu fallback, zero system delta', () => {
    const raw = {
      cpu_stats: { cpu_usage: { total_usage: 10, percpu_usage: [1, 2, 3, 4] }, system_cpu_usage: 5 },
      precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 5 },
      memory_stats: { usage: 100, limit: 1000, stats: { cache: 30 } }
    }
    expect(computeStats(raw)).toEqual({ cpu: 0, memBytes: 70, memLimit: 1000 })
  })
  it('computeStats: malformed input is null', () => {
    for (const bad of [null, {}, { cpu_stats: {} }, 'x']) expect(computeStats(bad)).toBeNull()
  })
  it('toContainerDetails: overview fields', () => {
    const raw = {
      Config: { Image: 'nginx:1.27', Labels: { b: '2', a: '1' } },
      Created: '2026-01-02T03:04:05Z',
      State: { Status: 'exited', ExitCode: 137 },
      HostConfig: { RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 } },
      NetworkSettings: {
        Ports: {
          '443/tcp': null,
          '80/tcp': [
            { HostIp: '0.0.0.0', HostPort: '8080' },
            { HostIp: '::', HostPort: '8080' }
          ]
        },
        Networks: { web: { IPAddress: '172.18.0.2' } }
      },
      Mounts: [{ Source: '/srv/data', Destination: '/data', RW: false }]
    }
    const o = toContainerDetails(raw).overview
    expect(o.image).toBe('nginx:1.27')
    expect(o.created).toBe('2026-01-02T03:04:05Z')
    expect(o.state).toBe('exited')
    expect(o.exitCode).toBe(137)
    expect(o.restartPolicy).toBe('on-failure:3')
    expect(o.ports).toEqual(['8080→80/tcp', '443/tcp'])
    expect(o.mounts).toEqual([{ source: '/srv/data', target: '/data', mode: 'ro' }])
    expect(o.networks).toEqual([{ name: 'web', ip: '172.18.0.2' }])
    expect(o.labels).toEqual([['a', '1'], ['b', '2']])
  })
  it('toContainerDetails: env split at first =, bare key', () => {
    const d = toContainerDetails({ Config: { Env: ['A=1', 'URL=a=b', 'BARE'] } })
    expect(d.env).toEqual([
      { key: 'A', value: '1' },
      { key: 'URL', value: 'a=b' },
      { key: 'BARE', value: '' }
    ])
  })
  it('toContainerDetails: json hides env and does not mutate input', () => {
    const raw = { Config: { Image: 'x', Env: ['A=secret1', 'B=secret2', 'C=secret3'] } }
    const d = toContainerDetails(raw)
    expect(d.json).toContain('"Env": "<hidden: 3 vars>"')
    expect(d.json).not.toContain('secret')
    expect(raw.Config.Env).toHaveLength(3)
  })
  it('toContainerDetails: tolerates a sparse object', () => {
    const d = toContainerDetails({})
    expect(d.overview).toEqual({
      image: '', created: '', state: '', exitCode: null, restartPolicy: 'no',
      ports: [], mounts: [], networks: [], labels: []
    })
    expect(d.env).toEqual([])
    expect(d.json).toBe('{}')
  })
})
