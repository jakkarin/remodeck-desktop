import { useState } from 'react'
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, type Theme } from '../../../../shared/types'
import { errorMessage } from '../../api'
import { useAppState } from '../../state'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const FONT_SIZES = Array.from(
  { length: TERMINAL_FONT_MAX - TERMINAL_FONT_MIN + 1 },
  (_, i) => TERMINAL_FONT_MIN + i
)

export function AppearanceSection(): React.JSX.Element {
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
    <section className="settings-section">
      <h3>Appearance</h3>
      <fieldset className="settings-field segmented">
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
      <div className="settings-field">
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
      {error && <div className="error">{error}</div>}
    </section>
  )
}
