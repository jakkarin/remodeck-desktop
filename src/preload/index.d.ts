import type { RemodeckApi } from '../shared/ipc'

declare global {
  interface Window {
    remodeck: RemodeckApi
  }
}
