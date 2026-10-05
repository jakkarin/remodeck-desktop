# UX/UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar + page-swap UI with a GitHub-Desktop-style 3-column layout (Branches · Changes · Diff) over a docked terminal, with per-file diffs and automatic sync.

**Architecture:** Main gains read-only per-file queries on the mirror, a light sandbox-only fetch, a terminal-idle signal and an `AutoSync` scheduler that owns every sync of the active workspace. The renderer is rebuilt around a top-bar workspace switcher and three panes inside a resizable grid, themed by Primer tokens that follow the OS light/dark setting.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, Vitest (projects `node` + `renderer`/jsdom, RTL), xterm.js, node-pty, system git; new dependency `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-10-05-ux-redesign-design.md`

## Global Constraints

- Zero footprint (MVP spec): nothing new is written to the sandbox; light sync only fetches `ws-<id>` into the mirror.
- Exactly one new dependency: `lucide-react`. No layout/split library.
- Auto sync: light every 30 000 ms and on terminal idle; full every 300 000 ms (counted from the last full sync, manual included); terminal idle = 3 000 ms of silence after output.
- Diff truncation: 5 000 lines, then a "แสดงทั้งหมด" button.
- localStorage keys: `regit.layout`, `regit.seen`; every read/write in try/catch, failure = defaults (never an error).
- UI copy is Thai where the spec gives Thai text; reuse the existing strings/dialogs otherwise.
- `workspaces.diff(id, branch)` without opts must return byte-identical output to today.
- Match surrounding code: no semicolons, single quotes, 2-space indent, explicit return types (eslint config).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Switching branch (or commit) quickly: a slow response for the previous selection must never overwrite the current one — Task 9 test `ignores stale responses`.
2. The selected branch disappears after a sync (AI deleted it): selection clears, no error banner — Task 9 test `clears selection when branch vanishes`.
3. The active workspace is removed (or its host removed): app selects the first remaining workspace or the empty state; AutoSync for the removed id stops without throwing — Task 4 test `unknown workspace is a no-op` and Task 8 test `removing active workspace selects next`.
4. Branch names containing `/` (`feat/a`) flow through files/diff/commit queries — Task 1 tests use `feat/a`.
5. Host drops while an auto sync is running: no popup, Sync button shows the error state, next tick after reconnect works — Task 4 test `error reports and next tick still runs`.

---

### Task 1: Per-file queries on the mirror

**Files:**
- Modify: `src/shared/types.ts` (add `FileChange`)
- Modify: `src/main/git/parsers.ts` (add `parseFileChanges`)
- Modify: `src/main/sync/queries.ts` (add `listFiles`, `requireCommitInRange`; extend `getDiff`)
- Test: `tests/main/git/parsers.test.ts`, `tests/main/sync/queries.test.ts`

**Interfaces:**
- Produces:
  - `type FileChange = { path: string; oldPath?: string; status: 'A' | 'M' | 'D' | 'R'; additions: number | null; deletions: number | null }` (`null` = binary). Map git `C` → `A`, `T` → `M`.
  - `parseFileChanges(numstatZ: string, nameStatusZ: string): FileChange[]` — order follows name-status.
  - `listFiles(git: HostGit, mirrorPath: string, base: string, ref: string, commit?: string): Promise<FileChange[]>`
  - `getDiff(git, mirrorPath, base, ref, opts?: { commit?: string; file?: string }): Promise<string>`
  - `requireCommitInRange(git, mirrorPath, base, ref, sha): Promise<void>` — throws `Error('commit ไม่อยู่ใน branch นี้')` unless `sha` matches `/^[0-9a-f]{40}$/`, is an ancestor of `ref`, and is not an ancestor of `base`.

