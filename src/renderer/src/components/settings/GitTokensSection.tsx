import { useCallback, useEffect, useState } from 'react'
import { compareScopes, scopeKey, type GitToken } from '../../../../shared/gitAccess'
import { api, errorMessage } from '../../api'
import { useAppState } from '../../state'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { FormError, SectionHeader } from './SettingsParts'

type BadgeTone = 'neutral' | 'warning' | 'danger'
const TONE_VARIANT = {
  neutral: 'secondary',
  warning: 'warning',
  danger: 'destructive'
} as const

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_DAYS = 7
const HOSTS = ['github.com']
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

function expiry(expiresAt: string | null): { text: string; tone: BadgeTone } {
  if (expiresAt === null) return { text: 'No expiry', tone: 'neutral' }
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return { text: 'No expiry', tone: 'neutral' }
  if (ms <= 0) return { text: 'Expired', tone: 'danger' }
  const days = Math.ceil(ms / DAY_MS)
  return {
    text: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`,
    tone: days <= WARN_DAYS ? 'warning' : 'neutral'
  }
}

type FormMode = { kind: 'add' } | { kind: 'replace'; token: GitToken }

function TokenForm({
  mode,
  onDone,
  onCancel
}: {
  mode: FormMode
  onDone: () => Promise<void>
  onCancel?: () => void
}): React.JSX.Element {
  const replacing = mode.kind === 'replace' ? mode.token : null
  const [host, setHost] = useState(replacing?.host ?? HOSTS[0])
  const [path, setPath] = useState(replacing?.path ?? '')
  const [label, setLabel] = useState('')
  const [tokenValue, setTokenValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const value = tokenValue
    // The secret never outlives the call: clear the field before awaiting.
    setTokenValue('')
    try {
      if (replacing) await api.gitTokens.replace(replacing.id, value)
      else await api.gitTokens.add({ host, path, label, token: value })
      if (!replacing) {
        setPath('')
        setLabel('')
      }
      await onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-background p-4"
      onSubmit={(e) => void submit(e)}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="git-token-host">Host</Label>
        <NativeSelect
          id="git-token-host"
          className="w-full"
          value={host}
          disabled={replacing !== null}
          onChange={(e) => setHost(e.target.value)}
        >
          {HOSTS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="git-token-path">Path</Label>
        <Input
          id="git-token-path"
          value={path}
          readOnly={replacing !== null}
          placeholder="owner or owner/repo"
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      {!replacing && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="git-token-label">Label</Label>
          <Input id="git-token-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="git-token-value">Token</Label>
        <Input
          id="git-token-value"
          type="password"
          autoComplete="off"
          value={tokenValue}
          onChange={(e) => setTokenValue(e.target.value)}
        />
      </div>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || tokenValue === ''}>
          {replacing ? 'Replace token' : 'Add token'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function TokenRow({
  token,
  hostLabels,
  onChanged,
  onReplace
}: {
  token: GitToken
  hostLabels: string[]
  onChanged: () => Promise<void>
  onReplace: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scope = scopeKey(token)
  const exp = expiry(token.expiresAt)
  const count = hostLabels.length

  async function saveLabel(): Promise<void> {
    const next = labelDraft.trim()
    if (next === '') {
      setError('Label cannot be empty')
      return
    }
    setError(null)
    try {
      await api.gitTokens.setLabel(token.id, next)
      setEditing(false)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function remove(): Promise<void> {
    setError(null)
    try {
      await api.gitTokens.remove(token.id)
      await onChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <strong data-testid="scope" className="text-[13px] font-semibold">
          {scope}
        </strong>
        <span className="text-xs text-muted-foreground">{token.label}</span>
        <span className="text-xs text-muted-foreground">{token.login}</span>
        <Badge variant={TONE_VARIANT[exp.tone]} className="ml-auto">
          {exp.text}
        </Badge>
      </div>
      <div>
        <span className="text-xs text-muted-foreground">
          {count === 0
            ? 'Not installed'
            : `Installed on ${count} ${count === 1 ? 'host' : 'hosts'}`}
        </span>
      </div>
      {confirming ? (
        <div>
          {count > 0 ? (
            <>
              <p className="m-0 text-xs text-muted-foreground">{`Still installed on: ${hostLabels.join(', ')}`}</p>
              <p className="m-0 text-xs text-muted-foreground">
                Removing it here does not remove it from those hosts.
              </p>
            </>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              Remove this token from this computer?
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="destructive" onClick={() => void remove()}>
              Confirm remove
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : editing ? (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Label for ${scope}`}
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
          />
          <Button onClick={() => void saveLabel()}>Save label</Button>
          <Button
            variant="outline"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" aria-label={`Replace token for ${scope}`} onClick={onReplace}>
            Replace
          </Button>
          <Button
            variant="outline"
            aria-label={`Edit label for ${scope}`}
            onClick={() => {
              setLabelDraft(token.label)
              setEditing(true)
            }}
          >
            Edit label
          </Button>
          <Button
            variant="outline"
            aria-label={`Remove token for ${scope}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </Button>
        </div>
      )}
      {error && <FormError>{error}</FormError>}
    </li>
  )
}

export function GitTokensSection(): React.JSX.Element {
  const { hosts } = useAppState()
  const [tokens, setTokens] = useState<GitToken[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [requestedMode, setMode] = useState<FormMode>({ kind: 'add' })
  // A token removed elsewhere must not leave the replace form pointing at a dead id.
  const mode: FormMode =
    requestedMode.kind === 'replace' && !tokens.some((t) => t.id === requestedMode.token.id)
      ? { kind: 'add' }
      : requestedMode

  const load = useCallback(async (): Promise<void> => {
    try {
      setTokens([...(await api.gitTokens.list())].sort(compareScopes))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    let live = true
    api.gitTokens
      .list()
      .then((list) => {
        if (!live) return
        setTokens([...list].sort(compareScopes))
        setLoadError(null)
      })
      .catch((e) => live && setLoadError(errorMessage(e)))
    return () => {
      live = false
    }
  }, [])

  return (
    <>
      <SectionHeader title="Git tokens" />
      <p className="m-0 text-xs text-muted-foreground">
        Fine-grained personal access tokens with Contents and Pull requests read and write
        permissions. Select only the repositories you need and set an expiration.{' '}
        <a href={TOKEN_URL} target="_blank" rel="noreferrer">
          Create a token on GitHub
        </a>
      </p>
      {loadError && <FormError>{loadError}</FormError>}
      {tokens.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul aria-label="Git tokens" className="m-0 flex list-none flex-col gap-3 p-0">
          {tokens.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              hostLabels={hosts.filter((h) => h.gitAccess?.installed[t.id]).map((h) => h.label)}
              onChanged={load}
              onReplace={() => setMode({ kind: 'replace', token: t })}
            />
          ))}
        </ul>
      )}
      <h2 className="m-0 text-sm font-semibold">
        {mode.kind === 'replace' ? `Replace token for ${scopeKey(mode.token)}` : 'Add token'}
      </h2>
      <TokenForm
        key={mode.kind === 'replace' ? mode.token.id : 'add'}
        mode={mode}
        onDone={async () => {
          setMode({ kind: 'add' })
          await load()
        }}
        onCancel={mode.kind === 'replace' ? () => setMode({ kind: 'add' }) : undefined}
      />
    </>
  )
}
