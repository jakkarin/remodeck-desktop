import { useState } from 'react'
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

export function GeneralSection(): React.JSX.Element {
  const { prefs } = useAppState()
  return (
    <section className="settings-section">
      <h3>General</h3>
      <BranchesField key={prefs.defaultProtectedBranches.join(',')} />
    </section>
  )
}
