import { useCallback, useEffect, useState } from 'react'
import {
  compareScopes,
  scopeKey,
  type GitAccessStatus,
  type GitToken
} from '../../../shared/gitAccess'
import type { Host } from '../../../shared/types'
import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useOpenSettings } from '../settingsOpener'
import { useAppState } from '../state'
import { ConfirmDanger } from './ConfirmDanger'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'

const WARNING =
  'Tokens are stored in plain text on this host. Anything running as this user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval.'
const INSTALL_RETRY = ' Try Update host again or Remove from host.'
const ORPHAN = 'A removed token is still on this host. Update host or Remove from host deletes it.'
const PROTECTION =
  "Real protection on the host comes from each token's scope and expiry and from GitHub rulesets, because Git Bridge rules don't apply to agents pushing directly."
const PATH_QUESTION = 'Add ~/.local/bin to PATH in ~/.bashrc so non-login shells use the gh wrapper'
const PATH_BLOCK_ROWS = {
  present: 'PATH line in ~/.bashrc added by remodeck',
  symlink:
    "~/.bashrc is a symlink, so remodeck didn't edit it. Put ~/.local/bin first in PATH yourself",
  partial: '~/.bashrc has an incomplete remodeck PATH block. Fix it by hand',
  absent: null
} as const
const HELPER_QUESTION =
  "Ask remodeck's credential helper before the others (they stay as fallback for repos without a remodeck token)"
const HELPER_MISSING =
  "A credential helper reset later in the git config hides remodeck's helper. Update host with the option below ticked"

function StatusRow({
  tone = 'ok',
  children
}: {
  tone?: 'ok' | 'warn' | 'bad'
  children: React.ReactNode
}): React.JSX.Element {
  const Icon = tone === 'ok' ? CheckIcon : TriangleAlertIcon
  const color =
    tone === 'ok' ? 'text-success' : tone === 'warn' ? 'text-warning' : 'text-destructive'
  return (
    <li className={`flex items-start gap-2 ${tone === 'ok' ? '' : color}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
      <span>{children}</span>
    </li>
  )
}

function StatusRows({ status }: { status: GitAccessStatus }): React.JSX.Element {
  const { cli, wrapper } = status
  return (
    <ul aria-label="Git access status" className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs">
      <StatusRow tone={status.helperInstalled ? 'ok' : 'warn'}>
        {status.helperInstalled ? 'Credential helper installed' : 'Credential helper missing'}
      </StatusRow>
      <StatusRow tone={status.includeActive ? 'ok' : 'warn'}>
        {status.includeActive ? 'Git include active' : 'Git include not active'}
      </StatusRow>
      <StatusRow tone={cli.path === null ? 'warn' : 'ok'}>
        {cli.path === null
          ? 'gh not found on this host'
          : `gh ${cli.version ?? ''} at ${cli.path}`.replace('  ', ' ')}
      </StatusRow>
      {wrapper.state === 'foreign' && (
        <StatusRow tone="warn">gh wrapper not installed: ~/.local/bin/gh already exists</StatusRow>
      )}
      {wrapper.state === 'none' && <StatusRow tone="warn">gh wrapper not installed</StatusRow>}
      {wrapper.state === 'ours' && (
        <>
          <StatusRow>
            gh wrapper installed{' '}
            {wrapper.outdated && <Badge variant="warning">Update available</Badge>}
          </StatusRow>
          <StatusRow tone={wrapper.loginShell ? 'ok' : 'warn'}>
            {wrapper.loginShell
              ? 'Active in login shells'
              : 'Not active in login shells. Put ~/.local/bin first in PATH'}
          </StatusRow>
          <StatusRow tone={wrapper.nonLoginShell ? 'ok' : 'warn'}>
            {wrapper.nonLoginShell
              ? 'Active in non-login shells'
              : 'Not active in non-login shells. Put ~/.local/bin first in PATH'}
          </StatusRow>
        </>
      )}
      {PATH_BLOCK_ROWS[status.pathBlock] && (
        <StatusRow tone={status.pathBlock === 'present' ? 'ok' : 'warn'}>
          {PATH_BLOCK_ROWS[status.pathBlock]}
        </StatusRow>
      )}
      {status.helperOrder === 'missing' && <StatusRow tone="bad">{HELPER_MISSING}</StatusRow>}
      {status.otherHelpers.map((label) =>
        status.helperOrder === 'first' ? (
          <StatusRow key={label} tone="warn">
            {`Credential helper "${label}" for github.com is asked after remodeck's, for repos without a remodeck token`}
          </StatusRow>
        ) : (
          <StatusRow key={label} tone="bad">
            {`Credential helper "${label}" for github.com is asked before remodeck's and may answer with its own login. Repos without a remodeck token may also stop using it.`}
          </StatusRow>
        )
      )}
    </ul>
  )
}