- [ ] **Step 1: Parser tests** in `parsers.test.ts`, `describe('parseFileChanges')`, built from literal `-z` strings:
  - add+modify: `'3\t0\ta.txt\0' + '1\t1\tb.txt\0'` with `'A\0a.txt\0M\0b.txt\0'` → `[{path:'a.txt',status:'A',additions:3,deletions:0},{path:'b.txt',status:'M',additions:1,deletions:1}]`
  - delete: status `'D'`
  - rename: numstat `'0\t0\t\0old name.txt\0ใหม่.txt\0'`, name-status `'R100\0old name.txt\0ใหม่.txt\0'` → `{path:'ใหม่.txt',oldPath:'old name.txt',status:'R',additions:0,deletions:0}`
  - binary: numstat `'-\t-\timg.png\0'` → `additions:null, deletions:null`
  - empty input → `[]`
- [ ] **Step 2: Query tests** in `queries.test.ts` (reuse the file's `makeWs` / sync setup; the sandbox branch is `feat/a`):
  - `listFiles` over the branch returns every changed file with counts; with `commit` = the older of two commits returns only that commit's files
  - root commit (commit with no parent) works via `commit`
  - `getDiff(..., { file: 'dir/with space.txt' })` contains only that file's hunk; `getDiff` without opts equals `git diff base...ref` output exactly
  - `getDiff(..., { commit, file })` shows only that commit's change to that file
  - `requireCommitInRange` resolves for a branch commit; rejects for a commit on `origin/main`, for `'HEAD'`, and for `'--output=x'`
- [ ] **Step 3: Run** `npx vitest run tests/main/git/parsers.test.ts tests/main/sync/queries.test.ts` — expect FAIL (not exported).
- [ ] **Step 4: Implement.** Branch range uses `git diff -M --numstat -z base...ref` and `--name-status -z`; commit mode uses `git diff-tree -r --root -M --no-commit-id --numstat -z <sha>` (and `--name-status`, and `-p` for the diff). `file` is passed after `--` as `:(literal)<path>`; for a rename include both old and new path.
- [ ] **Step 5: Run** the same command — expect PASS; then `npm run typecheck`.
- [ ] **Step 6: Commit** `feat(git): per-file changes and diffs from the mirror`.

### Task 2: Light sync (`fetchSandbox`)

**Files:**
- Modify: `src/main/sync/syncService.ts`
- Test: `tests/main/sync/sync.test.ts`

**Interfaces:**
- Produces: `SyncService.fetchSandbox(ws: Workspace): Promise<{ rewritten: string[] }>`; `rewrittenBranches()` reflects whichever of `sync`/`fetchSandbox` ran last.

- [ ] **Step 1: Tests** in `sync.test.ts`, new `describe('SyncService.fetchSandbox')`:
  - new sandbox commit on `feat/a` appears under `refs/remotes/ws-<id>/feat/a` after `fetchSandbox`
  - `refs/remotes/origin/*` in the mirror unchanged when the fake GitHub got a new commit (compare `for-each-ref` before/after)
  - sandbox `refs/remotes/origin/*` and tags unchanged (nothing pushed into the sandbox)
  - amend in the sandbox → `rewritten` contains `feat/a` and `rewrittenBranches()` too
- [ ] **Step 2: Run** `npx vitest run tests/main/sync/sync.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Extract the before/after rewritten detection from `sync()` into a private `fetchWorkspace(mirrorPath, wsId): Promise<string[]>` (lists refs, `fetch --prune --no-tags ws-<id>`, compares with `merge-base --is-ancestor`); `sync()` calls it after the origin fetch, `fetchSandbox()` calls it alone under `withLock`. Existing `sync` tests must stay green.
- [ ] **Step 4: Run** `npx vitest run tests/main/sync` — PASS.
- [ ] **Step 5: Commit** `feat(sync): light sandbox-only fetch`.

### Task 3: Terminal idle signal

**Files:**
- Modify: `src/main/terminal/terminalService.ts`
- Test: `tests/main/terminal.test.ts`

**Interfaces:**
- Produces: `TerminalService` emits `'idle', workspaceId: string` once per quiet period; exported const `IDLE_MS = 3000`.

- [ ] **Step 1: Tests** (fake timers, existing `setup()`/`FakePty`):
  - data on a tab then 3000 ms silence → one `idle` with the tab's workspaceId
  - continuous data every 1000 ms → no `idle` until it stops
  - after `idle`, further silence emits nothing more; new data re-arms
  - closing the tab before 3000 ms → no `idle`
- [ ] **Step 2: Run** `npx vitest run tests/main/terminal.test.ts` — FAIL.
- [ ] **Step 3: Implement** a per-tab timer reset in the existing `pty.onData` handler, cleared in `release`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(terminal): emit idle after output goes quiet`.

### Task 4: AutoSync scheduler

**Files:**
- Create: `src/main/sync/autoSync.ts`
- Modify: `src/shared/types.ts` (add `SyncInfo`)
- Test: `tests/main/sync/autoSync.test.ts`

**Interfaces:**
- Consumes: nothing concrete — dependencies are injected.
- Produces:
  - `type SyncInfo = { kind: 'light' | 'full'; at: number; error?: string }`
  - `class AutoSync` with
    `constructor(deps: { light(wsId: string): Promise<unknown>; full(wsId: string): Promise<{ rewritten: string[] }>; canSync(wsId: string): boolean; onSynced(wsId: string, info: SyncInfo): void; now?: () => number })`,
    `setActive(wsId: string | null): void`, `idle(wsId: string): void`, `syncNow(wsId: string): Promise<{ rewritten: string[] }>`, `stop(): void`.
  - Constants `LIGHT_MS = 30_000`, `FULL_MS = 300_000`.
  - `canSync` returns false for an unknown workspace or a host that is not connected.

Rules: only the active workspace ticks; one run at a time; a light request while running is dropped; a full request (tick or `syncNow`) while running waits for the current run then runs once (multiple waiters share it); auto runs report errors via `onSynced(..., { error })` and never reject; `syncNow` also reports via `onSynced` and then rejects with the error.

- [ ] **Step 1: Tests** (`vi.useFakeTimers()`, deps as `vi.fn`):
  - `setActive('w1')`: after 30 000 ms `light('w1')` called once; after 300 000 ms `full('w1')` called
  - `idle('w1')` → light now; `idle('w2')` while w1 active → nothing
  - light pending (unresolved promise) + second light → only one call
  - full requested during a light run → runs right after it, once, even if requested twice
  - `syncNow` resets the full timer (no extra full until 300 000 ms after it)
  - `canSync` false → no calls on ticks; `syncNow` rejects with `'Host ยังไม่ได้ connect'`
  - `unknown workspace is a no-op`: `canSync` false for removed id, ticks don't throw
  - `error reports and next tick still runs`: light rejects → `onSynced('w1', {kind:'light', at, error})`; next tick calls light again
  - `setActive(null)` / `stop()` → no more calls
- [ ] **Step 2: Run** `npx vitest run tests/main/sync/autoSync.test.ts` — FAIL.
- [ ] **Step 3: Implement** with `setInterval` for light and a `setTimeout` re-armed after each full run.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(sync): auto sync scheduler for the active workspace`.

### Task 5: IPC contract and main wiring

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts`
- Test: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: Task 1 `listFiles`, `getDiff` opts, `requireCommitInRange`; Task 2 `fetchSandbox`; Task 3 `'idle'`; Task 4 `AutoSync`, `SyncInfo`.
- Produces (RegitApi):
  - `workspaces.files(id: string, branch: string, commit?: string): Promise<FileChange[]>` — channel `workspaces:files`
  - `workspaces.diff(id: string, branch: string, opts?: { commit?: string; file?: string }): Promise<string>`
  - `workspaces.setActive(id: string | null): void` — channel `workspaces:setActive`, in `SEND_CHANNELS`
  - `workspaces.sync(id)` unchanged signature, now `autoSync.syncNow(id)`
  - event `'workspace-synced'` → channel `event:workspace-synced`, `cb(id: string, info: SyncInfo)`

- [ ] **Step 1: Tests** in `ipc.test.ts`: existing generic tests cover the new channels once the contract has them; add: `workspaces:setActive` is registered with `ipcMain.on`; `IPC_CHANNELS.events['workspace-synced'] === 'event:workspace-synced'`.
- [ ] **Step 2: Run** `npx vitest run tests/main/ipc.test.ts` — FAIL.
- [ ] **Step 3: Implement** contract + preload; in `app.ts`: `files`/`diff` call `requireCommitInRange` when `commit` is given; build `AutoSync` with `light = fetchSandbox`, `full = sync.sync`, `canSync = workspace exists && connection.status(host).state === 'connected'`, `onSynced = send(EV['workspace-synced'], ...)`; `term.on('idle', (wsId) => autoSync.idle(wsId))`; `rebuildMirror` keeps calling `sync.sync` directly (it already holds its own flow); `dispose` calls `autoSync.stop()`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — PASS (renderer tests still use the old API and must stay green).
- [ ] **Step 5: Commit** `feat(ipc): files, per-file diff, active workspace and sync events`.

### Task 6: Theme tokens, icons, terminal theme

**Files:**
- Modify: `package.json` / `package-lock.json` (`npm i lucide-react`)
- Rewrite: `src/renderer/src/assets/main.css`
- Create: `src/renderer/src/theme.ts`
- Modify: `src/renderer/src/components/TerminalTabs.tsx`
- Test: `tests/renderer/theme.test.ts`

**Interfaces:**
- Produces: CSS custom properties on `:root` (light) and inside `@media (prefers-color-scheme: dark)`: `--bg --bg-subtle --bg-inset --border --fg --fg-muted --accent --success --danger --attention --diff-add-bg --diff-add-fg --diff-del-bg --diff-del-fg --selected-bg --selected-fg --topbar-bg --topbar-fg` (topbar `#24292f` light / `#010409` dark; other values from GitHub Primer light/dark). Button classes `.primary` (accent) and `.success` (Push).
- `xtermTheme(read: (name: string) => string): ITheme` in `theme.ts` mapping `background ← --bg-inset`, `foreground ← --fg`, `cursor ← --fg`, `selectionBackground ← --selected-bg`; and `watchColorScheme(cb: () => void): () => void` (matchMedia listener, unsubscribe).

- [ ] **Step 1: Test** `xtermTheme` maps the four names (pass a fake reader); `watchColorScheme` calls cb on a mocked `matchMedia` change and stops after unsubscribe.
- [ ] **Step 2: Run** `npx vitest run tests/renderer/theme.test.ts` — FAIL.
- [ ] **Step 3: Implement**; `TerminalPane` sets `theme: xtermTheme(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim())` on create and on scheme change. Old class names used by current components keep working until Task 9 removes them.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(ui): Primer theme tokens following the OS, lucide icons`.

### Task 7: SplitLayout and the "seen" store

**Files:**
- Create: `src/renderer/src/components/SplitLayout.tsx`, `src/renderer/src/seen.ts`, `src/renderer/src/storage.ts`
- Test: `tests/renderer/SplitLayout.test.tsx`, `tests/renderer/seen.test.ts`

**Interfaces:**
- Produces:
  - `storage.ts`: `readJson<T>(key: string, fallback: T): T`, `writeJson(key: string, v: unknown): void` — both swallow every error.
  - `seen.ts`: `type SeenMap = Record<string, Record<string, string>>`; `markBaseline(m: SeenMap, wsId: string, branches: BranchInfo[]): SeenMap` (if `m[wsId]` absent, record every branch sha; else unchanged); `isNew(m: SeenMap, wsId: string, b: BranchInfo): boolean` (true if `m[wsId]` exists and its sha for `b.name` differs or is missing); `markSeen(m, wsId, b): SeenMap`; `loadSeen(): SeenMap` / `saveSeen(m): void` over key `regit.seen`.
  - `SplitLayout({ left, middle, right, bottom, bottomCollapsed }: {...ReactNode; bottomCollapsed: boolean}): JSX.Element` — CSS grid with two vertical dividers and one horizontal divider (`role="separator"`), drag via pointer events; minimum 160 px per column and 80 px for the terminal; sizes `{ left: number; middle: number; bottom: number }` persisted under `regit.layout`; when `bottomCollapsed` only the terminal tab bar shows.

- [ ] **Step 1: Tests**
  - seen: first `markBaseline` → no branch `isNew`; changed sha → `isNew`; unseen new branch → `isNew`; `markSeen` clears it; `loadSeen` with `localStorage.getItem` throwing → `{}`; `saveSeen` with `setItem` throwing → no throw
  - SplitLayout: renders the four slots; dragging the first separator by +50 px widens left by 50 and writes `regit.layout`; remount reads it back; drag below minimum clamps to 160; corrupt JSON in `regit.layout` → defaults
- [ ] **Step 2: Run** `npx vitest run tests/renderer/seen.test.ts tests/renderer/SplitLayout.test.tsx` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(ui): resizable split layout and branch seen-state`.

### Task 8: Top bar, workspace switcher, settings dialog, app state

**Files:**
- Modify: `src/renderer/src/state.tsx`, `src/renderer/src/components/RemoveDialogs.tsx`, `src/renderer/src/components/CloneDialog.tsx`
- Create: `src/renderer/src/components/TopBar.tsx`, `WorkspaceSwitcher.tsx`, `SettingsDialog.tsx`
- Test: `tests/renderer/WorkspaceSwitcher.test.tsx`, `tests/renderer/TopBar.test.tsx`, update `tests/renderer/CloneDialog.test.tsx`

**Interfaces:**
- Consumes: Task 5 `setActive`, `sync`, event `workspace-synced`; Task 6 classes.
- Produces (AppState, replacing `selected`/`select`):
  - `activeWorkspaceId: string | null`, `selectWorkspace(id: string | null): void` — also calls `api.workspaces.setActive(id)`
  - `syncInfo: Record<string, SyncInfo>` fed by `workspace-synced`
  - after every `refresh()`, if the active id no longer exists → select the first workspace or `null`; on first load select the first workspace
- `CloneDialog` props become `{ hostIds: string[]; onClose; onCloned }`; shows a host `<select>` only when `hostIds.length > 1`.
- `TopBar({ onOpenSettings }: { onOpenSettings(): void })`.

Ruling (spec §6 put branch/commit/file selection in `state.tsx`): keep those in the workspace screen (Task 9), remounted per workspace via `key` — same reset behaviour, smaller global state.

- [ ] **Step 1: Tests**
  - switcher: lists hosts with status dot class `connected|disconnected|error|connecting`; `Connect` only for disconnected, `Retry` for error; host error text shown under it; workspaces of a disconnected host have `aria-disabled`-style dim class but are still selectable; clicking a workspace calls `selectWorkspace`; `Remove host` disabled with tooltip when it has workspaces; `＋ Clone repo…` disabled when no host connected and opens `CloneDialog` with connected host ids
  - top bar: Sync button shows `Sync · 12s` from `syncInfo` (`now` mocked), has class `warn` and `title` = error when the last info has `error`; clicking calls `api.workspaces.sync` and shows the error banner if it rejects; disabled with tooltip when host disconnected; ⚙ calls `onOpenSettings`
  - `removing active workspace selects next` (state test through `RemoveWorkspaceDialog`)
  - CloneDialog: host select only with >1 host; clone uses the chosen host
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — new tests FAIL.
- [ ] **Step 3: Implement.** Workspace ⋯ menu holds `Rebuild mirror` (existing `rebuildMirror(repoId, wsId)`) and `Remove workspace`. `SettingsDialog` wraps `SettingsView` in the existing dialog styling with a close button. Keep `Sidebar`/`WorkspaceView` compiling against the new state for now (they are deleted in Task 9).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(ui): top bar with grouped workspace switcher`.

### Task 9: Branches, Changes, Diff panes and the new App layout

**Files:**
- Create: `src/renderer/src/components/WorkspaceScreen.tsx`, `BranchPane.tsx`, `ChangesPane.tsx`, `DiffPane.tsx`, `EmptyState.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/TerminalTabs.tsx` (collapse button `⌄`, `+` opens a terminal in the active workspace, receives `collapsed`/`onToggle`)
- Delete: `Sidebar.tsx`, `WorkspaceView.tsx`, `ReviewView.tsx` and their tests (move still-relevant cases: push outcome, Open PR enablement, rewritten banner, worktree terminal button)
- Test: `tests/renderer/WorkspaceScreen.test.tsx`, `tests/renderer/DiffPane.test.tsx`, `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: Task 5 `files`, `diff(opts)`, `branches`, `commits`, `worktrees`, `push`, `openPR`; Task 7 `SplitLayout`, seen functions; Task 8 AppState.
- Produces: `WorkspaceScreen({ workspaceId })` (rendered with `key={workspaceId}`), `DiffPane({ text, path, oldPath, binary })`.

Behaviour (spec §2, §4): branch list with `↑ahead`, `↓behind` when > 0, badges ● (`isNew`), `merged`, `⚠ rewritten`; a Worktrees subsection (connected only) with short path, branch or `detached`, `N✎` when dirty and a ＞_ button opening a terminal at that path; ↑/↓ move selection; selecting a branch → `markSeen`, load commits + files, auto-select first file; clicking a commit filters files/diff, clicking it again clears; PushBar always at the bottom of the Changes column with the existing push/Open PR rules; reload branches on `workspace-synced` for this workspace, refetch commits/files/diff only if the selected branch's sha changed, keeping the selected file if it still exists; disconnected → yellow banner with Connect, Sync/Push/＞_/`+` disabled with `title`, worktrees hidden; per-pane red error banners, mirror git errors (`git ` / `fatal:`) get a Rebuild mirror button.

- [ ] **Step 1: Tests**
  - click branch → commits and files shown, first file's diff requested with `{ file }`; click another file → its diff
  - click commit → `files(id, branch, sha)` and `diff(id, branch, { commit, file })`; click again → back to branch-wide
  - `ignores stale responses`: files for branch A resolve after branch B was selected → A's files never rendered
  - `clears selection when branch vanishes`: `workspace-synced` → branches no longer include the selected one → Changes shows "เลือก branch ทางซ้าย", no error
  - ● shows for a branch whose sha changed since baseline and disappears after selecting it
  - empty states: no hosts → "เพิ่ม sandbox แรก" + Add host; hosts but no workspace → Clone repo (or Connect when none connected); branch with 0 ahead → "ไม่มี commit ใหม่เทียบกับ base"
  - disconnected: banner + disabled Push/Sync/terminal buttons with tooltips, branches still listed
  - DiffPane: 5 001-line text renders 5 000 lines + "แสดงทั้งหมด", click shows all; binary → "Binary file"; rename header `old → new`
  - moved cases from the deleted tests stay green
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — FAIL.
- [ ] **Step 3: Implement.** Guard every async load with a request counter or `live` flag so only the latest selection writes state.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` — PASS.
- [ ] **Step 5: Commit** `feat(ui): three-pane workspace screen replaces sidebar and review page`.

### Task 10: End-to-end coverage and manual checklist

**Files:**
- Modify: `tests/e2e/sandbox.e2e.test.ts`, `docs/manual-test.md`

**Interfaces:**
- Consumes: Task 5 API (`setActive`, `files`, `diff` opts, event `workspace-synced`). The light path is reached the real way: `api.workspaces.setActive(id)`, run a command in an app terminal, and the 3 s idle triggers a light sync — no test-only hooks. `backend.requests` (existing `tests/helpers/httpBackend.ts`) proves GitHub was not contacted.

- [ ] **Step 1: Tests** in the existing terminal block:
  - AI commits `feat-light` in the sandbox via the terminal `run()` helper; within 10 s a `workspace-synced` event `{ kind: 'light' }` arrives and `branches()` lists `feat-light`; the http-backend request log has no new request during that window
  - `files(id, 'feat-light')` lists the committed file with correct counts; `diff(id, 'feat-light', { file })` contains its added line
- [ ] **Step 2: Run** `npm run test:e2e` (Docker running) — new tests PASS along with the existing 19.
- [ ] **Step 3: Docs** — `docs/manual-test.md`: add a "UI redesign" section: light/dark follows OS (terminal included); drag dividers, restart app, sizes kept; ● appears after an AI commit in the terminal without pressing Sync; Sync button turns yellow when the host drops.
- [ ] **Step 4: Commit** `test(e2e): light sync and per-file diff against a real sandbox`.
