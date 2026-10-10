# remodeck Redesign (shadcn/ui + Tailwind + Motion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every renderer screen moves to shadcn/ui on Tailwind v4 with the look of the redesign boards and the motion spec, plus the nine small features listed in the spec.

**Architecture:** Tokens in `tokens.css` take the new palette and stay the single source of color; Tailwind's `@theme inline` in `main.css` maps them to utilities. Screens are migrated one area per task, replacing legacy classes (`legacy.css`) with shadcn components and token-backed utilities. A small `motion.ts` module owns every duration and spring so components never hard-code timing. Renderer only: no main-process or IPC changes.

**Tech Stack:** Electron 39, electron-vite 5, React 19, TypeScript, Tailwind v4, shadcn/ui (`radix-mira`, Radix), `motion` (motion/react), `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, lucide-react, Vitest + Testing Library (jsdom).

**Spec:** [docs/superpowers/specs/2026-10-10-shadcn-redesign-design.md](../specs/2026-10-10-shadcn-redesign-design.md) — boards in `docs/superpowers/specs/2026-10-10-redesign-boards/*.dc.html`. Read the board named in each task before writing markup; sizes, spacing and colors come from its inline styles.

## Execution model

| Role | Model |
| --- | --- |
| Implementer + self-review, tasks marked **Haiku** | `haiku` (Haiku 5.5) |
| Implementer + self-review, tasks marked **Sonnet** | `sonnet` (Sonnet 5.5) |
| Per-task spec and quality reviewers | `sonnet` |
| Final whole-branch review (after Task 16) | `opus` (Opus 5.5) |

Branch: `feat/shadcn-poc` (continues from commit `00b5d79`). One commit per task.

## Global Constraints

- New renderer libraries go in `devDependencies` (project convention; electron-vite bundles them).
- Add shadcn components with `npx shadcn@latest add <name>`; then run `npx prettier --write` on the new files and replace any `bg-black/NN` overlay with `bg-(--backdrop)`.
- Import `cn` from `cn` (shadcn's package), path alias `@renderer/...`.
- Colors only through tokens: Tailwind utilities backed by `@theme inline` (`bg-background`, `text-muted-foreground`, `bg-ground`, `bg-selected`, …) or `var(--token)`. No hex in `.tsx`.
- Keep every existing user-facing string and accessible name unless the spec's "New in this round" changes it. Copy is English, sentence case.
- Never animate diff lines, terminal output, scrolling, lists over 100 rows, or anything during a drag-resize.
- The terminal dock stays mounted through the portal in `App.tsx`; no task may unmount `TerminalTabs` or move `terminalNode`.
- Do not change the xterm font family (Geist Mono is for UI code text only; xterm measures its font at open, so it keeps Cascadia Code via `--font-terminal`).
- Every task ends green on: `npm run typecheck`, `npx vitest run --project renderer`, `npx electron-vite build`, and `npm run lint` with no more than 111 errors (the baseline on `main`, all pre-existing).
- Legacy CSS for a component is deleted in the task that migrates that component; leave unrelated legacy rules alone.

## Review Focus

1. **Settings opened from inside a dialog** (Host settings → Git access → "Manage tokens"): the dialog must close and the Settings page must show Git tokens — no dialog left floating over Settings. Test in Task 4 (the new host menu is how the test opens Host settings).
2. **Restart while on Settings:** `readActiveModule()` never returns `'settings'`; the app starts on the last Git/Containers module. Test in Task 3.
3. **Ctrl+` while the terminal has focus:** the dock toggles and no backtick is written to the shell. Test in Task 11.
4. **Reduced motion on:** dialogs, menus, toasts and the selection pill appear without transform animation; opacity fades take 80 ms. Test in Task 2 (`transitionFor`); the CSS rule from Task 15 is checked visually in the final step with Windows "Animation effects" off.
5. **Large lists:** a workspace with more than 100 changed files renders file rows without `AnimatePresence` / layout animation. Test in Task 10.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/renderer/src/assets/tokens.css` (modify) | New palette, `--ground`, `--selected-bg` tint, `--success-bg`, radii, Geist font stacks, `--font-terminal` |
| `src/renderer/src/assets/main.css` (modify) | Font imports, new `@theme inline` colors, reduced-motion rule |
| `src/renderer/src/motion.ts` (create) | Durations, springs, `transitionFor`, `useTransitionFor` |
| `src/renderer/src/hostContext.ts` (modify) | `Module` gains `'settings'` |
| `src/renderer/src/settingsOpener.ts` (modify) | `SettingsSection` loses `'appearance'` |
| `src/renderer/src/App.tsx` (modify) | Settings as a module, Ctrl+` shortcut, module crossfade |
| `src/renderer/src/components/TopBar.tsx` → title bar (modify) | Logo, host / workspace switchers, Sync |
| `src/renderer/src/components/ActivityBar.tsx` → rail (modify) | Rail with sliding selection indicator |
| `src/renderer/src/components/SettingsDialog.tsx` (delete) | Replaced by `SettingsView` rendered as a page |
| `src/renderer/src/components/HostSelector.tsx`, `WorkspaceSwitcher.tsx` (modify) | Popover menus |
| `src/renderer/src/components/StatePanel.tsx` (create) | Presentational centered state card |
| `src/renderer/src/components/ConnectPanel.tsx` (create) | Not connected / connect failed, shared by Git and Containers |
| `src/renderer/src/components/Banner.tsx` (create; replaces `ErrorBanner.tsx`) | Inline alert with optional action and dismiss |
| `src/renderer/src/components/Onboarding.tsx` (create) | First run screen |
| `src/renderer/src/useTerminalShortcut.ts` (create) | Ctrl+` listener |
| `src/renderer/src/components/ui/*` (add via CLI) | shadcn components |
| `src/renderer/src/components/ui/index.tsx` (delete at end) | Legacy primitives, once unused |

---

### Task 1: Tokens and fonts — **Haiku**

**Files:**
- Modify: `src/renderer/src/assets/tokens.css`, `src/renderer/src/assets/main.css`, `src/renderer/src/components/TerminalTabs.tsx`, `package.json`
- Test: `tests/renderer/theme.test.ts` (existing, must stay green)

**Interfaces:**
- Produces: tokens `--ground`, `--success-bg`; utilities `bg-ground`, `bg-selected`, `text-selected-foreground`, `text-success`, `bg-success-soft`, `text-warning`, `bg-warning-soft`, `bg-destructive-soft`; `--font-ui` / `--font-code` start with Geist.

- [ ] **Step 1:** `npm i -D @fontsource-variable/geist @fontsource-variable/geist-mono motion`
- [ ] **Step 2:** In `tokens.css` light `:root` set: `--ground: #f4f4f5; --bg: #ffffff; --bg-inset: #fafafa; --bg-subtle: #fafafa; --bg-control: #ffffff; --bg-hover: #f4f4f5; --border: #e4e4e7; --fg: #18181b; --fg-muted: #63636b; --accent: #245fa8; --selected-bg: #e8eef7; --selected-fg: #18181b; --success: #1f7a45; --success-bg: #e6f4ea; --danger: #b42318; --danger-bg: #fce8e8; --attention: #8a5a00; --attention-bg: #fdf3dc; --topbar-bg: #ffffff; --radius-md: 8px; --radius-lg: 12px`. Font stacks: `--font-ui: 'Geist Variable', 'Segoe UI', system-ui, sans-serif; --font-code: 'Geist Mono Variable', 'Cascadia Code', Consolas, ui-monospace, monospace`.
- [ ] **Step 3:** In both dark blocks set: `--ground: #111113; --bg: #1c1c1f; --bg-inset: #18181b; --bg-subtle: #222226; --bg-control: #1c1c1f; --bg-hover: #2a2a2e; --border: #2e2e33; --fg: #ececee; --accent: #8ab4f8; --selected-bg: rgb(138 180 248 / 14%); --success-bg: #17301f; --topbar-bg: #1c1c1f`. Keep the other dark values.
- [ ] **Step 4:** `TerminalTabs.tsx:43-44` reads `--font-code` for xterm. Add `--font-terminal: 'Cascadia Code', Consolas, ui-monospace, monospace;` to `tokens.css` `:root` and make `TerminalTabs.tsx` read `--font-terminal` instead, keeping its fallback.
- [ ] **Step 5:** In `main.css` add `@import '@fontsource-variable/geist';` and `@import '@fontsource-variable/geist-mono';` after `tw-animate-css`, and in `@theme inline` add `--color-ground: var(--ground); --color-selected: var(--selected-bg); --color-selected-foreground: var(--selected-fg); --color-success: var(--success); --color-success-soft: var(--success-bg); --color-warning: var(--attention); --color-warning-soft: var(--attention-bg); --color-destructive-soft: var(--danger-bg);`.
- [ ] **Step 6:** Run the Global Constraints checks. Expected: all pass; build output contains `geist` woff2 files under `out/renderer/assets`.
- [ ] **Step 7:** Commit `feat(renderer): redesign palette, Geist fonts and motion dependency`.

### Task 2: Motion module — **Haiku**

**Files:**
- Create: `src/renderer/src/motion.ts`
- Test: `tests/renderer/motion.test.ts`

**Interfaces:**
- Produces:
  - `export type MotionKind = 'fast' | 'enter' | 'exit' | 'layout'`
  - `export const DURATION: Record<MotionKind, number>` = `{ fast: 0.12, enter: 0.18, exit: 0.12, layout: 0.22 }` (seconds)
  - `export function transitionFor(kind: MotionKind, reduced: boolean): Transition` (type from `motion/react`)
  - `export function useTransitionFor(kind: MotionKind): Transition` — wraps `useReducedMotion()`
  - `export const dialogMotion` — `{ initial: { opacity: 0, scale: 0.96, y: 6 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: 6 } }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { DURATION, transitionFor } from '../../src/renderer/src/motion'

describe('transitionFor', () => {
  it('uses the spec springs', () => {
    expect(transitionFor('enter', false)).toEqual({ type: 'spring', stiffness: 520, damping: 40 })
    expect(transitionFor('layout', false)).toEqual({ type: 'spring', stiffness: 400, damping: 36 })
  })
  it('uses the spec tweens', () => {
    expect(transitionFor('fast', false)).toEqual({ duration: 0.12, ease: 'easeOut' })
    expect(transitionFor('exit', false)).toEqual({ duration: 0.12, ease: 'easeIn' })
  })
  it('reduced motion: transforms snap, opacity keeps 80 ms', () => {
    for (const k of ['fast', 'enter', 'exit', 'layout'] as const)
      expect(transitionFor(k, true)).toEqual({ duration: 0, opacity: { duration: 0.08 } })
  })
  it('exposes the durations', () => {
    expect(DURATION).toEqual({ fast: 0.12, enter: 0.18, exit: 0.12, layout: 0.22 })
  })
})
```

- [ ] **Step 2:** `npx vitest run --project renderer tests/renderer/motion.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `motion.ts` per the Interfaces block.
- [ ] **Step 4:** Re-run → PASS. Run the Global Constraints checks.
- [ ] **Step 5:** Commit `feat(renderer): motion presets from the redesign spec`.

### Task 3: Shell — title bar, rail, Settings as a page — **Sonnet**

Boards: `Main` (title bar, rail), `SettingsGeneral` (title bar on Settings shows only the logo and "Settings").

**Files:**
- Modify: `hostContext.ts`, `settingsOpener.ts`, `App.tsx`, `components/TopBar.tsx`, `components/ActivityBar.tsx`, `components/SettingsView.tsx`, `components/settings/GeneralSection.tsx`
- Delete: `components/SettingsDialog.tsx`, `components/settings/AppearanceSection.tsx` (its controls move into `GeneralSection`)
- Test: `tests/renderer/App.test.tsx`, `tests/renderer/SettingsView.test.tsx`, `tests/renderer/hostContext.test.ts`, `tests/renderer/TopBar.test.tsx`

**Interfaces:**
- Consumes: `transitionFor` / `useTransitionFor` (Task 2).
- Produces:
  - `type Module = 'git' | 'containers' | 'settings'`; `readActiveModule(): 'git' | 'containers'`; `saveActiveModule(m: Module)` ignores `'settings'`.
  - `type SettingsSection = 'general' | 'repositories' | 'gitTokens' | 'pushLog'`
  - `OpenSettings` keeps its signature; calling it selects module `'settings'` with that section (and repo).
  - `SettingsView` props unchanged; its root is `<section aria-label="Settings">`.

- [ ] **Step 1: Update tests first.** In `App.test.tsx`, replace `getByRole('dialog', { name: 'Settings' })` with `getByRole('region', { name: 'Settings' })` and add:

```tsx
it('rail Settings is pressed while the settings page shows, and Git returns', async () => {
  setup([host], [ws], { state: 'connected' })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
  expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Switch host' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Git' }))
  expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument()
})

```

  In `hostContext.test.ts`: `saveActiveModule('settings')` then `readActiveModule()` returns the previous value (`'containers'` if saved before). In `SettingsView.test.tsx`: replace `renderWith('appearance')` cases with `renderWith('general')` and assert the Theme radio group and Terminal font size select are on the General section; assert nav has exactly General, Repositories, Git tokens, Push log.
- [ ] **Step 2:** Run renderer tests → the new/changed tests FAIL.
- [ ] **Step 3:** Implement. Title bar per `Main`: 46px, `bg-background border-b`, logo tile, `HostSelector`, a `/` separator, `WorkspaceSwitcher` (Git module only), flexible spacer, Sync button showing `Sync` + muted relative time (keep `syncLabel` logic and test expectations). Rail per `Main`: 52px, 36px buttons with `aria-pressed`, active = `bg-selected text-accent-foreground`-style tint with a 3px indicator bar rendered as `motion.span layoutId="rail-indicator"` using `useTransitionFor('layout')`. Settings is a rail item (`selectModule('settings')`). `App.tsx` keeps `{ section, repoId }` in state, renders `SettingsView` in `<main>` when module is `'settings'` (keyed by section+repoId as the dialog was), and the terminal slot is not rendered on Settings (the portal node stays alive). Move Theme and Terminal font size into an "Appearance" card in `GeneralSection` per `SettingsGeneral`.
- [ ] **Step 4:** Run renderer tests → PASS. Run the Global Constraints checks.
- [ ] **Step 5:** Commit `feat(renderer): title bar, rail and Settings as a page`.

### Task 4: Host menu — **Sonnet**

Board: `Switchers` (left menu).

**Files:**
- Add: `npx shadcn@latest add popover dropdown-menu`
- Modify: `components/HostSelector.tsx`, `tests/renderer/App.test.tsx`; remove `.switcher*`, `.menu`, `.dot` host rules from `legacy.css` only if `WorkspaceSwitcher` no longer uses them after Task 5 (otherwise leave for Task 5)
- Test: `tests/renderer/HostSelector.test.tsx`

**Interfaces:**
- Produces: trigger keeps `aria-label="Switch host"`. Each host row: status dot, label, protected badge, second line `ssh <sshHost> · <state text>` (or the error message when `state === 'error'`), a row button `Connect` (disconnected) / `Retry` (error) / none (connected), and an icon button `aria-label="Settings for <label>"` opening `HostSettingsDialog`. Existing per-host actions (Disconnect, Remove host…) move into a `DropdownMenu` on the row, keeping their names. Footer: `Add host…`.

- [ ] **Step 1:** Add tests: clicking `Retry` on an error host calls `api.hosts.connect('h1')`; `Settings for Alpha` opens the Host settings dialog and closes the popover; Escape closes the popover and returns focus to the trigger. Update existing tests to the new structure without changing what they assert. In `App.test.tsx` add (mocks as in `HostGitAccessPanel.test.tsx`):

```tsx
it('Manage tokens in Host settings closes the dialog and opens Git tokens', async () => {
  // Switch host → Settings for Box → Manage tokens
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Git tokens' })).toHaveAttribute('aria-current', 'page')
})
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Rebuild with `Popover` + `PopoverContent` (motion: shadcn's data-open animations, duration overridden to 180 ms in / 120 ms out via `data-open:duration-180 data-closed:duration-120`). Connecting state shows `animate-pulse` on the dot only.
- [ ] **Step 4:** Run → PASS. Global checks.
- [ ] **Step 5:** Commit `feat(renderer): host menu on Popover with status and inline connect`.

### Task 5: Workspace menu with search — **Sonnet**

Board: `Switchers` (right menu).

**Files:**
- Modify: `components/WorkspaceSwitcher.tsx`, `legacy.css` (delete `.switcher*`, `.workspaces`, `.menu`, `.ws-label` rules now unused)
- Test: `tests/renderer/WorkspaceSwitcher.test.tsx`

**Interfaces:**
- Produces: trigger keeps `aria-label="Switch workspace"`. Popover top: input `aria-label="Find workspace"` (placeholder `Find workspace`), autofocused on open. Rows are `<button>`s (fixes today's click-only `span`) showing `owner/name` and the sandbox path in mono. Row `DropdownMenu` keeps `Workspace menu <label>` and its items (`Repo settings…`, remove…). Footer: `Clone repo…`, `Add existing repo…`.

- [ ] **Step 1: Tests**

```tsx
it('filters workspaces by label, case-insensitive', async () => {
  renderWith({ h1: up })
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Find workspace' }), { target: { value: 'API' } })
  expect(screen.getByRole('button', { name: /relist\/relist-api/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /relist\/relist-panel/ })).not.toBeInTheDocument()
})
it('shows "No matching workspaces" when nothing matches', /* … */)
it('Enter on the search field opens the first match', /* selectWorkspace called with its id, popover closed */)
it('rows are keyboard-reachable buttons', /* row has role button */)
```

  Use workspace fixtures matching the labels (add them to `renderWith` if missing). Search matches `owner/name` and `sandboxPath`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): workspace menu on Popover with search`.

