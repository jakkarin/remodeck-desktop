import type { BranchInfo, CommitInfo, FileChange } from '../../../shared/types'
import { PaneTitle } from './Pane'
import { CommitList } from './CommitList'
import { Banner } from './Banner'
import { rebuildAction } from './rebuildAction'
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
      <div className="flex h-full min-h-0 flex-col">
        <PaneTitle>Changes</PaneTitle>
        <div className="p-3.5 text-muted-foreground">Select a branch on the left</div>
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle title={`${branch.name} → ${branch.base.replace(/^origin\//, '')}`}>
        {`${branch.name} → ${branch.base.replace(/^origin\//, '')}`}
      </PaneTitle>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error && (
          <Banner tone="danger" action={rebuildAction(error, onRebuild)}>
            {error}
          </Banner>
        )}
        {branch.rewritten && (
          <Banner tone="warning">
            history rewritten — this branch was rewritten in the sandbox since the last Sync
          </Banner>
        )}
        {branch.ahead === 0 && commits.length === 0 ? (
          <div className="p-3.5 text-muted-foreground">No new commits compared to base</div>
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