function CheckRow({
  id,
  checked,
  disabled,
  onChange,
  children
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onChange(on: boolean): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <Label htmlFor={id} className="font-normal">
        {children}
      </Label>
    </div>
  )
}

export function HostGitAccessPanel({
  host,
  onClose
}: {
  host: Host
  /** Closes the surrounding dialog; called before leaving for Settings. */
  onClose?(): void
}): React.JSX.Element {
  const { hosts, refresh } = useAppState()
  const openSettings = useOpenSettings()
  // The dialog's host prop can lag behind a refresh, so prefer the live record.
  const current = hosts?.find((h) => h.id === host.id) ?? host
  const installed = current.gitAccess !== undefined
  const [enabled, setEnabled] = useState(installed)
  const [tokens, setTokens] = useState<GitToken[]>([])
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(Object.keys(current.gitAccess?.installed ?? {}))
  )
  const [status, setStatus] = useState<GitAccessStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'install' | 'remove' | null>(null)
  const [pathBlock, setPathBlock] = useState(false)
  const savedHelperFirst = current.gitAccess?.helperFirst === true
  const [helperFirst, setHelperFirst] = useState(savedHelperFirst)
  const active = enabled || installed
  const orphans = (status?.stale ?? []).filter((id) => !tokens.some((t) => t.id === id))
  // Ask on a first install (state unknown) or when the wrapper is missed and remodeck may edit ~/.bashrc.
  const askPath = !installed
    ? status === null || status.pathBlock === 'absent'
    : status !== null && !status.wrapper.nonLoginShell && status.pathBlock === 'absent'
  // Ask only once another helper is seen, or to let the user undo an earlier choice.
  const askHelper =
    savedHelperFirst ||
    (status !== null &&
      (status.otherHelpers.length > 0 ||
        status.helperOrder === 'behind' ||
        status.helperOrder === 'missing'))

  useEffect(() => {
    if (!active) return
    api.gitTokens
      .list()
      .then((list) => setTokens([...list].sort(compareScopes)))
      .catch((e) => setError(errorMessage(e)))
  }, [active, installed])

  const check = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await api.gitAccess.status(host.id))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [host.id])

  const wasInstalled = host.gitAccess !== undefined
  useEffect(() => {
    // Touch the target on mount only when access was already installed.
    if (!wasInstalled) return
    let live = true
    api.gitAccess
      .status(host.id)
      .then((s) => live && setStatus(s))
      .catch((e) => live && setError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [wasInstalled, host.id])

  const doInstall = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const ids = tokens.filter((t) => checked.has(t.id)).map((t) => t.id)
      setStatus(
        await api.gitAccess.install(host.id, ids, {
          pathBlock: askPath && pathBlock,
          ...(askHelper ? { helperFirst } : {})
        })
      )
      setPathBlock(false)
    } catch (e) {
      setError(`${errorMessage(e)}${INSTALL_RETRY}`)
    }
    // A failure can follow a successful install, so always re-read the host record.
    try {
      await refresh()
    } catch {
      // keep the install error visible
    }
    setBusy(false)
  }

  const doRemove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.gitAccess.remove(host.id)
      setStatus(null)
      setEnabled(false)
    } catch (e) {
      setError(errorMessage(e))
    }
    try {
      await refresh()
    } catch {
      // keep the remove error visible
    }
    setBusy(false)
  }

  const toggle = (id: string, on: boolean): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <section aria-label="Git access" className="flex flex-col gap-3">
      <h3 className="m-0 text-sm font-semibold">Git access on this host</h3>
      <div className="flex items-center gap-2">
        <Checkbox
          id="git-access-enable"
          checked={active}
          disabled={installed || busy}
          onCheckedChange={(c) => setEnabled(c === true)}
        />
        <Label htmlFor="git-access-enable">Enable git access on this host</Label>
      </div>
      {active && (
        <>
          <Alert className="border-transparent bg-warning-soft text-warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="text-warning">{WARNING}</AlertDescription>
          </Alert>
          <p className="m-0 text-xs text-muted-foreground">{PROTECTION}</p>
          {tokens.length === 0 ? (
            <p className="m-0 text-xs text-muted-foreground">No tokens yet.</p>
          ) : (
            <ul
              aria-label="Tokens for this host"
              className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border p-0"
            >
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1">
                    <CheckRow
                      id={`git-access-token-${t.id}`}
                      checked={checked.has(t.id)}
                      disabled={busy}
                      onChange={(on) => toggle(t.id, on)}
                    >
                      {scopeKey(t)} ({t.label})
                    </CheckRow>
                  </div>
                  {status?.stale.includes(t.id) && (
                    <Badge variant="warning">Changed since install</Badge>
                  )}
                  {status?.missing.includes(t.id) && (
                    <Badge variant="destructive">Missing on host</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
          {orphans.map((id) => (
            <p key={id} className="m-0 text-xs text-muted-foreground">
              {ORPHAN}
            </p>
          ))}
          <div>
            <Button
              variant="outline"
              onClick={() => {
                onClose?.()
                openSettings('gitTokens')
              }}
            >
              Manage tokens
            </Button>
          </div>
          {status && <StatusRows status={status} />}
          {askPath && (
            <CheckRow
              id="git-access-path"
              checked={pathBlock}
              disabled={busy}
              onChange={setPathBlock}
            >
              {PATH_QUESTION}
            </CheckRow>
          )}
          {askHelper && (
            <CheckRow
              id="git-access-helper"
              checked={helperFirst}
              disabled={busy}
              onChange={setHelperFirst}
            >
              {HELPER_QUESTION}
            </CheckRow>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy || !tokens.some((t) => checked.has(t.id))}
              onClick={() => (installed ? void doInstall() : setConfirm('install'))}
            >
              {installed ? 'Update host' : 'Install'}
            </Button>
            {installed && (
              <Button variant="outline" onClick={() => void check()} disabled={busy}>
                Check again
              </Button>
            )}
            {/* a failed first install can leave files on the host; the remove script is safe on a clean one */}
            <Button variant="destructive" onClick={() => setConfirm('remove')} disabled={busy}>
              Remove from host
            </Button>
          </div>
        </>
      )}
      {confirm === 'install' && (
        <ConfirmDanger
          host={current}
          mode="click"
          confirmLabel="Install"
          summary={`Write the selected tokens in plain text on ${current.label}. ${WARNING}${
            askPath && pathBlock ? ' Also add ~/.local/bin to PATH at the top of ~/.bashrc.' : ''
          }${askHelper && helperFirst ? " Also ask remodeck's credential helper before the others." : ''}`}
          onConfirm={doInstall}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'remove' && (
        <ConfirmDanger
          host={current}
          mode="click"
          confirmLabel="Remove"
          summary={`Delete all remodeck git access files, tokens, the gh wrapper and the PATH line remodeck added to ~/.bashrc from ${current.label}.`}
          onConfirm={doRemove}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  )
}
