import { useState } from 'react'
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, type Theme } from '../../../../shared/types'
import { errorMessage } from '../../api'
import { useAppState } from '../../state'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { NativeSelect } from '@renderer/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { parseBranches } from './parseBranches'
import { FormError, Row, SectionHeader } from './SettingsParts'

function BranchesCard(): React.JSX.Element {
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
    <section aria-labelledby="new-repos-h" className="rounded-xl border bg-background">
      <h2 id="new-repos-h" className="m-0 px-4 pt-3.5 text-sm font-semibold">
        New repositories
      </h2>
      <div className="flex flex-col gap-1.5 px-4 py-3.5">
        <Label htmlFor="default-protected-branches">Default protected branches</Label>
        <Input
          id="default-protected-branches"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
          }}
        />
        <p className="m-0 text-xs text-muted-foreground">
          Comma-separated. Applies to newly added repos only; existing repos keep their own list.
        </p>
        {error && <FormError>{error}</FormError>}
      </div>
    </section>
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
      <Row title="Theme" description="System follows the operating system light/dark setting.">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          aria-label="Theme"
          value={prefs.theme}
          onValueChange={(v) => {
            if (v) void update({ theme: v as Theme })
          }}
        >
          {THEME_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={o.value} className="data-[state=on]:bg-selected">
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row
        title={<Label htmlFor="terminal-font-size">Terminal font size</Label>}
        className="border-t"
      >
        <NativeSelect
          id="terminal-font-size"
          value={prefs.terminalFontSize}
          onChange={(e) => void update({ terminalFontSize: Number(e.target.value) })}
        >
          {FONT_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </Row>
      {error && (
        <div className="px-4 pb-3.5">
          <FormError>{error}</FormError>
        </div>
      )}
    </section>
  )
}

export function GeneralSection(): React.JSX.Element {
  const { prefs } = useAppState()
  return (
    <>
      <SectionHeader title="General" />
      <AppearanceCard />
      <BranchesCard key={prefs.defaultProtectedBranches.join(',')} />
    </>
  )
}