### Task 6: Simple dialogs — **Haiku**

Boards: `HostDialogs` (Add host, Add existing repo, Remove workspace, Remove host). Pattern to copy: `CloneDialog.tsx` and `ConfirmDanger.tsx` (already migrated).

**Files:**
- Modify: `components/AddHostDialog.tsx`, `components/AddExistingDialog.tsx`, `components/RemoveDialogs.tsx`, `legacy.css` (remove rules only these used)
- Test: `tests/renderer/AddExistingDialog.test.tsx`, any test that queries these dialogs by role (`grep -rn "Remove workspace\|Add host" tests/renderer`)

- [ ] **Step 1:** Change role queries in tests to the new roles: `dialog` for Add host / Add existing, `alertdialog` for the two Remove dialogs. Run → FAIL.
- [ ] **Step 2:** Migrate: `Dialog` / `AlertDialog`, `Field`/`FieldLabel`/`Input`, `Alert variant="destructive"` for errors, checkbox via `npx shadcn@latest add checkbox`. Same close rule as CloneDialog: `onOpenChange={(open) => !open && !busy && onClose()}`. Keep all strings.
- [ ] **Step 3:** Run → PASS; global checks. **Step 4:** Commit `feat(renderer): add host, add existing and remove dialogs on shadcn`.

