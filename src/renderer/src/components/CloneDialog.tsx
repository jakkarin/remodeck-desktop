import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '../../../shared/types'
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
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

type GhRepo = { owner: string; name: string; defaultBranch: string }

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
    setBusy(true)
    setError(null)
    try {
      onCloned(await api.workspaces.clone(hostId, repoInput.trim(), path.trim()))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

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
          {listError && (
            <Alert variant="destructive">
              <AlertDescription>{listError}</AlertDescription>
            </Alert>
          )}
          {repos.length > 0 && (
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {repos.map((r) => {
                const full = `${r.owner}/${r.name}`
                const selected = repoInput === full
                return (
                  <Button
                    key={full}
                    variant={selected ? 'secondary' : 'outline'}
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => pick(r)}
                    disabled={busy}
                  >
                    {full}
                  </Button>
                )
              })}
            </div>
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
          </Field>
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
            {busy ? 'Cloning...' : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
