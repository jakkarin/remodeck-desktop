import { BookMarked, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import type { CloneProgress, Workspace } from '../../../shared/types'
import { parseRepoInput } from '../../../shared/validate'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

type GhRepo = { owner: string; name: string; defaultBranch: string }
type Source = 'github' | 'url'

const PHASE_LABEL: Record<CloneProgress['phase'], string> = {
  fetch: 'Fetching from GitHub',
  push: 'Copying to the host',
  checkout: 'Checking out'
}

const fullName = (r: GhRepo): string => `${r.owner}/${r.name}`

export function CloneDialog({
  hostIds,
  onClose,
  onCloned
}: {
  hostIds: string[]
  onClose(): void
  onCloned(w: Workspace): void
}): React.JSX.Element {
  const { hosts } = useAppState()
  const [hostId, setHostId] = useState(hostIds[0] ?? '')
  const [source, setSource] = useState<Source>('github')
  const [repos, setRepos] = useState<GhRepo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [repoInput, setRepoInput] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback((): (() => void) => {
    let live = true
    api.repos
      .listGitHub()
      .then((r) => live && setRepos(r))
      .catch((e) => {
        if (!live) return
        setRepos([])
        setListError(errorMessage(e))
        // Without the list the URL tab is the only way in.
        setSource('url')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(load, [load])

  const refresh = (): void => {
    setRepos(null)
    setListError(null)
    load()
  }

  // The last path we filled in ourselves; a path the user typed is never overwritten.
  const autoPath = useRef('')
  const setAutoPath = (name: string): void => {
    if (path !== '' && path !== autoPath.current) return
    autoPath.current = `~/repos/${name}`
    setPath(autoPath.current)
  }

  const pick = (r: GhRepo): void => {
    setRepoInput(fullName(r))
    autoPath.current = `~/repos/${r.name}`
    setPath(autoPath.current)
  }

  const changeRepo = (value: string): void => {
    setRepoInput(value)
    const parsed = parseRepoInput(value)
    if (parsed) setAutoPath(parsed.name)
  }

  const query = filter.trim().toLowerCase()
  const shown = (repos ?? []).filter((r) => fullName(r).toLowerCase().includes(query))
  const selectedIndex = shown.findIndex((r) => fullName(r) === repoInput)
  const canClone = !busy && repoInput.trim() !== '' && path.trim() !== ''

  // Keep the picked row visible when the arrow keys move past the edge of the list.
  useEffect(() => {
    if (selectedIndex < 0) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  const submit = async (): Promise<void> => {
    if (!canClone) return
    const target = path.trim()
    setBusy(true)
    setError(null)
    setProgress(null)
    const off = api.on('clone-progress', (h, p, next) => {
      if (h === hostId && p === target) setProgress(next)
    })
    try {
      onCloned(await api.workspaces.clone(hostId, repoInput.trim(), target))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    } finally {
      off()
    }
  }

  const onFilterKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void submit()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (shown.length === 0) return
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next =
      selectedIndex < 0
        ? step > 0
          ? 0
          : shown.length - 1
        : Math.min(shown.length - 1, Math.max(0, selectedIndex + step))
    pick(shown[next])
  }

  const switchSource = (s: Source): void => {
    setSource(s)
    setRepoInput('')
  }

  const percent = progress?.percent ?? 0

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="p-4 pb-3">
          <DialogTitle>Clone</DialogTitle>
          <DialogDescription>Clone a repository onto a host as a new workspace.</DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Repository source"
          className="flex gap-1 border-b border-border px-3"
        >
          {(
            [
              ['github', 'GitHub'],
              ['url', 'URL']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`clone-tab-${id}`}
              aria-selected={source === id}
              aria-controls="clone-source"
              disabled={busy}
              className={cn(
                '-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50',
                source === id && 'border-(--accent) font-medium text-foreground'
              )}
              onClick={() => switchSource(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          id="clone-source"
          role="tabpanel"
          aria-labelledby={`clone-tab-${source}`}
          className="border-b border-border p-4"
        >
          {source === 'github' ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    aria-label="Filter repositories"
                    className="pl-8"
                    value={filter}
                    placeholder="Filter your repositories"
                    onChange={(e) => setFilter(e.target.value)}
                    onKeyDown={onFilterKey}
                    disabled={busy}
                    autoFocus
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Refresh repositories"
                  onClick={refresh}
                  disabled={busy || repos === null}
                >
                  <RefreshCw className={cn(repos === null && 'animate-spin')} />
                </Button>
              </div>
              <div
                ref={listRef}
                role="listbox"
                aria-label="Your repositories"
                className="h-[192px] overflow-y-auto rounded-md border border-border [scrollbar-width:thin]"
              >
                {repos === null ? (
                  <p className="p-3 text-xs text-muted-foreground">Loading repositories…</p>
                ) : shown.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    {query ? `No repositories match "${filter.trim()}".` : 'No repositories.'}
                  </p>
                ) : (
                  shown.map((r, i) => {
                    const selected = i === selectedIndex
                    return (
                      <div
                        key={fullName(r)}
                        role="option"
                        data-index={i}
                        aria-selected={selected}
                        aria-disabled={busy || undefined}
                        onClick={() => !busy && pick(r)}
                        onDoubleClick={() => void submit()}
                        className={cn(
                          'flex h-8 cursor-default items-center gap-2 px-2.5 text-xs',
                          selected ? 'bg-selected text-selected-foreground' : 'hover:bg-accent',
                          busy && 'opacity-50'
                        )}
                      >
                        <BookMarked
                          aria-hidden="true"
                          className={cn(
                            'size-3.5 shrink-0',
                            selected ? 'text-(--accent)' : 'text-muted-foreground'
                          )}
                        />
                        <span className="truncate">
                          <span className="text-muted-foreground">{r.owner}/</span>
                          <span className={cn(selected && 'font-medium')}>{r.name}</span>
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <Field>
              <FieldLabel htmlFor="clone-repo">Repository</FieldLabel>
              <Input
                id="clone-repo"
                value={repoInput}
                placeholder="https://github.com/owner/name or owner/name"
                onChange={(e) => changeRepo(e.target.value)}
                disabled={busy}
                autoFocus
              />
              {listError && (
                <FieldDescription className="text-destructive">{listError}</FieldDescription>
              )}
            </Field>
          )}
        </div>

        <FieldGroup className="p-4">
          {hostIds.length > 1 && (
            <Field>
              <FieldLabel htmlFor="clone-host">Host</FieldLabel>
              <NativeSelect
                id="clone-host"
                className="w-full"
                value={hostId}
                onChange={(e) => setHostId(e.target.value)}
                disabled={busy}
              >
                {hostIds.map((id) => (
                  <NativeSelectOption key={id} value={id}>
                    {hosts.find((h) => h.id === id)?.label ?? id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="clone-path">Path</FieldLabel>
            <Input
              id="clone-path"
              className="font-mono"
              value={path}
              placeholder="~/repos/name"
              onChange={(e) => setPath(e.target.value)}
              disabled={busy}
            />
            <FieldDescription>Filled from the repo name until you edit it.</FieldDescription>
          </Field>
          {busy && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {progress ? PHASE_LABEL[progress.phase] : 'Starting'}…
                </span>
                <span className="font-medium tabular-nums">{percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Clone progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-(--accent) transition-[width] duration-200 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <DialogFooter className="px-4 pb-4">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canClone}>
            {busy ? `Cloning ${percent}%` : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
