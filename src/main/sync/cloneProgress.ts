import type { CloneProgress } from '../../shared/types'

/** Share of the overall bar for each git progress stage: [start, end]. */
const RANGES: Record<string, [CloneProgress['phase'], number, number]> = {
  'Receiving objects': ['fetch', 0, 50],
  'Resolving deltas': ['fetch', 50, 60],
  'Writing objects': ['push', 60, 95]
}

const LINE = /^(?:remote: )?([A-Z][a-z]+ [a-z]+):\s+(\d{1,3})%/

/**
 * Turns git `--progress` stderr into one overall percentage. Stages it does not know (Counting, Compressing)
 * are ignored, and the percentage never goes back, so a fetch with nothing new simply jumps ahead.
 */
export function cloneProgressTracker(emit: (p: CloneProgress) => void): {
  /** Feed a raw stderr chunk from `git fetch --progress` or `git push --progress`. */
  feed(chunk: string): void
  /** Mark the start of a step that reports no progress of its own. */
  at(phase: CloneProgress['phase'], percent: number): void
} {
  let last = -1
  let rest = ''
  const at = (phase: CloneProgress['phase'], percent: number): void => {
    const p = Math.min(100, Math.floor(percent))
    if (p <= last) return
    last = p
    emit({ phase, percent: p })
  }
  return {
    feed(chunk) {
      const lines = (rest + chunk).split(/[\r\n]/)
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const m = LINE.exec(line.trim())
        const range = m && RANGES[m[1]]
        if (!m || !range) continue
        const [phase, from, to] = range
        at(phase, from + ((to - from) * Math.min(100, Number(m[2]))) / 100)
      }
    },
    at
  }
}
