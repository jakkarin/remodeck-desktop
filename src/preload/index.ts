import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type RegitApi, type RegitEvent } from '../shared/ipc'

const C = IPC_CHANNELS
const invoke =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>
const send =
  (channel: string) =>
  (...args: unknown[]): void =>
    ipcRenderer.send(channel, ...args)

const regit: RegitApi = {
  hosts: {
    list: invoke(C.hosts.list),
    add: invoke(C.hosts.add),
    remove: invoke(C.hosts.remove),
    status: invoke(C.hosts.status),
    connect: invoke(C.hosts.connect),
    disconnect: invoke(C.hosts.disconnect)
  },
  repos: {
    listGitHub: invoke(C.repos.listGitHub),
    list: invoke(C.repos.list),
    updatePolicy: invoke(C.repos.updatePolicy)
  },
  workspaces: {
    list: invoke(C.workspaces.list),
    clone: invoke(C.workspaces.clone),
    remove: invoke(C.workspaces.remove),
    sync: invoke(C.workspaces.sync),
    branches: invoke(C.workspaces.branches),
    commits: invoke(C.workspaces.commits),
    diff: invoke(C.workspaces.diff),
    worktrees: invoke(C.workspaces.worktrees),
    push: invoke(C.workspaces.push),
    openPR: invoke(C.workspaces.openPR),
    rebuildMirror: invoke(C.workspaces.rebuildMirror)
  },
  terminal: {
    open: invoke(C.terminal.open),
    write: send(C.terminal.write),
    resize: send(C.terminal.resize),
    close: send(C.terminal.close)
  },
  approval: { respond: send(C.approval.respond) },
  pushLog: { read: invoke(C.pushLog.read) },
  on(event: RegitEvent, cb: (...args: never[]) => void): () => void {
    const channel = C.events[event]
    if (!channel) throw new Error(`Unknown event ${String(event)}`)
    const listener = (_e: IpcRendererEvent, ...args: unknown[]): void =>
      (cb as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('regit', regit)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.regit = regit
}
