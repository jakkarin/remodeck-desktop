import { useEffect, useState } from 'react'
import type { Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'

type GhRepo = { owner: string; name: string; defaultBranch: string }

export function CloneDialog({
  hostId,
  onClose,
  onCloned
}: {
  hostId: string
  onClose(): void
  onCloned(w: Workspace): void
}): React.JSX.Element {
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

  const pick = (r: GhRepo): void => {
    setRepoInput(`${r.owner}/${r.name}`)
    setPath(`~/repos/${r.name}`)
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
        {listError && <div className="error">{listError}</div>}
        {repos.length > 0 && (
          <div className="repo-list">
            {repos.map((r) => (
              <button
                key={`${r.owner}/${r.name}`}
                className={repoInput === `${r.owner}/${r.name}` ? 'active' : ''}
                onClick={() => pick(r)}
                disabled={busy}
              >
                {r.owner}/{r.name}
              </button>
            ))}
          </div>
        )}
        <label htmlFor="clone-repo">Repository</label>
        <input
          id="clone-repo"
          value={repoInput}
          placeholder="URL or owner/name"
          onChange={(e) => setRepoInput(e.target.value)}
          disabled={busy}
        />
        <label htmlFor="clone-path">Path</label>
        <input
          id="clone-path"
          value={path}
          placeholder="~/repos/name"
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
        />
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !repoInput.trim() || !path.trim()}
          >
            {busy ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  )
}
