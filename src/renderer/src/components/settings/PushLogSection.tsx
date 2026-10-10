import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PushLogEntry } from '../../../../shared/types'
import { api, errorMessage } from '../../api'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { NativeSelect } from '@renderer/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import { FormError, SectionHeader } from './SettingsParts'

const resultVariant = (r: PushLogEntry['result']): 'success' | 'warning' | 'destructive' =>
  r === 'ok' ? 'success' : r === 'denied' ? 'warning' : 'destructive'

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
    <>
      <SectionHeader
        title="Push log"
        description="Every push that went through this PC, from Review or the Git Bridge."
        actions={
          <>
            <Label className="flex items-center gap-2">
              Repo
              <NativeSelect
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
              </NativeSelect>
            </Label>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" /> Refresh
            </Button>
          </>
        }
      />
      {error && <FormError>{error}</FormError>}
      <div className="rounded-xl border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Repo</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Refs</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e, i) => (
              <TableRow key={`${e.time}:${i}`} className="align-top">
                <TableCell title={e.time}>{new Date(e.time).toLocaleString()}</TableCell>
                <TableCell className="break-all whitespace-normal">{e.repo}</TableCell>
                <TableCell>{e.channel}</TableCell>
                <TableCell className="font-mono break-all whitespace-normal">
                  {e.updates.map((u) => u.ref).join(', ')}
                </TableCell>
                <TableCell>
                  <Badge variant={resultVariant(e.result)}>{e.result}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {e.detail ?? ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
