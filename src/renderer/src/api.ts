import type { RegitApi } from '../../shared/ipc'

export const api: RegitApi = window.regit

/** Human-readable message from a rejected IPC call (strips Electron's "Error invoking remote method" prefix). */
export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
}
