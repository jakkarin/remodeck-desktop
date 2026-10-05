import { useCallback, useEffect, useState } from 'react'
import type { PushLogEntry, Repo } from '../../../shared/types'
import type { RepoPolicyPatch } from '../../../shared/ipc'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, TextInput } from './ui'

function parseBranches(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

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

export function SettingsView(): React.JSX.Element {
  const { repos } = useAppState()
  const [log, setLog] = useState<PushLogEntry[]>([])
  const [logError, setLogError] = useState<string | null>(null)

  const loadLog = useCallback(async (): Promise<void> => {
    try {
      setLog(await api.pushLog.read(200))
      setLogError(null)
    } catch (e) {
      setLogError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    // loadLog is async: state is set after awaiting IPC, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLog()
  }, [loadLog])

  return (
    <div className="settings">
      <h2>Settings</h2>
      {repos.length === 0 && <p className="dim">No repos yet.</p>}
      {repos.map((r) => (
        <RepoSettings key={`${r.id}:${r.protectedBranches.join(',')}`} repo={r} />
      ))}
      <h3>Push log</h3>
      {logError && <div className="error">{logError}</div>}
      <table className="push-log">
        <thead>
          <tr>
            <th>Time</th>
            <th>Repo</th>
            <th>Channel</th>
            <th>Refs</th>
            <th>Result</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {log.map((e, i) => (
            <tr key={`${e.time}:${i}`}>
              <td>{e.time}</td>
              <td>{e.repo}</td>
              <td>{e.channel}</td>
              <td>{e.updates.map((u) => u.ref).join(', ')}</td>
              <td>{e.result}</td>
              <td>{e.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
