import { useState } from 'react'
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, type Theme } from '../../../../shared/types'
import { errorMessage } from '../../api'
import { useAppState } from '../../state'
import { TextInput } from '../ui'
import { parseBranches } from './parseBranches'

function BranchesField(): React.JSX.Element {
  const { prefs, updatePrefs } = useAppState()
  const current = prefs.defaultProtectedBranches
  const [value, setValue] = useState(current.join(', '))
  const [error, setError] = useState<string | null>(null)

  async function commit(): Promise<void> {
    const next = parseBranches(value)
    if (next.join(',') === current.join(',')) return
    setError(null)
    try {
      await updatePrefs({ defaultProtectedBranches: next })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="settings-field">
      <label htmlFor="default-protected-branches">Default protected branches</label>
      <TextInput
        id="default-protected-branches"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
        }}
      />
      <p className="settings-help">
        Comma-separated. Applies to newly added repos only; existing repos keep their own list.
      </p>
      {error && <div className="error">{error}</div>}
    </div>
  )
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const FONT_SIZES = Array.from(
  { length: TERMINAL_FONT_MAX - TERMINAL_FONT_MIN + 1 },
  (_, i) => TERMINAL_FONT_MIN + i
)

function AppearanceCard(): React.JSX.Element {
  const { prefs, updatePrefs } = useAppState()
  const [error, setError] = useState<string | null>(null)

  async function update(patch: Parameters<typeof updatePrefs>[0]): Promise<void> {
    setError(null)
    try {
      await updatePrefs(patch)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section aria-labelledby="appearance-h" className="rounded-xl border bg-background">
      <h2 id="appearance-h" className="m-0 px-4 pt-3.5 text-sm font-semibold">
        Appearance
      </h2>
      <fieldset className="settings-field segmented px-4 py-3.5">
        <legend>Theme</legend>
        {THEME_OPTIONS.map((o) => (
          <label key={o.value} className={prefs.theme === o.value ? 'selected' : undefined}>
            <input
              type="radio"
              name="theme"
              value={o.value}
              checked={prefs.theme === o.value}
              onChange={() => void update({ theme: o.value })}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <div className="settings-field px-4 py-3.5">
        <label htmlFor="terminal-font-size">Terminal font size</label>
        <select
          id="terminal-font-size"
          className="ui-input"
          value={prefs.terminalFontSize}
          onChange={(e) => void update({ terminalFontSize: Number(e.target.value) })}
        >
          {FONT_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error px-4 pb-3.5">{error}</div>}
    </section>
  )
}

export function GeneralSection(): React.JSX.Element {
  const { prefs } = useAppState()
  return (
    <section className="settings-section">
      <h3>General</h3>
      <AppearanceCard />
      <BranchesField key={prefs.defaultProtectedBranches.join(',')} />
    </section>
  )
}
