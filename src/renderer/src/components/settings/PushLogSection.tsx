import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PushLogEntry } from '../../../../shared/types'
import { api, errorMessage } from '../../api'
import { Badge, Button } from '../ui'

const resultTone = (r: PushLogEntry['result']): 'success' | 'warning' | 'danger' =>
  r === 'ok' ? 'success' : r === 'denied' ? 'warning' : 'danger'

export function PushLogSection(): React.JSX.Element {
  const [log, setLog] = useState<PushLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [repoFilter, setRepoFilter] = useState('')

  const load = useCallback(async (): Promise<void> => {
    try {
      setLog(await api.pushLog.read(200))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    // load is async: state is set after awaiting IPC, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const repos = [...new Set(log.map((e) => e.repo))].sort()
  const shown = repoFilter ? log.filter((e) => e.repo === repoFilter) : log

  return (
    <section className="settings-section settings-log">
      <div className="settings-log-bar">
        <h3>Push log</h3>
        <span className="topbar-spacer" />
        <label className="inline">
          Repo{' '}
          <select
            className="ui-input"
            aria-label="Filter by repo"
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
          >
            <option value="">All</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </Button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="settings-log-scroll">
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
            {shown.map((e, i) => (
              <tr key={`${e.time}:${i}`}>
                <td className="nowrap" title={e.time}>
                  {new Date(e.time).toLocaleString()}
                </td>
                <td>{e.repo}</td>
                <td>{e.channel}</td>
                <td className="refs">{e.updates.map((u) => u.ref).join(', ')}</td>
                <td className="nowrap">
                  <Badge tone={resultTone(e.result)} className="nowrap">
                    {e.result}
                  </Badge>
                </td>
                <td>{e.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
