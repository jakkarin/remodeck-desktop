import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '../../../shared/types'
import { parseRepoInput } from '../../../shared/validate'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, TextInput } from './ui'

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
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Clone">
        <h2>Clone</h2>
        {hostIds.length > 1 && (
          <>
            <label htmlFor="clone-host">Host</label>
            <select
              id="clone-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              disabled={busy}
            >
              {hostIds.map((id) => (
                <option key={id} value={id}>
                  {hosts.find((h) => h.id === id)?.label ?? id}
                </option>
              ))}
            </select>
          </>
        )}
        {listError && <div className="error">{listError}</div>}
        {repos.length > 0 && (
          <div className="repo-list">
            {repos.map((r) => (
              <Button
                key={`${r.owner}/${r.name}`}
                className={repoInput === `${r.owner}/${r.name}` ? 'active' : ''}
                onClick={() => pick(r)}
                disabled={busy}
              >
                {r.owner}/{r.name}
              </Button>
            ))}
          </div>
        )}
        <label htmlFor="clone-repo">Repository</label>
        <TextInput
          id="clone-repo"
          value={repoInput}
          placeholder="URL or owner/name"
          onChange={(e) => changeRepo(e.target.value)}
          disabled={busy}
        />
        <label htmlFor="clone-path">Path</label>
        <TextInput
          id="clone-path"
          value={path}
          placeholder="~/repos/name"
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
        />
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !repoInput.trim() || !path.trim()}
          >
            {busy ? 'Cloning...' : 'Clone'}
          </Button>
        </div>
      </div>
    </div>
  )
}
