import { useCallback, useEffect, useRef, useState } from 'react'
import type { BranchInfo, CommitInfo, FileChange, WorktreeInfo } from '../../shared/types'
import { api, errorMessage } from './api'
import { isNew, loadSeen, markBaseline, markSeen, saveSeen, type SeenMap } from './seen'

type DiffState = { key: string; text: string; error?: string }

type Data = {
  ws: string
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  branchName: string | null
  commit: string | null
  file: string | null
  commits: CommitInfo[]
  files: FileChange[]
  diff: DiffState | null
  branchesError: string | null
  changesError: string | null
}

const initial = (ws: string): Data => ({
  ws,
  branches: [],
  worktrees: [],
  branchName: null,
  commit: null,
  file: null,
  commits: [],
  files: [],
  diff: null,
  branchesError: null,
  changesError: null
})

const CLEARED = {
  branchName: null,
  commit: null,
  file: null,
  commits: [],
  files: [],
  diff: null,
  changesError: null
}

export type WorkspaceData = {
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  branch: BranchInfo | null
  commit: string | null
  file: FileChange | null
  commits: CommitInfo[]
  files: FileChange[]
  diffText: string | null
  diffError: string | null
  branchesError: string | null
  changesError: string | null
  isNew(b: BranchInfo): boolean
  selectBranch(name: string): void
  selectCommit(sha: string | null): void
  selectFile(path: string): void
  reload(): Promise<void>
}

/**
 * Selection and fetched data of one workspace. All state is tagged with the workspace id and thrown away
 * when it changes, so the component hosting this hook (and the terminal docked below it) is never remounted.
 * Every async load is guarded so only the latest selection writes state.
 */
export function useWorkspaceData(workspaceId: string, connected: boolean): WorkspaceData {
  const [state, setState] = useState<Data>(() => initial(workspaceId))
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen())
  const seenRef = useRef(seen)
  const request = useRef(0)

  const data = state.ws === workspaceId ? state : initial(workspaceId)
  const update = useCallback(
    (fn: (d: Data) => Data): void =>
      setState((prev) => fn(prev.ws === workspaceId ? prev : initial(workspaceId))),
    [workspaceId]
  )

  const branch = data.branches.find((b) => b.name === data.branchName) ?? null
  const branchName = branch?.name ?? null
  const branchSha = branch?.sha ?? null

  const reload = useCallback(async (): Promise<void> => {
    const req = ++request.current
    try {
      const [list, wts] = await Promise.all([
        api.workspaces.branches(workspaceId),
        connected ? api.workspaces.worktrees(workspaceId).catch(() => []) : Promise.resolve([])
      ])
      if (req !== request.current) return
      const next = markBaseline(seenRef.current, workspaceId, list)
      if (next !== seenRef.current) {
        seenRef.current = next
        saveSeen(next)
        setSeen(next)
      }
      update((d) => {
        const gone = d.branchName !== null && !list.some((b) => b.name === d.branchName)
        return {
          ...d,
          branches: list,
          worktrees: wts,
          branchesError: null,
          ...(gone ? CLEARED : {})
        }
      })
    } catch (e) {
      if (req === request.current) update((d) => ({ ...d, branchesError: errorMessage(e) }))
    }
  }, [workspaceId, connected, update])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(
    () =>
      api.on('workspace-synced', (id) => {
        if (id === workspaceId) void reload()
      }),
    [workspaceId, reload]
  )

  useEffect(() => {
    if (!branchName) return
    let live = true
    api.workspaces
      .commits(workspaceId, branchName)
      .then((commits) => live && update((d) => ({ ...d, commits })))
      .catch((e) => live && update((d) => ({ ...d, changesError: errorMessage(e) })))
    return () => {
      live = false
    }
  }, [workspaceId, branchName, branchSha, update])

  useEffect(() => {
    if (!branchName) return
    let live = true
    const req = data.commit
      ? api.workspaces.files(workspaceId, branchName, data.commit)
      : api.workspaces.files(workspaceId, branchName)
    req
      .then(
        (files) =>
          live &&
          update((d) => ({
            ...d,
            files,
            changesError: null,
            file: files.some((f) => f.path === d.file) ? d.file : (files[0]?.path ?? null)
          }))
      )
      .catch((e) => live && update((d) => ({ ...d, changesError: errorMessage(e) })))
    return () => {
      live = false
    }
  }, [workspaceId, branchName, branchSha, data.commit, update])

  const diffKey = `${branchName}|${data.commit ?? ''}|${data.file}`
  useEffect(() => {
    if (!branchName || !data.file) return
    let live = true
    const key = diffKey
    const opts = data.commit ? { commit: data.commit, file: data.file } : { file: data.file }
    api.workspaces
      .diff(workspaceId, branchName, opts)
      .then((text) => live && update((d) => ({ ...d, diff: { key, text } })))
      .catch(
        (e) => live && update((d) => ({ ...d, diff: { key, text: '', error: errorMessage(e) } }))
      )
    return () => {
      live = false
    }
  }, [workspaceId, branchName, branchSha, data.commit, data.file, diffKey, update])

  const selectBranch = (name: string): void => {
    const b = data.branches.find((x) => x.name === name)
    if (!b) return
    const next = markSeen(seenRef.current, workspaceId, b)
    seenRef.current = next
    saveSeen(next)
    setSeen(next)
    update((d) => ({ ...d, ...CLEARED, branchName: name }))
  }

  const diff = data.diff?.key === diffKey ? data.diff : null
  return {
    branches: data.branches,
    worktrees: data.worktrees,
    branch,
    commit: data.commit,
    file: data.files.find((f) => f.path === data.file) ?? null,
    commits: data.commits,
    files: data.files,
    diffText: diff && !diff.error ? diff.text : null,
    diffError: diff?.error ?? null,
    branchesError: data.branchesError,
    changesError: data.changesError,
    isNew: (b) => isNew(seen, workspaceId, b),
    selectBranch,
    selectCommit: (sha) => update((d) => ({ ...d, commit: sha, file: null, files: [] })),
    selectFile: (path) => update((d) => ({ ...d, file: path })),
    reload
  }
}