### Task 7: Push approval and Host settings — **Sonnet**

Boards: `Dialogs` (approval), `HostDialogs` (Host settings with Git access).

**Files:**
- Modify: `components/ApprovalModal.tsx`, `components/HostSettingsDialog.tsx`, `components/HostGitAccessPanel.tsx`, `legacy.css`
- Add: `npx shadcn@latest add badge`
- Test: `tests/renderer/ApprovalModal.test.tsx`, `tests/renderer/HostSettingsDialog.test.tsx`, `tests/renderer/HostGitAccessPanel.test.tsx`

- [ ] **Step 1:** Add to `ApprovalModal.test.tsx`: Escape and clicking the backdrop do **not** dismiss an approval (an approval must be answered with a button); "1 more waiting" text shows when two are queued. Update role queries. Run → FAIL where behavior is new to the markup.
- [ ] **Step 2:** Approval: `AlertDialog` (no outside dismiss), ref list in mono, buttons `Allow once` (primary), `Allow for this session`, `Always for this repo`, `Deny` (destructive outline). Host settings: `Dialog` with sections per board; Git access checklist rows use `Badge` with success / warning / destructive soft tones; plain-text warning is an `Alert`.
- [ ] **Step 3:** Run → PASS; global checks. **Step 4:** Commit `feat(renderer): approval and host settings dialogs on shadcn`.

