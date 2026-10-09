import { useCallback, useEffect, useState } from 'react'
import {
  compareScopes,
  scopeKey,
  type GitAccessStatus,
  type GitToken
} from '../../../shared/gitAccess'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useOpenSettings } from '../settingsOpener'
import { useAppState } from '../state'
import { ConfirmDanger } from './ConfirmDanger'
import { Badge, Button } from './ui'

const WARNING =
  'Tokens are stored in plain text on this host. Anything running as this user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval.'
const INSTALL_RETRY = ' Try Update host again or Remove from host.'
const ORPHAN = 'A removed token is still on this host. Update host or Remove from host deletes it.'
const PROTECTION =
  "Real protection on the host comes from each token's scope and expiry and from GitHub rulesets, because Git Bridge rules don't apply to agents pushing directly."

function StatusRows({ status }: { status: GitAccessStatus }): React.JSX.Element {
  const { cli, wrapper } = status
  return (
    <ul aria-label="Git access status" className="settings-help">
      <li>
        {status.helperInstalled ? 'Credential helper installed' : 'Credential helper missing'}
      </li>
      <li>{status.includeActive ? 'Git include active' : 'Git include not active'}</li>
      <li>
        {cli.path === null
          ? 'gh not found on this host'
          : `gh ${cli.version ?? ''} at ${cli.path}`.replace('  ', ' ')}
      </li>
      {wrapper.state === 'foreign' && (
        <li>gh wrapper not installed: ~/.local/bin/gh already exists</li>
      )}
      {wrapper.state === 'none' && <li>gh wrapper not installed</li>}
      {wrapper.state === 'ours' && (
        <>
          <li>
            gh wrapper installed{' '}
            {wrapper.outdated && <Badge tone="warning">Update available</Badge>}
          </li>
          <li>
            {wrapper.loginShell
              ? 'Active in login shells'
              : 'Not active in login shells. Put ~/.local/bin first in PATH'}
          </li>
          <li>
            {wrapper.nonLoginShell
              ? 'Active in non-login shells'
              : 'Not active in non-login shells. Put ~/.local/bin first in PATH'}
          </li>
        </>
      )}
      {status.otherHelpers.map((label) => (
        <li key={label} className="error">
          {`Credential helper "${label}" for github.com is asked before remodeck's and may answer with its own login. Repos without a remodeck token may also stop using it.`}
        </li>
      ))}
    </ul>
  )
}

export function HostGitAccessPanel({ host }: { host: Host }): React.JSX.Element {
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
  const active = enabled || installed
  const orphans = (status?.stale ?? []).filter((id) => !tokens.some((t) => t.id === id))

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
      setStatus(await api.gitAccess.install(host.id, ids))
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
    <section className="settings-section" aria-label="Git access">
      <h3>Git access on this host</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={active}
          disabled={installed || busy}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable git access on this host
      </label>
      {active && (
        <>
          <p className="settings-help">{WARNING}</p>
          <p className="settings-help">{PROTECTION}</p>
          {tokens.length === 0 ? (
            <p className="dim">No tokens yet.</p>
          ) : (
            <ul aria-label="Tokens for this host" className="git-access-tokens">
              {tokens.map((t) => (
                <li key={t.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked.has(t.id)}
                      disabled={busy}
                      onChange={(e) => toggle(t.id, e.target.checked)}
                    />
                    {scopeKey(t)} ({t.label})
                  </label>{' '}
                  {status?.stale.includes(t.id) && (
                    <Badge tone="warning">Changed since install</Badge>
                  )}
                  {status?.missing.includes(t.id) && <Badge tone="danger">Missing on host</Badge>}
                </li>
              ))}
            </ul>
          )}
          {orphans.map((id) => (
            <p key={id} className="settings-help">
              {ORPHAN}
            </p>
          ))}
          <Button onClick={() => openSettings('gitTokens')}>Manage tokens</Button>
          {status && <StatusRows status={status} />}
          {error && <div className="error">{error}</div>}
          <div className="git-access-actions">
            {installed && (
              <Button onClick={() => void check()} disabled={busy}>
                Check again
              </Button>
            )}
            {/* a failed first install can leave files on the host; the remove script is safe on a clean one */}
            <Button variant="danger" onClick={() => setConfirm('remove')} disabled={busy}>
              Remove from host
            </Button>
            <Button
              variant="primary"
              disabled={busy || !tokens.some((t) => checked.has(t.id))}
              onClick={() => (installed ? void doInstall() : setConfirm('install'))}
            >
              {installed ? 'Update host' : 'Install'}
            </Button>
          </div>
        </>
      )}
      {confirm === 'install' && (
        <ConfirmDanger
          host={current}
          mode="click"
          confirmLabel="Install"
          summary={`Write the selected tokens in plain text on ${current.label}. ${WARNING}`}
          onConfirm={doInstall}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'remove' && (
        <ConfirmDanger
          host={current}
          mode="click"
          confirmLabel="Remove"
          summary={`Delete all remodeck git access files, tokens and the gh wrapper from ${current.label}.`}
          onConfirm={doRemove}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  )
}
