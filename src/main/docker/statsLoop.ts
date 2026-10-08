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
export function startStatsLoop(o: StatsLoopOptions): { stop(): void } {
  let stopped = false
  void (async () => {
    while (!stopped) {
      const map: Record<string, ContainerStats> = {}
      for (const id of o.runningIds()) {
        if (stopped) return
        try {
          const raw = await o.client.json(
            'GET',
            `/containers/${id}/stats?stream=false`,
            undefined,
            {
              timeoutMs: REQUEST_TIMEOUT_MS
            }
          )
          const s = computeStats(raw)
          if (s) map[id] = s
        } catch {
          // skip this id for this cycle
        }
      }
      if (stopped) return
      o.emit(map)
      await o.sleep(CYCLE_MS)
    }
  })()
  return {
    stop: () => {
      stopped = true
    }
  }
}