### Task 8: Host states — **Sonnet**

Board: `HostStates`.

**Files:**
- Create: `components/StatePanel.tsx`, `components/ConnectPanel.tsx`, `components/Banner.tsx`
- Delete: `components/ErrorBanner.tsx` (callers switch to `Banner`)
- Modify: `components/GitModule.tsx`, `components/ContainersModule.tsx`, `components/EmptyState.tsx`, `components/BranchPane.tsx`, `components/ChangesPane.tsx`, `components/ContainersView.tsx`, `components/ResourcesView.tsx`
- Test: create `tests/renderer/ConnectPanel.test.tsx`, `tests/renderer/Banner.test.tsx`; update `GitModule.test.tsx`, `ContainersModule.test.tsx`

**Interfaces:**
- Produces:
  - `StatePanel({ icon?: ReactNode; title: string; description?: ReactNode; tone?: 'neutral' | 'danger'; children?: ReactNode }): JSX.Element` — centered card, `children` are the actions.
  - `ConnectPanel({ host: Host }): JSX.Element` — title `<label> is not connected`, description `Connects over ssh <sshHost>`, `Connect`. On failure: title `Couldn’t reach <label>`, description = error text in mono, buttons `Retry` and `Host settings` (opens `HostSettingsDialog` for that host).
  - `Banner({ tone: 'danger' | 'warning' | 'info'; children: ReactNode; action?: ReactNode; onDismiss?(): void }): JSX.Element` — dismiss button `aria-label="Dismiss"`. `rebuildAction(message, onRebuild)` helper keeps ErrorBanner's `isGitError` rule.
