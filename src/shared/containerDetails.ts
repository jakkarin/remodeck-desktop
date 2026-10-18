export type ContainerStats = { cpu: number | null; memBytes: number; memLimit: number }

export type ContainerDetails = {
  overview: {
    image: string
    created: string
    state: string
    exitCode: number | null
    restartPolicy: string
    ports: string[]
    mounts: { source: string; target: string; mode: 'rw' | 'ro' }[]
    networks: { name: string; ip: string }[]
    labels: [string, string][]
  }
  env: { key: string; value: string }[]
  json: string
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * `prev` is the previous `cpu_stats` seen for the same container. One-shot responses carry a
 * zeroed `precpu_stats`, so it stands in as the "pre" sample; without either, cpu is null.
 */
export function computeStats(raw: unknown, prev?: unknown): ContainerStats | null {
  const r = asRecord(raw)
  if (!r.cpu_stats || typeof r.cpu_stats !== 'object') return null
  const mem = asRecord(r.memory_stats)
  if (typeof mem.usage !== 'number') return null
  const cpu = asRecord(r.cpu_stats)
  const inline = asRecord(r.precpu_stats)
  const hasInline = typeof inline.system_cpu_usage === 'number' && inline.system_cpu_usage > 0
  const prevRec = asRecord(prev)
  const hasPrev = typeof prevRec.system_cpu_usage === 'number' && prevRec.system_cpu_usage > 0
  const pre = hasInline ? inline : prevRec
  const cpuUsage = asRecord(cpu.cpu_usage)
  const dCpu = num(cpuUsage.total_usage) - num(asRecord(pre.cpu_usage).total_usage)
  const dSys = num(cpu.system_cpu_usage) - num(pre.system_cpu_usage)
  const percpu = Array.isArray(cpuUsage.percpu_usage) ? cpuUsage.percpu_usage.length : 0
  const cpus = num(cpu.online_cpus) || percpu || 1
  const pct = !hasInline && !hasPrev ? null : dSys > 0 && dCpu >= 0 ? (dCpu / dSys) * cpus * 100 : 0
  const stats = asRecord(mem.stats)
  const cache = [stats.inactive_file, stats.total_inactive_file, stats.cache].find(
    (v) => typeof v === 'number'
  ) as number | undefined
  return {
    cpu: pct,
    memBytes: Math.max(0, mem.usage - (cache ?? 0)),
    memLimit: num(mem.limit)
  }
}

function portNum(p: string): number {
  return parseInt(p, 10) || 0
}

export function toContainerDetails(raw: unknown): ContainerDetails {
  const r = asRecord(raw)
  const config = asRecord(r.Config)
  const state = asRecord(r.State)
  const net = asRecord(r.NetworkSettings)
  const policy = asRecord(asRecord(r.HostConfig).RestartPolicy)

  let restartPolicy = str(policy.Name) || 'no'
  if (restartPolicy === 'on-failure' && num(policy.MaximumRetryCount) > 0) {
    restartPolicy += `:${num(policy.MaximumRetryCount)}`
  }

  const ports = new Set<string>()
  const portEntries = Object.entries(asRecord(net.Ports)).sort(
    (a, b) => portNum(a[0]) - portNum(b[0])
  )
  for (const [cport, bindings] of portEntries) {
    const list = Array.isArray(bindings) ? bindings : []
    if (list.length === 0) ports.add(cport)
    for (const b of list) {
      const hp = str(asRecord(b).HostPort)
      ports.add(hp ? `${hp}→${cport}` : cport)
    }
  }

  const mounts = (Array.isArray(r.Mounts) ? r.Mounts : []).map((m) => {
    const mr = asRecord(m)
    return {
      source: str(mr.Source),
      target: str(mr.Destination),
      mode: (mr.RW === false ? 'ro' : 'rw') as 'rw' | 'ro'
    }
  })

  const networks = Object.entries(asRecord(net.Networks))
    .map(([name, n]) => ({ name, ip: str(asRecord(n).IPAddress) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const labels = Object.entries(asRecord(config.Labels))
    .map(([k, v]): [string, string] => [k, str(v)])
    .sort((a, b) => a[0].localeCompare(b[0]))

  const envList = Array.isArray(config.Env)
    ? config.Env.filter((e): e is string => typeof e === 'string')
    : []
  const env = envList.map((e) => {
    const i = e.indexOf('=')
    return i < 0 ? { key: e, value: '' } : { key: e.slice(0, i), value: e.slice(i + 1) }
  })

  const copy: Record<string, unknown> = { ...r }
  if (Array.isArray(config.Env)) {
    copy.Config = { ...config, Env: `<hidden: ${config.Env.length} vars>` }
  }

  return {
    overview: {
      image: str(config.Image),
      created: str(r.Created),
      state: str(state.Status),
      exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
      restartPolicy,
      ports: [...ports],
      mounts,
      networks,
      labels
    },
    env,
    json: JSON.stringify(copy, null, 2)
  }
}
