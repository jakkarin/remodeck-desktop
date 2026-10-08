# Phase 3 — Logs, exec, compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Containers module, open terminal tabs bound to a host that run `docker logs`, `docker exec` (shell) or `docker compose up/pull/restart/down` over `ssh -t`.

**Architecture:** A pure module builds and validates the remote command strings. `TerminalService` gains host tabs (no git bridge, no `-R` forward) that print an exit line and stay open. The renderer never sends a command: it sends a typed request (`logs`/`shell` + container id, or `compose` + project + action), and main resolves names, paths and files from `ContainerService`'s own list before building the command.

**Tech Stack:** Electron main (node-pty via `PtySpawner`), React 19, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-remodeck-containers-design.md` (§3.4, §4.1, §4.4, §5 compose row)

## Global Constraints

- logs command: `docker logs -f --tail 500 <id>`, label `logs · <name>`
- shell command: `docker exec -it <id> sh -c 'command -v bash >/dev/null && exec bash || exec sh'`, label `sh · <name>`
- compose command: `docker compose -p <project> --project-directory <dir> -f <file>… <up -d|down|pull|restart>`, label `<action> · <project>` (action word: `up`, `down`, `pull`, `restart`)
- When the command exits, the tab stays open with the line `[remodeck] exited with code N` until the user closes it.
- id must match `^[a-f0-9]{12,64}$` (`CONTAINER_ID`), project must match `^[a-z0-9][a-z0-9_-]*$`, every path passes `validateSandboxPath`. Every argument is shell-quoted (`shQuote` / `shPath` from `src/main/sandbox/shell.ts`) before it joins the ssh command.
- `closeAllForHost` closes both workspace tabs and host tabs.
- Danger levels come only from `dangerLevel()` in `src/renderer/src/danger.ts` (`logs`, `shell` → none; `compose-up`/`compose-pull`/`compose-restart` → none, or `click` on a protected host; `compose-down` → `click`, or `type` on a protected host).
- Compose with missing labels or missing files: the buttons stay clickable and the real result shows in the terminal tab. The group header tooltip shows the expected path.
- User-facing copy is Thai, except command or button names (Logs, Shell, Up, Pull, Restart, Down).
- Implementer commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Path with spaces or a single quote** (`/srv/my app/it's`): the path reaches docker unchanged because it is quoted, and nothing in it is executed. Test: Task 1.
2. **Compose project whose labels lack `working_dir` or `config_files`:** the command omits `--project-directory` or `-f` rather than throwing. Test: Task 1.
3. **Old project name with uppercase or a dot:** main rejects it with `ชื่อ compose project ไม่ถูกต้อง`. The renderer shows this in the error banner and does not crash. Tests: Task 1 and Task 3.
4. **Container removed between render and click:** main throws `ไม่พบ container นี้` and the banner shows it. Test: Task 3.
5. **Logs opened while the terminal panel is collapsed:** the panel expands, so the new tab is visible. Test: Task 4.

---

### Task 1: Remote command builders

**Files:**
- Modify: `src/shared/containers.ts` (types + regex only)
- Create: `src/main/docker/hostCommands.ts`
- Test: `tests/main/docker/hostCommands.test.ts`

**Interfaces:**
- Produces (shared):
  - `export type ComposeAction = 'up' | 'pull' | 'restart' | 'down'`
  - `export const COMPOSE_ACTIONS: readonly ComposeAction[] = ['up', 'pull', 'restart', 'down']`
  - `export const COMPOSE_PROJECT = /^[a-z0-9][a-z0-9_-]*$/`
  - `export type HostTerminalRequest = { kind: 'logs' | 'shell'; id: string } | { kind: 'compose'; project: string; action: ComposeAction }`
- Produces (main):
  - `logsCommand(id: string): string`
  - `shellCommand(id: string): string`
  - `composeCommand(p: { name: string; workingDir: string; configFiles: string[] }, action: ComposeAction): string`
  - `buildHostSshArgs(sshHost: string, remoteCmd: string): string[]`, which returns `['-t', sshHost, remoteCmd]`

- [ ] **Step 1: Write failing tests**

