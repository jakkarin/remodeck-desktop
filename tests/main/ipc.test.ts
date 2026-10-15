import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, SEND_CHANNELS, type MainApi } from '../../src/shared/ipc'
import { registerHandlers, type IpcMainLike } from '../../src/main/ipc/handlers'

type Listener = (event: unknown, ...args: unknown[]) => unknown

function fakeIpcMain(): IpcMainLike & {
  handled: Map<string, Listener[]>
  listened: Map<string, Listener[]>
} {
  const handled = new Map<string, Listener[]>()
  const listened = new Map<string, Listener[]>()
  const add = (m: Map<string, Listener[]>, ch: string, l: Listener): void => {
    m.set(ch, [...(m.get(ch) ?? []), l])
  }
  return {
    handled,
    listened,
    handle: (ch, l) => add(handled, ch, l as Listener),
    on: (ch, l) => add(listened, ch, l as Listener)
  }
}

function fakeApi(): MainApi {
  const fn = (): ReturnType<typeof vi.fn> => vi.fn(async () => undefined)
  return {
    hosts: {
      list: fn(),
      add: fn(),
      update: fn(),
      remove: fn(),
      status: fn(),
      connect: fn(),
      probeGit: fn(),
      probeDocker: fn(),
      disconnect: fn()
    },
    repos: { listGitHub: fn(), list: fn(), updatePolicy: fn() },
    workspaces: {
      list: fn(),
      clone: fn(),
      inspectExisting: fn(),
      addExisting: fn(),
      remove: fn(),
      sync: fn(),
      branches: fn(),
      baseBranches: fn(),
      commits: fn(),
      files: fn(),
      setActive: vi.fn(),
      diff: fn(),
      worktrees: fn(),
      push: fn(),
      openPR: fn(),
      rebuildMirror: fn()
    },
    terminal: {
      open: fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      pasteImage: fn(),
      uploadImage: fn()
    },
    containers: {
      open: fn(),
      action: fn(),
      openTerminal: fn(),
      inspect: fn(),
      resources: fn(),
      removeResource: fn(),
      buildHistory: fn(),
      watchStats: vi.fn()
    },
    approval: { respond: vi.fn() },
    prefs: { get: fn(), update: fn() },
    pushLog: { read: fn() },
    gitTokens: { list: fn(), add: fn(), replace: fn(), setLabel: fn(), remove: fn() },
    gitAccess: { status: fn(), install: fn(), remove: fn() }
  } as unknown as MainApi
}

const methodChannels = (): string[] =>
  Object.entries(IPC_CHANNELS)
    .filter(([group]) => group !== 'events')
    .flatMap(([, methods]) => Object.values(methods as Record<string, string>))

describe('IPC contract', () => {
  it('channel names are <group>:<method> and unique', () => {
    const all = Object.values(IPC_CHANNELS).flatMap((g) =>
      Object.values(g as Record<string, string>)
    )
    expect(new Set(all).size).toBe(all.length)
    for (const [group, methods] of Object.entries(IPC_CHANNELS)) {
      for (const [method, ch] of Object.entries(methods as Record<string, string>)) {
        expect(ch).toBe(group === 'events' ? `event:${method}` : `${group}:${method}`)
      }
    }
  })

  it('registerHandlers covers every method channel exactly once and no event channel', () => {
    const ipc = fakeIpcMain()
    registerHandlers(ipc, fakeApi())
    const registered = [...ipc.handled.entries(), ...ipc.listened.entries()].flatMap(([ch, ls]) =>
      ls.map(() => ch)
    )
    expect(registered.sort()).toEqual(methodChannels().sort())
  })

  it('fire-and-forget methods use ipcMain.on, the rest ipcMain.handle', () => {
    const ipc = fakeIpcMain()
    registerHandlers(ipc, fakeApi())
    expect([...ipc.listened.keys()].sort()).toEqual(
      [
        IPC_CHANNELS.workspaces.setActive,
        IPC_CHANNELS.terminal.write,
        IPC_CHANNELS.terminal.resize,
        IPC_CHANNELS.terminal.close,
        IPC_CHANNELS.containers.watchStats,
        IPC_CHANNELS.approval.respond
      ].sort()
    )
    expect(ipc.listened.has('workspaces:setActive')).toBe(true)
    expect(IPC_CHANNELS.events['workspace-synced']).toBe('event:workspace-synced')
    expect([...SEND_CHANNELS].sort()).toEqual([...ipc.listened.keys()].sort())
  })

  it('dispatches arguments to the matching api method (event object dropped)', async () => {
    const ipc = fakeIpcMain()
    const api = fakeApi()
    registerHandlers(ipc, api)
    await ipc.handled.get(IPC_CHANNELS.workspaces.push)![0]({}, 'ws1', 'feat/a', 'feat/a')
    expect(api.workspaces.push).toHaveBeenCalledWith('ws1', 'feat/a', 'feat/a')
    ipc.listened.get(IPC_CHANNELS.terminal.resize)![0]({}, 't1', 120, 40)
    expect(api.terminal.resize).toHaveBeenCalledWith('t1', 120, 40)
    ipc.listened.get(IPC_CHANNELS.approval.respond)![0]({}, 'r1', 'once')
    expect(api.approval.respond).toHaveBeenCalledWith('r1', 'once')
  })

  it('registers the git token and git access channels', () => {
    const ipc = fakeIpcMain()
    registerHandlers(ipc, fakeApi())
    for (const ch of [
      'gitTokens:list',
      'gitTokens:add',
      'gitTokens:replace',
      'gitTokens:setLabel',
      'gitTokens:remove',
      'gitAccess:status',
      'gitAccess:install',
      'gitAccess:remove'
    ]) {
      expect(ipc.handled.has(ch)).toBe(true)
    }
  })

  it('throws when the api lacks the gitTokens group', () => {
    const api = fakeApi() as unknown as Record<string, unknown>
    delete api.gitTokens
    expect(() => registerHandlers(fakeIpcMain(), api as unknown as MainApi)).toThrow(
      'MainApi is missing gitTokens.list'
    )
  })
})
