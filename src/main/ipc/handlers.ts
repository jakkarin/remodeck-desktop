import { IPC_CHANNELS, SEND_CHANNELS, type MainApi } from '../../shared/ipc'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The subset of Electron's ipcMain used here; injected so this module stays unit-testable. */
export type IpcMainLike = {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void
  on(channel: string, listener: (event: any, ...args: any[]) => void): void
}

type AnyFn = (...args: unknown[]) => unknown

/** Registers one listener per method channel in IPC_CHANNELS, dispatching to the same-named MainApi method. */
export function registerHandlers(ipcMain: IpcMainLike, api: MainApi): void {
  for (const [group, methods] of Object.entries(IPC_CHANNELS)) {
    if (group === 'events') continue
    const target = api[group as keyof MainApi] as unknown as Record<string, AnyFn>
    for (const [method, channel] of Object.entries(methods as Record<string, string>)) {
      const fn = target[method]
      if (typeof fn !== 'function') throw new Error(`MainApi is missing ${group}.${method}`)
      if (SEND_CHANNELS.has(channel)) {
        // No reply channel: swallow errors so a bad renderer message cannot crash the main process.
        ipcMain.on(channel, (_event, ...args) => {
          try {
            fn.apply(target, args)
          } catch (err) {
            console.error(`[ipc] ${channel}:`, err)
          }
        })
      } else {
        ipcMain.handle(channel, (_event, ...args) => fn.apply(target, args))
      }
    }
  }
}
