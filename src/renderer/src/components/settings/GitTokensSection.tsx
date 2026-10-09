import { useCallback, useEffect, useState } from 'react'
import { compareScopes, scopeKey, type GitToken } from '../../../../shared/gitAccess'
import { api, errorMessage } from '../../api'
import { useAppState } from '../../state'
import { Badge, Button, TextInput, type BadgeTone } from '../ui'

const DAY_MS = 24 * 60 * 60 * 1000
const WARN_DAYS = 7
const HOSTS = ['github.com']
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

function expiry(expiresAt: string | null): { text: string; tone: BadgeTone } {
  if (expiresAt === null) return { text: 'No expiry', tone: 'neutral' }
  const ms = new Date(expiresAt).getTime() - Date.now()
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
    <form className="settings-section" onSubmit={(e) => void submit(e)}>
      <div className="settings-field">
        <label htmlFor="git-token-host">Host</label>
        <select
          id="git-token-host"
          className="ui-input"
          value={host}
          disabled={replacing !== null}
          onChange={(e) => setHost(e.target.value)}
        >
          {HOSTS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor="git-token-path">Path</label>
        <TextInput
          id="git-token-path"
          value={path}
          readOnly={replacing !== null}
          placeholder="owner or owner/repo"
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
      {!replacing && (
        <div className="settings-field">
          <label htmlFor="git-token-label">Label</label>
          <TextInput
            id="git-token-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      )}
      <div className="settings-field">
        <label htmlFor="git-token-value">Token</label>
        <TextInput
          id="git-token-value"
          type="password"
          autoComplete="off"
          value={tokenValue}
          onChange={(e) => setTokenValue(e.target.value)}
        />
      </div>
      {error && <div className="error">{error}</div>}
      <div>
        <Button type="submit" variant="primary" disabled={busy || tokenValue === ''}>
          {replacing ? 'Replace token' : 'Add token'}
        </Button>{' '}
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
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
  const [error, setError] = useState<string | null>(null)
  const scope = scopeKey(token)
  const exp = expiry(token.expiresAt)
  const count = hostLabels.length

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
    <li className="settings-field">
      <div>
        <strong data-testid="scope">{scope}</strong> <span className="dim">{token.label}</span>{' '}
        <span className="dim">{token.login}</span>
      </div>
      <div>
        <Badge tone={exp.tone}>{exp.text}</Badge>{' '}
        <span className="dim">
          {count === 0
            ? 'Not installed'
            : `Installed on ${count} ${count === 1 ? 'host' : 'hosts'}`}
        </span>
      </div>
      {confirming ? (
        <div>
          {count > 0 ? (
            <>
              <p className="settings-help">{`Still installed on: ${hostLabels.join(', ')}`}</p>
              <p className="settings-help">Removing it here does not remove it from those hosts.</p>
            </>
          ) : (
            <p className="settings-help">Remove this token from this computer?</p>
          )}
          <Button variant="danger" onClick={() => void remove()}>
            Confirm remove
          </Button>{' '}
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : (
        <div>
          <Button aria-label={`Replace token for ${scope}`} onClick={onReplace}>
            Replace
          </Button>{' '}
          <Button aria-label={`Remove token for ${scope}`} onClick={() => setConfirming(true)}>
            Remove
          </Button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </li>
  )
}

export function GitTokensSection(): React.JSX.Element {
  const { hosts } = useAppState()
  const [tokens, setTokens] = useState<GitToken[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<FormMode>({ kind: 'add' })

  const load = useCallback(async (): Promise<void> => {
    try {
      setTokens([...(await api.gitTokens.list())].sort(compareScopes))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="settings-section">
      <h3>Git tokens</h3>
      <p className="settings-help">
        Fine-grained personal access tokens with Contents and Pull requests read and write
        permissions.{' '}
        <a href={TOKEN_URL} target="_blank" rel="noreferrer">
          Create a token on GitHub
        </a>
      </p>
      {loadError && <div className="error">{loadError}</div>}
      {tokens.length === 0 ? (
        <p className="dim">No tokens yet.</p>
      ) : (
        <ul aria-label="Git tokens">
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
      <h3>{mode.kind === 'replace' ? `Replace token for ${scopeKey(mode.token)}` : 'Add token'}</h3>
      <TokenForm
        key={mode.kind === 'replace' ? mode.token.id : 'add'}
        mode={mode}
        onDone={async () => {
          setMode({ kind: 'add' })
          await load()
        }}
        onCancel={mode.kind === 'replace' ? () => setMode({ kind: 'add' }) : undefined}
      />
    </section>
  )
}