```ts
it('logs and shell commands quote the id', () => {
  const id = 'a'.repeat(12)
  expect(logsCommand(id)).toBe(`docker logs -f --tail 500 '${id}'`)
  expect(shellCommand(id)).toBe(
    `docker exec -it '${id}' sh -c 'command -v bash >/dev/null && exec bash || exec sh'`
  )
})
it('rejects ids that are not container ids', () => {
  for (const bad of ['abc', 'A'.repeat(12), 'a'.repeat(12) + ';rm', '--help'])
    expect(() => logsCommand(bad)).toThrow('container id ไม่ถูกต้อง')
})
it('compose command with dir and files, up adds -d', () => {
  expect(
    composeCommand({ name: 'shop', workingDir: '/srv/my app', configFiles: ["/srv/my app/it's.yml", '/srv/my app/b.yml'] }, 'up')
  ).toBe(
    `docker compose -p 'shop' --project-directory '/srv/my app' -f '/srv/my app/it'\\''s.yml' -f '/srv/my app/b.yml' up -d`
  )
})
it('compose omits missing dir and files', () => {
  expect(composeCommand({ name: 'shop', workingDir: '', configFiles: [] }, 'down')).toBe(`docker compose -p 'shop' down`)
})
it('compose rejects bad project names and relative paths', () => {
  expect(() => composeCommand({ name: 'My.App', workingDir: '', configFiles: [] }, 'pull')).toThrow('ชื่อ compose project ไม่ถูกต้อง')
  expect(() => composeCommand({ name: 'ok', workingDir: 'rel/dir', configFiles: [] }, 'pull')).toThrow()
  expect(() => composeCommand({ name: 'ok', workingDir: '/srv', configFiles: ['x.yml'] }, 'pull')).toThrow()
})
it('rejects an unknown compose action', () => {
  expect(() => composeCommand({ name: 'ok', workingDir: '', configFiles: [] }, 'rm' as ComposeAction)).toThrow()
})
it('buildHostSshArgs', () => {
  expect(buildHostSshArgs('box1', 'docker ps')).toEqual(['-t', 'box1', 'docker ps'])
})
```

- [ ] **Step 2: Run `npx vitest run tests/main/docker/hostCommands.test.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement the shared types and `hostCommands.ts`.** Use `shQuote` for the id and project, and `shPath` for paths after `validateSandboxPath`. The `~/` form is allowed.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): remote command builders for logs, shell and compose`.

### Task 2: Host tabs in TerminalService

**Files:**
- Modify: `src/main/terminal/terminalService.ts`
- Test: `tests/main/terminal.test.ts` (reuse the existing `setup()` and `FakePty`)

**Interfaces:**
- Consumes: `buildHostSshArgs` (Task 1).
- Produces: `TerminalService.openHost(hostId: string, remoteCmd: string, label: string): { tabId: string; label: string; hostId: string }`
  - Synchronous. Throws when the host is not connected (`connection.requireConnected`) or unknown (`ไม่พบ host`).
- Tab gains `kind: 'workspace' | 'host'`. For host tabs:
  - `workspaceId` is `null`.
  - No bridge or approval session is registered or revoked.
  - No idle event is emitted.
  - No forward-failure retry: spawn once with `buildHostSshArgs(host.sshHost, remoteCmd)`.

- [ ] **Step 1: Write failing tests**
  - `openHost spawns ssh -t <host> <cmd> without -R and registers no bridge session`
    - `calls[0]` equals `['-t','box1','docker ps']`
    - `bridge.registerSession` is not called
  - `host tab exit prints the exit line then emits exit`
    - After `exitCb({exitCode: 130})`, the data events end with `'\r\n[remodeck] exited with code 130\r\n'`, followed by `exit(tabId, 130)`.
    - `bridge.revokeSession` is not called.
  - `host tab output emits no idle`: fake timers, data, then advance `IDLE_MS`; no `idle` event.
  - `closeAllForHost closes host tabs too, emits exit -1`
  - `closeAllForWorkspace leaves host tabs open`
  - `openHost throws on disconnected host`
  - `spawn failure on openHost throws and leaves no tab`
- [ ] **Step 2: Run `npx vitest run tests/main/terminal.test.ts`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Keep the workspace path unchanged. Workspace tabs do not print the exit line.
- [ ] **Step 4: Run the test again.** Expected: all PASS.
- [ ] **Step 5: Commit** `feat(terminal): host-bound command tabs`.

### Task 3: `containers.openTerminal` IPC

**Files:**
- Modify: `src/main/docker/containerService.ts` (add lookups)
- Modify: `src/main/app.ts` (`containersApi` + wiring)
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `tests/main/containersApi.test.ts`, `tests/main/docker/containerService.test.ts`, `tests/main/ipc.test.ts` (channel list, if that test enumerates channels)

**Interfaces:**
- Consumes: Task 1 builders and request type; `TerminalService.openHost` (Task 2).
- Produces:
  - `ContainerService.find(hostId: string, id: string): ContainerInfo | null`
  - `ContainerService.project(hostId: string, name: string): ContainerProject | null`
    - Built with `groupContainers` over the current list. Returns null when the host is not open or nothing matches.
  - `RemodeckApi.containers.openTerminal(hostId: string, req: HostTerminalRequest): Promise<{ tabId: string; label: string; hostId: string }>`
    - Channel `containers:openTerminal`.
  - `containersApi` deps gain `terminal: Pick<TerminalService, 'openHost'>`, and `service` gains `'find' | 'project'`.

- [ ] **Step 1: Write failing tests (containersApi)**
  - `logs resolves the container name and opens a host tab`
    - `openHost` is called with `('h1', "docker logs -f --tail 500 '<id>'", 'logs · web-1')`.
  - `shell label is "sh · <name>"`
  - `compose uses the service's project dir and files, label "up · shop"`
  - `rejects when the container is not in the list` with `ไม่พบ container นี้`
  - `rejects an unknown compose project` with `ไม่พบ compose project นี้`
  - `rejects malformed requests`
    - Inputs: `null`, `{kind:'exec'}`, `{kind:'compose', project:'shop', action:'rm'}`.
    - Expected error: `Invalid terminal request`.
  - `requires a connected host` (`requireConnected` throws, so no `openHost`)
