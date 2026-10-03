import { ElectronAPI } from '@electron-toolkit/preload'
import type { RegitApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    regit: RegitApi
  }
}
