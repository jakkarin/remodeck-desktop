import { useEffect, useRef, useState } from 'react'
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
import { cn } from 'cn'
import { Field, FieldDescription, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

type GhRepo = { owner: string; name: string; defaultBranch: string }

const PHASE_LABEL: Record<CloneProgress['phase'], string> = {
  fetch: 'Fetching from GitHub',
  push: 'Copying to the host',
  checkout: 'Checking out'
}

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
  const [repos, setRepos] = useState<GhRepo[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [repoInput, setRepoInput] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)

  useEffect(() => {
    let live = true
    api.repos
      .listGitHub()
      .then((r) => live && setRepos(r))
      .catch((e) => live && setListError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [])

  // The last path we filled in ourselves; a path the user typed is never overwritten.
  const autoPath = useRef('')
  const setAutoPath = (name: string): void => {
    if (path !== '' && path !== autoPath.current) return
    autoPath.current = `~/repos/${name}`
    setPath(autoPath.current)
  }

  const pick = (r: GhRepo): void => {
    setRepoInput(`${r.owner}/${r.name}`)
    autoPath.current = `~/repos/${r.name}`
    setPath(autoPath.current)
  }

  const changeRepo = (value: string): void => {
    setRepoInput(value)
    const parsed = parseRepoInput(value)
    if (parsed) setAutoPath(parsed.name)
  }

  const submit = async (): Promise<void> => {
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

  // While the input is not exactly one of the repos, it filters the list.
  const query = repoInput.trim().toLowerCase()
  const exact = repos.some((r) => `${r.owner}/${r.name}`.toLowerCase() === query)
  const shown =
    exact || !query
      ? repos
      : repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(query))
  const percent = progress?.percent ?? 0

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone</DialogTitle>
          <DialogDescription>Clone a repository onto a host as a new workspace.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
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
            <FieldLabel htmlFor="clone-repo">Repository</FieldLabel>
            <Input
              id="clone-repo"
              value={repoInput}
              placeholder="URL or owner/name"
              onChange={(e) => changeRepo(e.target.value)}
              disabled={busy}
            />
            {listError && (
              <FieldDescription className="text-destructive">{listError}</FieldDescription>
            )}
            {shown.length > 0 && (
              <div
                role="group"
                aria-label="Your GitHub repositories"
                className="mt-1 flex max-h-[84px] flex-wrap gap-1.5 overflow-y-auto [scrollbar-width:thin]"
              >
                {shown.map((r) => {
                  const full = `${r.owner}/${r.name}`
                  const selected = repoInput === full
                  return (
                    <button
                      key={full}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => pick(r)}
                      disabled={busy}
                      className={cn(
                        'h-6 rounded-md border px-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                        selected
                          ? 'border-(--accent) bg-selected text-(--accent)'
                          : 'border-border bg-background text-foreground/80 hover:bg-accent'
                      )}
                    >
                      {full}
                    </button>
                  )
                })}
              </div>
            )}
          </Field>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !repoInput.trim() || !path.trim()}
          >
            {busy ? `Cloning ${percent}%` : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
