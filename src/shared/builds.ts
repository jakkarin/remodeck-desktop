// Shared IPC data only; no node imports.
export type BuildRecord = {
  ref: string
  name: string
  status: string
  /** Epoch milliseconds. */
  createdAt: number
  /** null when Buildx has not recorded a completion time. */
  durationMs: number | null
}
