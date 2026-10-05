import type { BranchInfo, CommitInfo, FileChange } from '../../../shared/types'
import { CommitList } from './CommitList'
import { ErrorBanner } from './ErrorBanner'
import { FileList } from './FileList'
import { PushBar } from './PushBar'

export function ChangesPane({
  workspaceId,
  branch,
  commits,
  files,
  commit,
  file,
  connected,
  error,
  onSelectCommit,
  onSelectFile,
  onRebuild
}: {
  workspaceId: string
  branch: BranchInfo | null
  commits: CommitInfo[]
  files: FileChange[]
  commit: string | null
  file: string | null
  connected: boolean
  error: string | null
  onSelectCommit(sha: string | null): void
  onSelectFile(path: string): void
  onRebuild(): void
}): React.JSX.Element {
  if (!branch) {
    return (
      <div className="pane">
        <div className="pane-header">Changes</div>
        <div className="muted pad">เลือก branch ทางซ้าย</div>
      </div>
    )
  }
  return (
    <div className="pane changes-pane">
      <div className="pane-header">{`${branch.name} → ${branch.base.replace(/^origin\//, '')}`}</div>
      <div className="pane-scroll">
        {error && <ErrorBanner message={error} onRebuild={onRebuild} />}
        {branch.rewritten && (
          <div className="badge warn banner">
            history rewritten — branch นี้ถูกเขียนประวัติใหม่ใน sandbox ตั้งแต่ Sync ครั้งก่อน
          </div>
        )}
        {branch.ahead === 0 && commits.length === 0 ? (
          <div className="muted pad">ไม่มี commit ใหม่เทียบกับ base</div>
        ) : (
          <>
            <CommitList commits={commits} selected={commit} onSelect={onSelectCommit} />
            <FileList files={files} selected={file} onSelect={onSelectFile} />
          </>
        )}
      </div>
      <PushBar
        key={`${workspaceId}|${branch.name}`}
        workspaceId={workspaceId}
        branch={branch}
        connected={connected}
      />
    </div>
  )
}