- Git not found: title `Git was not found on this host`, description `Install it first, then check again.`, two mono lines `sudo apt install git` / `sudo dnf install git`, button `Check again`. Connected with no workspaces: `No workspaces yet` / `Clone from GitHub, or add a repo already on the host.` with `Clone repo` and `Add existing repo`.

- [ ] **Step 1: Tests**

```tsx
it('shows Retry and Host settings after a failed connect', async () => {
  vi.mocked(api.hosts.connect).mockRejectedValue(new Error('prod: Permission denied (publickey).'))
  render(<ConnectPanel host={host} />)
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByText('prod: Permission denied (publickey).')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Couldn’t reach Alpha' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Host settings' }))
  expect(screen.getByRole('dialog', { name: /Host settings/ })).toBeInTheDocument()
})
it('Banner dismiss calls onDismiss and has no dismiss button without it', /* … */)
```

  Update GitModule / ContainersModule tests for the new git-not-found copy (old: one sentence with "then press Reload"); they keep asserting `Check again` calls the probe.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; GitModule and ContainersModule both use `ConnectPanel`. **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): host state panels, connect failed with host settings, Banner`.

### Task 9: First run and dismissible warnings — **Haiku**

Boards: `Onboarding`, `HostStates` (banner row).

**Files:**
- Create: `components/Onboarding.tsx`
- Modify: `components/EmptyState.tsx` (no-host branch renders `Onboarding`), `components/GitModule.tsx` (warnings → `Banner tone="warning"` with `onDismiss`)
- Test: `tests/renderer/GitModule.test.tsx`, create `tests/renderer/Onboarding.test.tsx`

**Interfaces:**
- Consumes: `StatePanel`, `Banner` (Task 8).
- Produces: `Onboarding({ onAddHost(): void })`. Copy exactly from the board: heading `Add your first sandbox`, intro `remodeck runs git and Docker on a Linux host over SSH. Pushes go out from this PC, so the sandbox never holds a GitHub credential.`, ordered list of three steps (`An SSH alias that works` / `git on the sandbox` / `GitHub login on this PC` with their detail lines and mono snippets), primary `Add host`. Omit the board's "How the Git Bridge works" link (no target exists yet).
- Dismissed warnings live in `GitModule` state as `Set<string>` of `` `${hostId}:${'http' | 'forward'}` ``; not persisted.

- [ ] **Step 1:** Tests: Onboarding renders the three list items in order and `Add host` calls `onAddHost`; dismissing the forwarding warning hides it, switching to another host with the same caps still shows its warning.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): first run checklist and dismissible host warnings`.