- [ ] **Step 2: Write failing tests (containerService)**
  - `find`/`project` return items from the open list.
  - They return null for an unopened host and after `dispose`.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Validate the shape in `containersApi` before any lookup.
  - Wire `terminal: term` in `createApp`. `containersApi` is built after `terminal`.
  - Add the preload `invoke` and channel constant.
- [ ] **Step 5: Run `npm run typecheck` and the tests.** Expected: 0 errors, PASS.
- [ ] **Step 6: Commit** `feat(containers): open logs, shell and compose terminals`.

### Task 4: Renderer terminal plumbing

**Files:**
- Modify: `src/renderer/src/terminalEvents.ts`, `src/renderer/src/components/TerminalTabs.tsx`
- Test: `tests/renderer/terminalEvents.test.ts` (create), `tests/renderer/TerminalTabs.test.tsx` (create if absent; mock `api` and `@xterm/xterm` as other renderer tests do. Check `tests/renderer/App.test.tsx` for the existing xterm mock.)

**Interfaces:**
- Produces: `openHostTerminal(hostId: string, req: HostTerminalRequest): Promise<OpenedTab>`
  - Calls `api.containers.openTerminal`, then `announceTerminal(tab)`, then returns it. Rejections propagate.
- `TerminalTabs`: when a tab is announced while `collapsed` is true, it calls `onToggle()` once so the panel expands.

- [ ] **Step 1: Write failing tests**
  - `openHostTerminal announces the opened tab`
  - `openHostTerminal does not announce on rejection`
  - `TerminalTabs expands when a tab opens while collapsed`: render with `collapsed` and `onToggle` spy, `announceTerminal(...)`, then `onToggle` is called once.
  - `TerminalTabs does not toggle when already expanded`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Read the latest `collapsed` and `onToggle` through a ref, so the listener effect does not re-subscribe.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): open host terminals and reveal the panel`.

### Task 5: Logs, shell and compose buttons

**Files:**
- Modify: `src/renderer/src/components/ContainerItem.tsx`, `src/renderer/src/components/ui/GroupedList.tsx`, `src/renderer/src/components/ContainersView.tsx`, `src/renderer/src/assets/main.css` (only if the header actions need layout)
- Modify: `docs/manual-test.md` (Containers section: logs, shell, compose up/down on a normal and a protected host, exit line)
- Test: `tests/renderer/ContainersView.test.tsx`

**Interfaces:**
- Consumes: `openHostTerminal` (Task 4), `dangerLevel`, `ConfirmDanger`.
- `ContainerItem` gains `onTerminal(kind: 'logs' | 'shell'): void`. The buttons go before the existing actions:
  - **Logs** (lucide `ScrollText`, `aria-label="Logs <name>"`): always enabled.
  - **Shell** (lucide `SquareTerminal`, `aria-label="Shell <name>"`): enabled only when `state === 'running'`.
- `GroupPanel` gains an optional `actions?: ReactNode` (rendered in the heading, outside the toggle button) and `titleHint?: string` (the toggle's `title`).
- `ContainersView`:
  - Each compose group has **Up / Pull / Restart / Down** buttons:
    - `aria-label="Up <project>"` etc.
    - Mapped to the danger actions `compose-up`, `compose-pull`, `compose-restart`, `compose-down`.
  - The group tooltip `titleHint` is:
    - `workingDir` + ` · ` + `configFiles.join(', ')` when both are present;
    - otherwise `ไม่พบ path ของ compose project (ผลจริงดูใน terminal)`.
  - `Pending` becomes `{ hostId, summary, confirmLabel, mode, run: () => Promise<void> }`. Container actions keep their current summary and label. Compose actions use summary `<action> · <project>` and label `Up`/`Pull`/`Restart`/`Down`.
  - The existing stale-host guard stays.
  - Errors from `openHostTerminal` go to the existing `actionError` banner.

- [ ] **Step 1: Write failing tests** (mock `openHostTerminal` via `vi.mock('../../src/renderer/src/terminalEvents')`)
  - `Logs opens a logs terminal for that container`
    - Expected call: `openHostTerminal('h1', {kind:'logs', id})`.
  - `Shell is disabled for a stopped container and opens shell for a running one`
  - `compose Up runs immediately on a normal host`
    - Expected call: `{kind:'compose', project:'shop', action:'up'}`.
  - `compose Up asks for click confirm on a protected host`
  - `compose Down asks click on normal and typed host label on protected`
  - `compose group tooltip shows the path, or the missing-path hint`
  - `openHostTerminal rejection shows the error banner`
- [ ] **Step 2: Run `npx vitest run tests/renderer/ContainersView.test.tsx`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement**, then update `docs/manual-test.md`.
- [ ] **Step 4: Run the full suite (`npx vitest run`) and `npm run typecheck`.** Expected: all PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(renderer): logs, shell and compose actions in containers`.
