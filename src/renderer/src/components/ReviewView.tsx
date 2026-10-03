import { useEffect, useState } from 'react'
import type { BranchInfo, CommitInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'

function diffClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del'
  if (line.startsWith('@@')) return 'diff-hunk'
  return ''
}

export function ReviewView({
  workspaceId,
  branch,
  onBack
}: {
  workspaceId: string
  branch: BranchInfo
  onBack(): void
}): React.JSX.Element {
  const { hosts, workspaces } = useAppState()
  const ws = workspaces.find((w) => w.id === workspaceId)
  const host = hosts.find((h) => h.id === ws?.hostId)

  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [diff, setDiff] = useState('')
  const [target, setTarget] = useState(branch.name)
  const [busy, setBusy] = useState(false)
  // Tied to the target that was pushed: editing the target makes Open PR depend on it again.
  const [pushedTarget, setPushedTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.workspaces
      .commits(workspaceId, branch.name)
      .then((c) => live && setCommits(c))
      .catch((e) => live && setError(errorMessage(e)))
    api.workspaces
      .diff(workspaceId, branch.name)
      .then((d) => live && setDiff(d))
      .catch((e) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [workspaceId, branch.name])

  const pushed = pushedTarget !== null && pushedTarget === target
  const onGitHub = branch.base === `origin/${target}`
  const canOpenPR = pushed || onGitHub

  async function push(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const out = await api.workspaces.push(workspaceId, branch.name, target)
      if (out.ok) setPushedTarget(target)
      else setError(out.message)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function openPR(): Promise<void> {
    setError(null)
    try {
      await api.workspaces.openPR(workspaceId, target)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="review">
      <div className="toolbar">
        <button onClick={onBack}>Back</button>
        <h2>{branch.name}</h2>
      </div>
      <div className="muted">
        จาก {host?.label}:{ws?.sandboxPath}
      </div>
      {branch.rewritten && (
        <div className="badge warn">
          history rewritten — branch นี้ถูกเขียนประวัติใหม่ใน sandbox ตั้งแต่ Sync ครั้งก่อน
        </div>
      )}

      <h3>Commits</h3>
      <ul className="commits">
        {commits.map((c) => (
          <li key={c.sha}>
            <code>{c.sha.slice(0, 7)}</code> <span>{c.subject}</span>{' '}
            <span className="muted">
              {c.author} · {c.date}
            </span>
          </li>
        ))}
      </ul>

      <h3>Diff</h3>
      <pre className="diff">
        {diff.split('\n').map((line, i) => (
          <div key={i} className={diffClass(line)}>
            {line}
          </div>
        ))}
      </pre>

      <div className="toolbar">
        <label>
          Target branch
          <input value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !target} onClick={() => void push()}>
          Push to GitHub
        </button>
        <button disabled={!canOpenPR} onClick={() => void openPR()}>
          Open PR
        </button>
      </div>
      {pushed && <div className="ok">Pushed</div>}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