### Task 10: Git workspace panes — **Sonnet**

Board: `Main`.

**Files:**
- Modify: `components/WorkspaceScreen.tsx`, `SplitLayout.tsx`, `BranchPane.tsx`, `ChangesPane.tsx`, `CommitList.tsx`, `FileList.tsx`, `DiffPane.tsx`, `PushBar.tsx`, `legacy.css`
- Test: `tests/renderer/WorkspaceScreen.test.tsx`, `GitModule.test.tsx`, `DiffPane.test.tsx`, `SplitLayout.test.tsx`; create `tests/renderer/FileList.test.tsx`

**Interfaces:**
- Consumes: `useTransitionFor` (Task 2), `Banner` (Task 8).
- Produces: `export const ANIMATE_ROW_LIMIT = 100` in `FileList.tsx`.

- [ ] **Step 1: Tests**

```tsx
it('animates file rows only up to the limit', () => {
  const { container, rerender } = render(<FileList files={makeFiles(3)} /* … */ />)
  expect(container.querySelector('[data-animated="true"]')).not.toBeNull()
  rerender(<FileList files={makeFiles(ANIMATE_ROW_LIMIT + 1)} /* … */ />)
  expect(container.querySelector('[data-animated="true"]')).toBeNull()
})
```

  (`data-animated` is set on the list root when `AnimatePresence` is in use.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Panes become cards (`bg-background border rounded-xl`, 8px gap on `bg-ground`) per `Main`. Branch rows and file rows show the selected row with a shared `motion.div layoutId` pill (`branch-selection`, `file-selection`) using `useTransitionFor('layout')`. File rows enter/exit with height auto via `AnimatePresence` when `files.length <= ANIMATE_ROW_LIMIT`. Diff lines and drag-resize stay unanimated; the selection pill uses `layout` only on selection change, not during `SplitLayout` drags. Keep `SplitLayout`'s persisted sizes and min sizes.
- [ ] **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): git workspace panes as cards with selection motion`.

### Task 11: Terminal dock and Ctrl+` — **Sonnet**

