import type { RegitApi } from '../shared/ipc'

declare global {
  interface Window {
    regit: RegitApi
  }
}
