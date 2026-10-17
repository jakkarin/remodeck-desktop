# Remodeck design guidelines — Neutral

Chosen direction: a neutral desktop UI on shadcn/ui and Tailwind v4 that keeps the existing layout
(left rail, Branches / Changes / Diff panes and the terminal at the bottom), including drag-to-resize and the saved sizes.
Every screen now uses the same components and tokens.

## Source of truth

- `src/renderer/src/assets/tokens.css`: raw light/dark token values (color, spacing, radius, fonts and durations)
- `src/renderer/src/assets/main.css`: `@theme inline` maps tokens to Tailwind utilities (`bg-ground`, `bg-selected`, `rounded-md`, etc.)
  and sets reduced motion globally
- `src/renderer/src/components/ui/*.tsx`: shadcn components used in the project (edit them as needed)
- `src/renderer/src/assets/legacy.css`: only base styles for raw elements (buttons/inputs without `data-slot`), diff, error and spinner
- `src/renderer/src/motion.ts`: every animation duration and spring on screen
- `src/renderer/src/theme.ts`: token mapping for xterm

Use semantic tokens instead of hex colors in components. The theme follows the system through `prefers-color-scheme`,
and the terminal also follows system color changes without reopening. Users can force light/dark in Settings > General
(stored in remodeck's config), which sets `data-theme` on `<html>`; System leaves the attribute unset.

## Surfaces and color

Values below come from `tokens.css` (the same light/dark values declared in `:root` and `:root[data-theme='dark']`).

| Token                             | Dark                                 | Light                 | Usage                                        |
| --------------------------------- | ------------------------------------ | --------------------- | -------------------------------------------- |
| `--ground`                        | `#111113`                            | `#f4f4f5`             | Background around cards (gaps between panes) |
| `--bg`                            | `#1c1c1f`                            | `#ffffff`             | Pane, dialog and popover surface             |
| `--bg-inset`                      | `#18181b`                            | `#fafafa`             | Diff and terminal background                 |
| `--bg-subtle`                     | `#222226`                            | `#fafafa`             | Pane headers, top bar                        |
| `--bg-control`                    | `#1c1c1f`                            | `#ffffff`             | Control and menu background                  |
| `--bg-hover`                      | `#2a2a2e`                            | `#f4f4f5`             | Hover and unselected tabs                    |
| `--selected-bg` / `--selected-fg` | `rgb(138 180 248 / 14%)` / `#f0f0f0` | `#e8eef7` / `#18181b` | Selected item (selection pill)               |
| `--fg`                            | `#ececee`                            | `#18181b`             | Primary text                                 |
| `--fg-muted`                      | `#a0a0a0`                            | `#63636b`             | Metadata and secondary text                  |
| `--border` / `--border-strong`    | `#2e2e33` / `#505050`                | `#e4e4e7` / `#bdbdbd` | Surface dividers / control borders           |
| `--accent`                        | `#8ab4f8`                            | `#245fa8`             | Keyboard focus ring and new state            |
| `--primary-bg` / `--primary-fg`   | `#dfdfdf` / `#202020`                | `#282828` / `#ffffff` | Primary action                               |
| `--success` / `--success-bg`      | `#61ce91` / `#17301f`                | `#1f7a45` / `#e6f4ea` | Success state                                |
| `--danger` / `--danger-bg`        | `#f08080` / `#362222`                | `#b42318` / `#fce8e8` | Errors and dangerous actions                 |
| `--attention` / `--attention-bg`  | `#e2bd75` / `#332b1e`                | `#8a5a00` / `#fdf3dc` | Warnings                                     |
| `--diff-add-bg` / `--diff-del-bg` | `#193526` / `#3c2222`                | `#e3f2e8` / `#fae5e5` | Added/removed diff lines                     |
| `--terminal-selection`            | `#3d4b60`                            | `#cbd5e4`             | Text selection in the terminal               |

Use green/red for status and added/removed diff lines, and yellow for warnings. Never use a status color
as the background of a selected item. The Push button uses the neutral primary; the Pushed result uses success.
Diff lines carry `+`/`-` markers and a colored edge bar together, so meaning never relies on color alone.
Terminal selection uses `--terminal-selection` so selected text stands out more than the row selection color.

## Typography, spacing, shape

**Fonts** (bundled with the app, never loaded from the network):

- UI: Geist Variable (`--font-ui`, fallback Segoe UI / system-ui)
- Code in the UI: Geist Mono Variable (`--font-code`, Tailwind `font-mono`)
- Terminal (xterm): Cascadia Code (`--font-terminal`). It stays off Geist Mono because xterm measures the font when it opens
  and relies on the fixed glyphs configured there.

**Font sizes**: the Tailwind utilities `text-xs` / `text-sm` / `text-base` are 12 / 13 / 14px (declared in `@theme inline`).
`var(--text-*)` from `tokens.css` is still 11 / 12 / 13px and is used only in `legacy.css` and xterm.
New components use Tailwind utilities only.

**Spacing**: `--space-1` to `--space-5` = 4, 8, 12, 16, 24px (normal Tailwind spacing such as `gap-2` or `p-3` is fine).

**Radius**:

- `tokens.css`: `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px
- Tailwind (`@theme inline`): `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 8px, `rounded-xl` 11px, `rounded-2xl` 14px
- Guidance: badges use `rounded-sm`; controls and rows use `rounded-md`/`rounded-lg`; dialogs and popovers keep shadcn's values

**Other sizes**: Lucide icons at 14–16px; icon buttons 30 × 30px; data rows at least 30–32px tall; pane headers at least 40px;
title bar 46px; rail 52px.
Use 1px borders. Shadows only on dialogs and popovers (`--shadow-popover`, `--shadow-dialog`), never on individual panes.

## Motion

All values live in `motion.ts` (`DURATION`, `TRANSITIONS`, `transitionFor`) and the CSS duration in `tokens.css` (`--duration-fast` 120ms).
Never add a new numeric duration in a component.

| Name   | Value                                     | Used for                                   |
| ------ | ----------------------------------------- | ------------------------------------------ |
| fast   | 120 ms ease-out                           | Hover, press, focus ring, tab underline    |
| enter  | 180 ms, spring stiffness 520 / damping 40 | Dialog, popover, menu, toast in            |
| exit   | 120 ms ease-in                            | Everything that leaves                     |
| layout | 220 ms, spring stiffness 400 / damping 36 | List reorder, selection pill, panel resize |

- Dialog: opacity 0→1, scale .96→1, y 6→0 (`dialogMotion`); the backdrop only fades
- The selection pill slides between rows in the branch list, file list and rail
- Toasts enter from the right, x 16→0; older toasts scale to .94; error toasts stay until dismissed
- After Sync, new file rows expand in and removed rows collapse out
- Module switches crossfade over 120 ms with no slide; the terminal dock stays mounted and does not move
- Pulse only while connecting and restarting

**Never animate**: diff lines, terminal output, scrolling, lists longer than 100 rows, and anything during pane resizing.

**Reduced motion**: when the system sets reduced motion (`prefers-reduced-motion`), transforms drop to 0 ms and opacity fades stay at 80 ms
(set in both `motion.ts` and `main.css`, which caps every animation/transition duration at 80 ms).
Springs are interruptible, so they stop midway when the user starts a new action.

## Shadcn components

All components live in `src/renderer/src/components/ui/`. They are the project's own code and can be edited directly.

**Adding a component**

```powershell
npx shadcn@latest add <name>
npx prettier --write src/renderer/src/components/ui/<name>.tsx
```

After adding one, always replace `bg-black/NN` overlays with `bg-(--backdrop)`.
New renderer libraries go in `devDependencies`, following the project convention.

**Using components**

```tsx
import { cn } from 'cn'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { GitBranch, Settings } from 'lucide-react'

<Button variant="default" disabled={busy} onClick={push}>Push</Button>
<Button variant="outline" onClick={cancel}>Cancel</Button>
<Button variant="ghost" size="icon" aria-label="Settings" onClick={openSettings}>
  <Settings aria-hidden="true" />
</Button>
<Badge variant="success">Pushed</Badge>
<div className={cn('flex items-center gap-2 rounded-md bg-selected px-2', active && 'text-selected-foreground')}>
  <GitBranch aria-hidden="true" />
  main
</div>
```

- Import `cn` from `'cn'` (not the path shadcn generates); use it to combine conditional classes
- Import with the `@renderer/...` alias
- Use `lucide-react` for every icon, with `aria-hidden="true"` when it is not the button's name

**Color: token utilities only**

- Background and text: `bg-background`, `text-foreground`, `bg-ground`, `bg-muted`, `text-muted-foreground`, `bg-accent` (hover),
  `bg-selected`, `text-selected-foreground`, `bg-primary` / `text-primary-foreground`
- Status: `text-destructive`, `bg-destructive-soft`, `text-success`, `bg-success-soft`, `text-warning`, `bg-warning-soft`
- Lines and focus: `border-border`, `ring-ring`
- Accent as text: `text-(--accent)`; other raw values use `var(--token)` in the class, such as `bg-(--backdrop)`
- **No hex in `.tsx`.** If a token you need does not exist yet, add it to `tokens.css` and `@theme inline` first, then use the utility

**Legacy**: `legacy.css` should get no new rules for migrated components. Styles for new components belong in the component or in utilities.

## Interaction and accessibility

- Hover: a slight surface/border change; selected: gray background and stronger text
- Keyboard focus: a 2px `--accent` ring or outline with offset, visible on every surface
- Disabled: use native `disabled` and opacity; never turn it into clickable plain text
- Every icon-only action needs an accessible name (`aria-label`); every input needs a label or aria-label
- Checkboxes/radios keep their native width instead of stretching like text inputs
- When a long file name is truncated in the diff header, add a `title` with the full name
- Reduced motion turns off transforms and spinners as described in Motion
- Theme switching must update the terminal foreground/background/cursor/selection together with the UI

## Review checklist

1. Check dark/light: title bar, branch/file selection, diff, terminal, workspace menu, settings
2. Check Add existing repo through both Check and Confirm, including disabled, warning and error states
3. Tab through buttons/inputs to check focus; check icon button names and labels
4. Drag pane splitters and collapse/expand the terminal; reopen the app to confirm sizes are kept
5. Check long branch/file names and Thai text; check horizontal scrolling in the diff
6. Check for hardcoded hex in `.tsx` (there should be none) and durations not taken from `motion.ts`
7. Run `npm run typecheck`, `npx vitest run --project renderer`, `npx electron-vite build` and `npx eslint .`

Use these components and tokens for pages added later to keep one design.

On Windows, if `bash` on PATH points to WSL, select Git Bash in the session that runs tests
so the sandbox fixtures can use Windows paths:

```powershell
$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
npm test
```
