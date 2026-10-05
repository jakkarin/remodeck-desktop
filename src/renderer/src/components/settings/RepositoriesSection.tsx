import { useState } from 'react'
import type { Repo } from '../../../../shared/types'
import type { RepoPolicyPatch } from '../../../../shared/ipc'
import { api, errorMessage } from '../../api'
import { useAppState } from '../../state'
import { Button, TextInput } from '../ui'
import { parseBranches } from './parseBranches'

function RepoSettings({ repo }: { repo: Repo }): React.JSX.Element {
  const { refresh } = useAppState()
  const [branches, setBranches] = useState(repo.protectedBranches.join(', '))
  const [error, setError] = useState<string | null>(null)

  async function update(patch: RepoPolicyPatch): Promise<void> {
    setError(null)
    try {
      await api.repos.updatePolicy(repo.id, patch)
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function commitBranches(): void {
    const next = parseBranches(branches)
    if (next.join(',') === repo.protectedBranches.join(',')) return
    void update({ protectedBranches: next })
  }

  const name = `${repo.owner}/${repo.name}`
  return (
    <section className="settings-repo">
      <h3>{name}</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={repo.enforceRules}
          onChange={(e) => void update({ enforceRules: e.target.checked })}
        />{' '}
        Enforce rules
      </label>
      <label>
        Protected branches (comma-separated){' '}
        <TextInput
          aria-label={`Protected branches for ${name}`}
          value={branches}
          onChange={(e) => setBranches(e.target.value)}
          onBlur={commitBranches}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitBranches()
          }}
        />
      </label>
      <div>
        Always allow push: {repo.alwaysAllowPush ? 'on' : 'off'}{' '}
        {repo.alwaysAllowPush && (
          <Button onClick={() => void update({ alwaysAllowPush: false })}>Revoke</Button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </section>
  )
}

export function RepositoriesSection({
  initialRepoId
}: {
  initialRepoId?: string
}): React.JSX.Element {
  const { repos } = useAppState()
  const [selectedId, setSelectedId] = useState<string | undefined>(initialRepoId)
  const selected = repos.find((r) => r.id === selectedId) ?? repos[0]

  if (!selected) {
    return (
      <section className="settings-section">
        <h3>Repositories</h3>
        <p className="dim">No repos yet.</p>
      </section>
    )
  }
  return (
    <section className="settings-section settings-repos">
      <ul className="settings-repo-list" aria-label="Repositories">
        {repos.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={r.id === selected.id ? 'active' : undefined}
              aria-current={r.id === selected.id ? 'true' : undefined}
              onClick={() => setSelectedId(r.id)}
            >
              {r.owner}/{r.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="settings-repo-detail">
        <RepoSettings
          key={`${selected.id}:${selected.protectedBranches.join(',')}`}
          repo={selected}
        />
      </div>
    </section>
  )
}
