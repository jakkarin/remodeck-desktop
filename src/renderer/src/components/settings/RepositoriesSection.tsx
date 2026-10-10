import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import type { Repo } from '../../../../shared/types'
import type { RepoPolicyPatch } from '../../../../shared/ipc'
import { api, errorMessage } from '../../api'
import { useAppState } from '../../state'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { parseBranches } from './parseBranches'
import { FormError, Row, SectionHeader } from './SettingsParts'

const workspaceCount = (n: number): string => `${n} ${n === 1 ? 'workspace' : 'workspaces'}`

function RepoDetails({ repo }: { repo: Repo }): React.JSX.Element {
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
  const branchesId = `protected-branches-${repo.id}`
  return (
    <>
      <Row
        className="border-t"
        title="Enforce rules"
        description="Block pushes to protected branches."
      >
        <Switch
          aria-label={`Enforce rules for ${name}`}
          checked={repo.enforceRules}
          onCheckedChange={(checked) => void update({ enforceRules: checked })}
        />
      </Row>
      <div className="flex flex-col gap-1.5 border-t px-4 py-3">
        <Label htmlFor={branchesId}>Protected branches</Label>
        <Input
          id={branchesId}
          aria-label={`Protected branches for ${name}`}
          value={branches}
          onChange={(e) => setBranches(e.target.value)}
          onBlur={commitBranches}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitBranches()
          }}
        />
        <span className="text-xs text-muted-foreground">Comma-separated.</span>
      </div>
      <Row
        className="border-t"
        title="Always allow push"
        description={
          repo.alwaysAllowPush
            ? 'On. Set from a push approval; the Git Bridge will not ask for this repo.'
            : 'Off. Each Git Bridge push asks first.'
        }
      >
        {repo.alwaysAllowPush && (
          <Button variant="outline" onClick={() => void update({ alwaysAllowPush: false })}>
            Revoke
          </Button>
        )}
      </Row>
      {error && (
        <div className="px-4 pb-3">
          <FormError>{error}</FormError>
        </div>
      )}
    </>
  )
}

export function RepositoriesSection({
  initialRepoId
}: {
  initialRepoId?: string
}): React.JSX.Element {
  const { repos, workspaces } = useAppState()
  const [selectedId, setSelectedId] = useState<string | undefined>(initialRepoId)
  const selected = repos.find((r) => r.id === selectedId) ?? repos[0]

  if (!selected) {
    return (
      <>
        <SectionHeader title="Repositories" />
        <p className="m-0 text-xs text-muted-foreground">No repos yet.</p>
      </>
    )
  }
  return (
    <>
      <SectionHeader
        title="Repositories"
        description="Push rules per repo. They apply to Review and to the Git Bridge."
      />
      {repos.map((r) => {
        const open = r.id === selected.id
        const count = workspaces.filter((w) => w.repoId === r.id).length
        return (
          <section
            key={r.id}
            aria-labelledby={`repo-h-${r.id}`}
            className="rounded-xl border bg-background"
          >
            <div className="flex items-center gap-2 px-4 py-3">
              <h2 id={`repo-h-${r.id}`} className="m-0 min-w-0 flex-1 text-sm font-semibold">
                <button
                  type="button"
                  aria-expanded={open}
                  className="max-w-full truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => setSelectedId(r.id)}
                >
                  {r.owner}/{r.name}
                </button>
              </h2>
              <span className="text-xs text-muted-foreground">{workspaceCount(count)}</span>
              {!open && !r.enforceRules && (
                <span className="text-xs text-muted-foreground">Rules off</span>
              )}
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn('text-muted-foreground', open && 'rotate-180')}
              />
            </div>
            {open && <RepoDetails key={`${r.id}:${r.protectedBranches.join(',')}`} repo={r} />}
          </section>
        )
      })}
    </>
  )
}
