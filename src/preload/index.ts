import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type RemodeckApi, type RemodeckEvent } from '../shared/ipc'

const C = IPC_CHANNELS
const invoke =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>
const send =
  (channel: string) =>
  (...args: unknown[]): void =>
    ipcRenderer.send(channel, ...args)

const remodeck: RemodeckApi = {
  hosts: {
    list: invoke(C.hosts.list),
    add: invoke(C.hosts.add),
    update: invoke(C.hosts.update),
    remove: invoke(C.hosts.remove),
    status: invoke(C.hosts.status),
    connect: invoke(C.hosts.connect),
    probeGit: invoke(C.hosts.probeGit),
    probeDocker: invoke(C.hosts.probeDocker),
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
    inspectExisting: invoke(C.workspaces.inspectExisting),
    addExisting: invoke(C.workspaces.addExisting),
    remove: invoke(C.workspaces.remove),
    sync: invoke(C.workspaces.sync),
    branches: invoke(C.workspaces.branches),
    baseBranches: invoke(C.workspaces.baseBranches),
    commits: invoke(C.workspaces.commits),
    files: invoke(C.workspaces.files),
    diff: invoke(C.workspaces.diff),
    setActive: send(C.workspaces.setActive),
    worktrees: invoke(C.workspaces.worktrees),
    push: invoke(C.workspaces.push),
    openPR: invoke(C.workspaces.openPR),
    rebuildMirror: invoke(C.workspaces.rebuildMirror)
  },
  terminal: {
    open: invoke(C.terminal.open),
    write: send(C.terminal.write),
    resize: send(C.terminal.resize),
    close: send(C.terminal.close),
    pasteImage: invoke(C.terminal.pasteImage),
    uploadImage: invoke(C.terminal.uploadImage)
  },
  containers: {
    open: invoke(C.containers.open),
    action: invoke(C.containers.action),
    openTerminal: invoke(C.containers.openTerminal),
    inspect: invoke(C.containers.inspect),
    resources: invoke(C.containers.resources),
    removeResource: invoke(C.containers.removeResource),
    buildHistory: invoke(C.containers.buildHistory),
    watchStats: send(C.containers.watchStats)
  },
  approval: { respond: send(C.approval.respond) },
  prefs: { get: invoke(C.prefs.get), update: invoke(C.prefs.update) },
  pushLog: { read: invoke(C.pushLog.read) },
  gitTokens: {
    list: invoke(C.gitTokens.list),
    add: invoke(C.gitTokens.add),
    replace: invoke(C.gitTokens.replace),
    setLabel: invoke(C.gitTokens.setLabel),
    remove: invoke(C.gitTokens.remove)
  },
  gitAccess: {
    status: invoke(C.gitAccess.status),
    install: invoke(C.gitAccess.install),
    remove: invoke(C.gitAccess.remove)
  },
  on(event: RemodeckEvent, cb: (...args: never[]) => void): () => void {
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
    contextBridge.exposeInMainWorld('remodeck', remodeck)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.remodeck = remodeck
}