Board: `Terminal`.

**Files:**
- Create: `src/renderer/src/useTerminalShortcut.ts`
- Modify: `components/TerminalTabs.tsx`, `App.tsx`, `legacy.css`
- Test: create `tests/renderer/useTerminalShortcut.test.tsx`; `tests/renderer/TerminalTabs.test.tsx` must stay green

**Interfaces:**
- Produces: `useTerminalShortcut(onToggle: () => void): void` — window `keydown` listener in the **capture** phase; on `ctrlKey && code === 'Backquote'` (no alt/meta/shift) it calls `preventDefault()`, `stopPropagation()`, then `onToggle()`. Not active on the Settings module.

- [ ] **Step 1: Tests**

```tsx
it('Ctrl+` toggles and stops the key reaching the terminal', () => {
  const onToggle = vi.fn()
  renderHook(() => useTerminalShortcut(onToggle))
  const inner = vi.fn()
  const target = document.createElement('textarea') // xterm's helper textarea
  document.body.appendChild(target)
  target.addEventListener('keydown', inner)
  const e = new KeyboardEvent('keydown', { code: 'Backquote', key: '`', ctrlKey: true, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  expect(onToggle).toHaveBeenCalledOnce()
  expect(inner).not.toHaveBeenCalled()
  expect(e.defaultPrevented).toBe(true)
})
it('ignores a plain backtick and Ctrl+Shift+`', /* … */)
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the hook and call it from `Layout` with the existing `toggle`. Restyle the dock per board: dark tab strip in `--bg-inset`, tabs with close buttons, `+` new tab, resize handle 6px with hover tint. Do not change xterm options or the portal.
- [ ] **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): terminal dock restyle and Ctrl+backtick toggle`.

### Task 12: Containers — **Sonnet**

Board: `Containers`.

**Files:**
- Modify: `components/ContainersModule.tsx`, `ContainersView.tsx`, `ContainerItem.tsx`, `ContainerDetailsPanel.tsx`, `legacy.css`
- Add: `npx shadcn@latest add tooltip`
- Test: `tests/renderer/ContainersView.test.tsx`, `ContainersModule.test.tsx`, `ContainerDetailsPanel.test.tsx`

- [ ] **Step 1:** Keep all existing assertions (names like `Logs <name>`, `Shell <name>`, `Restart <name>`, `Filter containers`, compose `Up/Pull/Restart/Down`). Add: a container whose state is `restarting` has a status element with `data-pulse="true"`; a `running` one does not. Run → FAIL.
- [ ] **Step 2:** Implement per board: kind tabs (Containers / Images / Volumes / Networks) as a segmented control, compose group header (`<name>` + `compose · N of M running` + actions), table columns Name / Image / Ports / CPU / Memory, row icon actions with tooltips, details panel as a right-side card. Status pulse uses `animate-pulse` only for transitional states.
- [ ] **Step 3:** Run → PASS; global checks. **Step 4:** Commit `feat(renderer): containers view redesign`.

### Task 13: Images, Volumes, Networks — **Haiku**

Board: `Images`.

**Files:**
- Modify: `components/ResourcesView.tsx`, `legacy.css`
- Test: `tests/renderer/ResourcesView.test.tsx`

- [ ] **Step 1:** Keep existing assertions (`in use` badge, prune, `Removed N items · reclaimed X` text, volume removal asks for the host name). Run → PASS before changes (baseline).
- [ ] **Step 2:** Restyle per board: table with `Repository : tag` / ID / Created / Size columns, `in use` as success-soft `Badge`, `dangling` neutral badge, built-in networks show a `built-in` badge and no remove button, prune result as an info `Banner`.
- [ ] **Step 3:** Run → PASS; global checks. **Step 4:** Commit `feat(renderer): images, volumes and networks redesign`.

### Task 14: Settings sections — **Sonnet**

Boards: `SettingsGeneral`, `SettingsRepos`, `SettingsTokens`, `SettingsPushLog`.

**Files:**
- Modify: `components/SettingsView.tsx`, `settings/GeneralSection.tsx`, `settings/RepositoriesSection.tsx`, `settings/GitTokensSection.tsx`, `settings/PushLogSection.tsx`, `legacy.css`
- Add: `npx shadcn@latest add switch toggle-group table`
- Test: `tests/renderer/SettingsView.test.tsx`, `tests/renderer/GitTokensSection.test.tsx`

- [ ] **Step 1: Tests**

```tsx
it('shows the workspace count per repo', () => {
  // repo r1 with two workspaces, r2 with one
  renderWith('repositories')
  expect(within(card('relist/relist-panel')).getByText('2 workspaces')).toBeInTheDocument()
  expect(within(card('relist/relist-api')).getByText('1 workspace')).toBeInTheDocument()
})
it('Enforce rules is a switch', () => {
  renderWith('repositories')
  expect(screen.getByRole('switch', { name: 'Enforce rules for relist/relist-panel' })).toBeChecked()
})
it('theme is a radio group with System, Light, Dark', /* on General */)
```

  Count = workspaces with that `repoId` across all hosts.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per boards: section nav on the left (200px), content cards max-width 720–760px. General: Appearance card (Theme as `ToggleGroup` with radio semantics, Terminal font size select) and New repositories card. Repositories: one card per repo (header with name + count, `Switch` for Enforce rules, Protected branches input, Always allow push row with `Revoke` when on). Git tokens and Push log: `Table` with tone badges (`ok` success, `denied` warning, `blocked`/`rejected`/`error` destructive — keep the existing `r === 'ok' ? … ` mapping).
- [ ] **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): settings sections redesign`.

