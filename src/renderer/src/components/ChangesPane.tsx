import type { BaseBranchInfo, BranchInfo, CommitInfo, FileChange } from '../../../shared/types'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from './ui/combobox'
import { PaneTitle } from './Pane'
import { CommitList } from './CommitList'
import { Banner } from './Banner'
import { rebuildAction } from './rebuildAction'
import { FileList } from './FileList'
import { PushBar } from './PushBar'

export function ChangesPane({
  workspaceId,
  branch,
  baseBranches = [],
  baseBranch,
  commits,
  files,
  commit,
  file,
  connected,
  error,
  onSelectCommit,
  onSelectBaseBranch,
  onSelectFile,
  onRebuild
}: {
  workspaceId: string
  branch: BranchInfo | null
  baseBranches?: BaseBranchInfo[]
  baseBranch?: string | null
  onSelectBaseBranch?(name: string): void
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
  const base = baseBranch ?? branch.base.replace(/^origin\//, '')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle title={`${branch.name} → ${base}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{branch.name}</span>
          <span aria-hidden="true">→</span>
          <Combobox
            key={JSON.stringify([workspaceId, branch.name])}
            items={baseBranches.map((b) => b.name)}
            value={base}
            onValueChange={(name) => {
              if (name !== null) onSelectBaseBranch?.(name)
            }}
            disabled={!onSelectBaseBranch || baseBranches.length === 0}
          >
            <ComboboxInput
              aria-label="Compare against branch"
              title={`Compare against origin/${base}`}
              placeholder="Search branches…"
              className="min-w-0 max-w-52 flex-1"
            />
            <ComboboxContent>
              <ComboboxEmpty>No branches found.</ComboboxEmpty>
              <ComboboxList aria-label="Origin branches">
                {(name: string) => (
                  <ComboboxItem key={name} value={name} className="pr-8">
                    <span className="truncate" title={name}>
                      {name}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </span>
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
        {commits.length === 0 && files.length === 0 && !error ? (
          <div className="p-3.5 text-muted-foreground">No new commits compared to base</div>
        ) : (
          <>
            <CommitList commits={commits} selected={commit} onSelect={onSelectCommit} />
            <FileList
              key={JSON.stringify([branch.name, base, commit])}
              files={files}
              selected={file}
              onSelect={onSelectFile}
            />
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
