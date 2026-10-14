import type { BuildRecord } from '../../shared/builds'
import type { SandboxTarget } from '../sandbox/target'

function parseHistory(stdout: string): BuildRecord[] {
  try {
    const text = stdout.trim()
    if (!text) return []
    // Buildx emits one JSON object per line. Also accept array output.
    const records: unknown = text.startsWith('[')
      ? JSON.parse(text)
      : text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
    if (!Array.isArray(records)) throw new Error()
    return records.map((raw: unknown) => {
      if (raw === null || typeof raw !== 'object') throw new Error()
      const r = raw as Record<string, unknown>
      if (
        typeof r.ref !== 'string' ||
        !r.ref ||
        typeof r.status !== 'string' ||
        typeof r.created_at !== 'string'
      )
        throw new Error()
      const createdAt = Date.parse(r.created_at)
      if (!Number.isFinite(createdAt)) throw new Error()
      let durationMs: number | null = null
      if (r.completed_at !== undefined) {
        if (typeof r.completed_at !== 'string') throw new Error()
        durationMs = Date.parse(r.completed_at) - createdAt
        if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error()
      }
      return {
        ref: r.ref,
        name: typeof r.name === 'string' && r.name ? r.name : r.ref,
        status: r.status,
        createdAt,
        durationMs
      }
    })
  } catch {
    throw new Error('Invalid build history returned by Docker Buildx')
  }
}

/** BuildKit history is exposed by Buildx, not the Docker Engine resource API. */
export class BuildService {
  constructor(private readonly targetFor: (hostId: string) => Pick<SandboxTarget, 'exec'>) {}

  async history(hostId: string): Promise<BuildRecord[]> {
    const result = await this.targetFor(hostId).exec('docker buildx history ls --format json\n', {
      timeoutMs: 30000
    })
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`
      if (
        /unknown command|unknown flag|not a docker command|not found|unimplemented|not implemented|not supported/i.test(
          detail
        )
      ) {
        throw new Error(
          `Build history requires Docker Buildx and BuildKit with history support. Install or update them on this host.\n${detail}`
        )
      }
      throw new Error(`Cannot load build history: ${detail}`)
    }
    return parseHistory(result.stdout)
  }
}