### Task 15: Toasts, module crossfade, reduced motion — **Sonnet**

Board: `Motion`.

**Files:**
- Modify: `components/Toaster.tsx`, `App.tsx`, `assets/main.css`, `legacy.css`
- Test: create `tests/renderer/Toaster.test.tsx`

**Interfaces:**
- Consumes: `transitionFor`, `useTransitionFor` (Task 2).
- `DURATION_MS` becomes `{ success: 4000, error: null }`; `null` = no auto-dismiss.

- [ ] **Step 1: Tests**

```tsx
it('success toasts auto-dismiss after 4 s', () => { vi.useFakeTimers(); showToast('Pushed'); render(<Toaster />); act(() => vi.advanceTimersByTime(4100)); expect(screen.queryByText('Pushed')).toBeNull() })
it('error toasts stay until dismissed', () => { /* advance 60 s, still shown; click Dismiss notification, gone */ })
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Toasts: `AnimatePresence` + `motion.div` (`x: 16 → 0` with `enter`, exit with `exit`; every toast except the newest gets `scale: 0.94`). Error toasts hide the progress bar. Module switch: wrap the module content (not the terminal slot) in `AnimatePresence mode="wait"` keyed by module with an opacity-only fade of `DURATION.fast`. In `main.css` add:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation-duration: 80ms !important; transition-duration: 80ms !important; }
  [data-slot] { --tw-enter-scale: 1; --tw-exit-scale: 1; --tw-enter-translate-y: 0; --tw-exit-translate-y: 0; }
}
```

- [ ] **Step 4:** Run → PASS; global checks.
- [ ] **Step 5:** Commit `feat(renderer): toast and module motion, reduced-motion rules`.

### Task 16: Cleanup and docs — **Haiku**

**Files:**
- Delete: `components/ui/index.tsx` if nothing imports it (`grep -rn "from './ui'\|from '../ui'" src/renderer/src`), otherwise list remaining importers in the commit message and leave it; delete `src/renderer/poc.html`, `src/renderer/src/poc-harness.tsx` if present
- Modify: `legacy.css` (delete rules whose selectors no longer match any `className` in `src/renderer/src` — check each with grep), `docs/design-guidelines.md` (palette table, fonts, motion table, shadcn usage replacing the `components/ui` section), `docs/manual-test.md` (add: Settings page, workspace search, Ctrl+`, first run, connect failed → Host settings)

- [ ] **Step 1:** Remove dead code and CSS as above.
- [ ] **Step 2:** Global checks. Expected: all pass, lint ≤ 111 errors.
- [ ] **Step 3:** Commit `chore(renderer): drop legacy primitives and dead CSS; update design docs`.

### Final: Whole-branch review — **Opus**

- [ ] Dispatch an `opus` reviewer over `git diff 00b5d79..HEAD` with the spec, this plan, and the Review Focus list. It also checks: no hex colors in `.tsx`, every board area has its task, motion durations come only from `motion.ts` or the CSS durations 180/120, no unexpected string changes (`git diff 00b5d79..HEAD -- tests/renderer` should show query updates, not weaker assertions).
- [ ] Fix findings in follow-up commits, re-run global checks.
- [ ] Controller runs the real app (`npm run dev`) against a host and screenshots Git, Containers, Settings in light and dark for the user.
