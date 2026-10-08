import { computeStats, type ContainerStats } from '../../shared/containerDetails'
import type { DockerClient } from './dockerClient'

const REQUEST_TIMEOUT_MS = 10000
const CYCLE_MS = 5000

export interface StatsLoopOptions {
  client: Pick<DockerClient, 'json'>
  runningIds(): string[]
  emit(map: Record<string, ContainerStats>): void
  sleep(ms: number): Promise<void>
}

/** Polls one-shot stats for running containers sequentially (the agent has few sockets). */
export function startStatsLoop(o: StatsLoopOptions): { stop(): void; done: Promise<void> } {
  let stopped = false
  let wake: () => void = () => {}
  const latest = new Map<string, ContainerStats>()
  const woken = new Promise<void>((r) => (wake = r))
  const prev = new Map<string, unknown>()
  const done = (async () => {
    while (!stopped) {
      let ids: string[] = []
      try {
        ids = o.runningIds()
      } catch {
        // retry next cycle
      }
      const running = new Set(ids)
      for (const id of [...latest.keys()]) if (!running.has(id)) latest.delete(id)
      for (const id of [...prev.keys()]) if (!running.has(id)) prev.delete(id)
      for (const id of ids) {
        if (stopped) return
        try {
          const raw = await o.client.json(
            'GET',
            `/containers/${id}/stats?stream=false&one-shot=true`,
            undefined,
            {
              timeoutMs: REQUEST_TIMEOUT_MS
            }
          )
          const s = computeStats(raw, prev.get(id))
          const cpuStats = (raw as { cpu_stats?: unknown } | null)?.cpu_stats
          if (cpuStats) prev.set(id, cpuStats)
          if (s) latest.set(id, s)
          else latest.delete(id)
        } catch {
          latest.delete(id)
        }
        if (stopped) return
        try {
          o.emit({ ...Object.fromEntries(latest) })
        } catch {
          // a throwing consumer must not end polling
        }
      }
      if (stopped) return
      await Promise.race([o.sleep(CYCLE_MS), woken])
    }
  })()
  return {
    stop: () => {
      stopped = true
      wake()
    },
    done
  }
}
