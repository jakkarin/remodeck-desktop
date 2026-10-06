# Phase 1 — Host context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the host the app-wide context: pick a host once in the topbar, connect needs only ssh, git is probed when the Git module opens, hosts can be marked protected, and an activity bar hosts the modules.

**Architecture:** Main: `ConnectionService.connect` becomes an ssh reachability check; it gains `probeGit(hostId, force)` that runs the existing `PREFLIGHT_SCRIPT` + `checkRemoteForward` once per connection and caches the result. Renderer: `AppState` gains `activeHostId` (persisted) and per-host git capabilities; host management moves from `WorkspaceSwitcher` into a new `HostSelector`; a new `GitModule` gates the existing `WorkspaceScreen` on connection and git presence; an `ActivityBar` holds Git and Settings.

**Tech Stack:** Electron 39, React 19, TypeScript, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-remodeck-containers-design.md` (this plan covers §7 Phase 1 except `ConfirmDanger`, which moves to Phase 2 where its first caller lives; the Containers icon is also added in Phase 2).

**Deviation from spec §2.2:** IPC is `hosts.probeGit(hostId, force?)` instead of a generic `hosts.probe(hostId, kind)`; Phase 2 adds `hosts.probeDocker`. Each returns its own type, so no union to narrow.

## Global Constraints

- No new runtime dependencies.
- UI copy stays in Thai as in the existing app; reuse the existing git messages verbatim:
  - no git: `ไม่พบ git บนเครื่องนี้ — ติดตั้งก่อน เช่น sudo apt install git หรือ sudo dnf install git แล้วกด Reload`
  - no HTTP: `git บนเครื่องนี้ไม่รองรับ HTTP — push/pull จาก terminal ของแอปจะใช้ไม่ได้`
  - no forward: `sshd ปิด AllowTcpForwarding — push/pull จาก terminal ของแอปจะใช้ไม่ได้`
- ssh failure message format is unchanged: `${detail}\nลองรัน ssh ${sshHost} ใน terminal ของระบบก่อน`.
- localStorage keys: `remodeck.activeHost`, `remodeck.lastWorkspace` — always via `readJson` / `writeJson` in `src/renderer/src/storage.ts`.
- Icons: lucide-react only (`GitBranch`, `Settings`, `Lock`, `Server`).
- Git Bridge, push approval, mirror and sync behavior must not change.
- Every task ends with `npm run typecheck` and `npx vitest run` green.

## Review Focus

1. **Active host removed** — removing the selected host falls back to the first remaining host (or none) without a crash. Test in Task 4.
2. **Stale stored host id** — `remodeck.activeHost` pointing at a deleted host falls back to the first host. Test in Task 4.
3. **Disconnect during a git probe** — a probe that finishes after `disconnect` must not populate the cache. Test in Task 2.
4. **Concurrent probes** — two `probeGit` calls while one is running cause one ssh exec. Test in Task 2.
5. **Switching host hides, never closes, terminals** — tabs of the other host stay alive (no `terminal.close`), and reappear when switching back. Test in Task 6.

---

### Task 1: `Host.protected` in types and store

**Files:**
- Modify: `src/shared/types.ts` (`Host`)
- Modify: `src/main/store/store.ts` (`load`, `addHost`, `updateHost`)
- Modify: `src/shared/ipc.ts` (`hosts.update` patch type)
- Modify: `src/main/app.ts` (`hosts.update` validation)
- Test: `tests/main/store.test.ts`

**Interfaces:**
- Produces: `type Host = { id: string; sshHost: string; label: string; protected: boolean }`; `Store.updateHost(id, patch: { label?: string; protected?: boolean }): Host`; IPC `hosts.update(id, patch: { label?: string; protected?: boolean }): Promise<Host>`.

- [ ] **Step 1: Write the failing tests** in `tests/main/store.test.ts`

```ts
it('adds hosts unprotected', () => {
  expect(store.addHost('box', 'Box').protected).toBe(false)
})
it('loads old hosts without protected as unprotected, and coerces non-booleans', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    hosts: [{ id: 'a', sshHost: 'a', label: 'A' }, { id: 'b', sshHost: 'b', label: 'B', protected: 'yes' }]
  }))
  const s = new Store(dir)
  expect(s.config.hosts.map((h) => h.protected)).toEqual([false, false])
})
it('updates protected without touching the label', () => {
  const h = store.addHost('box', 'Box')
  expect(store.updateHost(h.id, { protected: true })).toMatchObject({ label: 'Box', protected: true })
  expect(new Store(dir).config.hosts[0].protected).toBe(true)
})
it('rejects a non-boolean protected', () => {
  const h = store.addHost('box', 'Box')
  expect(() => store.updateHost(h.id, { protected: 'x' as never })).toThrow()
})
```

- [ ] **Step 2: Run** `npx vitest run tests/main/store.test.ts` — Expected: the four new tests FAIL.

- [ ] **Step 3: Implement.** `load` maps each host to `{ ...h, protected: h.protected === true }`; `addHost` sets `protected: false`; `updateHost` accepts `protected` (throws `Host protected must be a boolean` when not a boolean). In `app.ts` `hosts.update`: accept a plain object whose `label` is a string when present and `protected` is a boolean when present, at least one of them given; otherwise `throw new Error('Invalid host patch')`. Fix type errors in test fixtures that build `Host` literals by adding `protected: false`.

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(hosts): protected flag on hosts`

---

### Task 2: Connect = ssh only; cached `probeGit`

**Files:**
- Modify: `src/shared/types.ts` (`HostStatus`, new `GitCapability`)
- Modify: `src/main/connection/connectionService.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts` (new `hosts.probeGit`)
- Test: `tests/main/connection.test.ts`

**Interfaces:**
- Produces:
  - `type HostStatus = { state: HostState; error?: string }` (`gitVersion` and `warnings` removed)
  - `type GitCapability = { version: string; remoteHttp: boolean; forward: boolean }`
  - `ConnectionService.probeGit(hostId: string, force?: boolean): Promise<GitCapability | null>` — `null` = no git; throws `Host ยังไม่ได้ connect` when not connected
  - IPC `hosts.probeGit(hostId: string, force?: boolean): Promise<GitCapability | null>` (channel `hosts:probeGit`)

- [ ] **Step 1: Write the failing tests.** Replace the old connect tests that asserted git/warnings. `fakeTarget` now answers per script: `'true\n'` → connect check, `PREFLIGHT_SCRIPT` → preflight output. Keep a call counter.

```ts
it('connects a host that has no git', async () => {
  const { svc } = make({ connect: ok(''), preflight: ok('git=\nremotehttp=0\n') })
  expect(await svc.connect('h')).toEqual({ state: 'connected' })
})
it('reports ssh failure as before', async () => {
  const { svc } = make({ connect: { code: 255, stdout: '', stderr: 'no route' } })
  const s = await svc.connect('h')
  expect(s.state).toBe('error')
  expect(s.error).toBe('no route\nลองรัน ssh ai-box ใน terminal ของระบบก่อน')
})
it('probeGit returns null without git and skips the forward check', async () => {
  const { svc, checkForward } = make({ connect: ok(''), preflight: ok('git=\nremotehttp=0\n') })
  await svc.connect('h')
  expect(await svc.probeGit('h')).toBeNull()
  expect(checkForward).not.toHaveBeenCalled()
})
it('probeGit returns the capability and caches it until force', async () => {
  const { svc, calls } = make({ connect: ok(''), preflight: ok('git=git version 2.43.0\nremotehttp=1\n') }, false)
  await svc.connect('h')
  expect(await svc.probeGit('h')).toEqual({ version: 'git version 2.43.0', remoteHttp: true, forward: false })
  await svc.probeGit('h')
  expect(calls.preflight).toBe(1)
  await svc.probeGit('h', true)
  expect(calls.preflight).toBe(2)
})
it('dedupes concurrent probes', async () => { /* two probeGit without await → calls.preflight === 1 */ })
it('drops a probe result that lands after disconnect', async () => {
  // preflight resolves via a deferred; disconnect before resolving; reconnect; next probeGit runs a fresh preflight
})
it('clears the cache on disconnect', async () => { /* probe, disconnect, connect, probe → calls.preflight === 2 */ })
it('probeGit on a disconnected host throws', async () => {
  await expect(make({}).svc.probeGit('h')).rejects.toThrow('Host ยังไม่ได้ connect')
})
```

- [ ] **Step 2: Run** `npx vitest run tests/main/connection.test.ts` — Expected: new tests FAIL.

- [ ] **Step 3: Implement.** `doConnect` runs `target.exec('true\n')`; exit 255 or a thrown error → existing `sshFail`; any other non-zero exit → `sshFail(stderr.trim() || \`ssh exit ${code}\`)`; else `{ state: 'connected' }`. `probeGit` keeps `caps: Map<hostId, GitCapability | null>` and `probing: Map<hostId, Promise>`; it records the connection generation at start and stores the result only if the generation is unchanged. `disconnect` and the start of `doConnect` clear both maps for the host. `checkForward` runs only when git is present. Add `probeGit` to `IPC_CHANNELS.hosts`, the preload mapping, and `app.ts` (`hostOf(id)` then `connection.probeGit(id, force === true)`).

- [ ] **Step 4: Run** `npm run typecheck` — fix renderer compile errors from the removed `warnings` field by deleting the warnings block in `WorkspaceSwitcher.tsx` (Task 5 re-adds warnings in `GitModule`) and the `warnings: []` literals in tests and `DISCONNECTED` constants. Then `npx vitest run` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(connection): connect checks ssh only; git probed on demand`

---

### Task 3: Terminal tabs carry their host

**Files:**
- Modify: `src/main/terminal/terminalService.ts` (`open` return)
- Modify: `src/shared/ipc.ts` (`terminal.open` return type)
- Modify: `src/renderer/src/terminalEvents.ts` (`OpenedTab`)
- Test: `tests/main/terminal.test.ts`

**Interfaces:**
- Produces: `terminal.open(workspaceId, path?): Promise<{ tabId: string; label: string; hostId: string }>`; `type OpenedTab = { tabId: string; label: string; hostId: string }`.

- [ ] **Step 1: Write the failing test** in `tests/main/terminal.test.ts`: `expect(await svc.open('w1')).toMatchObject({ hostId: 'h1' })`.
- [ ] **Step 2: Run** `npx vitest run tests/main/terminal.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** by returning `{ tabId, label, hostId: ws.hostId }` and widening the types.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(terminal): tabs report their host`

---

### Task 4: Host context in renderer state

**Files:**
- Create: `src/renderer/src/hostContext.ts`
- Modify: `src/renderer/src/state.tsx`
- Test: `tests/renderer/hostContext.test.ts`, `tests/renderer/state.test.tsx`

**Interfaces:**
- Consumes: `api.hosts.probeGit` (Task 2), `GitCapability` (Task 2).
- Produces (in `hostContext.ts`):
  - `readActiveHost(): string | null`, `saveActiveHost(id: string | null): void` (key `remodeck.activeHost`)
  - `readLastWorkspaces(): Record<string, string>`, `saveLastWorkspace(hostId: string, wsId: string): void` (key `remodeck.lastWorkspace`)
  - `pickHost(hosts: Host[], preferred: string | null): string | null` — preferred if it exists, else first host, else null
  - `pickWorkspace(hostId: string | null, workspaces: Workspace[], last: Record<string, string>): string | null` — last for that host if it still belongs to it, else its first workspace, else null
- Produces (added to `AppState`):
  - `activeHostId: string | null`
  - `selectHost(id: string): void` — sets the host, saves it, selects `pickWorkspace` for it
  - `gitCaps: Record<string, GitCapability | null>` — missing key = not probed yet
  - `probeGit(hostId: string, force?: boolean): Promise<void>` — stores the result; rethrows errors
  - `selectWorkspace(id)` now also sets `activeHostId` to that workspace's host and saves the last-workspace map

- [ ] **Step 1: Write the failing tests.** `hostContext.test.ts`: `pickHost` (preferred present → it; preferred missing → first; no hosts → null), `pickWorkspace` (last valid → it; last belongs to another host → first of this host; none → null), round-trip of both storage helpers. `state.test.tsx`:

```ts
it('restores the stored host and its last workspace on load', async () => { /* storage: activeHost=h2, lastWorkspace={h2:'w3'} → activeHostId h2, activeWorkspaceId w3 */ })
it('falls back to the first host when the stored host no longer exists', async () => {})
it('selectHost switches to that host’s last workspace', async () => {})
it('falls back when the active host is removed on refresh', async () => { /* hosts list no longer has h2 → activeHostId h1, workspace from h1 */ })
it('clears git caps of a host when its status leaves connected', async () => { /* host-status event disconnected → gitCaps has no key */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/hostContext.test.ts tests/renderer/state.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `refresh`, compute `pickHost(h, activeHostRef.current ?? readActiveHost())`, then keep the current workspace if it belongs to that host, else `pickWorkspace`. Wrap `setStatus` so any state other than `connected` deletes `gitCaps[hostId]`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS (update the `AppState` literals in `TopBar.test.tsx` and other tests with the new fields).
- [ ] **Step 5: Commit** `feat(renderer): app-wide active host with remembered workspace`

---

### Task 5: `HostSelector`, host-scoped `WorkspaceSwitcher`, `GitModule`

**Files:**
- Create: `src/renderer/src/components/HostSelector.tsx`
- Create: `src/renderer/src/components/GitModule.tsx`
- Modify: `src/renderer/src/components/WorkspaceSwitcher.tsx`
- Modify: `src/renderer/src/components/EmptyState.tsx`
- Test: `tests/renderer/HostSelector.test.tsx`, `tests/renderer/GitModule.test.tsx`, `tests/renderer/WorkspaceSwitcher.test.tsx`

**Interfaces:**
- Consumes: `activeHostId`, `selectHost`, `gitCaps`, `probeGit` (Task 4).
- Produces:
  - `HostSelector(): JSX.Element` — trigger `aria-label="Switch host"` shows dot + active host label (`Select host` when none); panel lists every host with dot, label, Connect/Retry, and a `Host menu <label>` menu (Host settings…, Disconnect when connected, Remove host — disabled with the existing tooltip when the host has workspaces); footer `Add host`; error text of an `error` host under its row. Clicking a host row calls `selectHost` and closes.
  - `WorkspaceSwitcher` — lists only workspaces of `activeHostId`; Clone / Add existing pass `hostIds={[activeHostId]}` and are disabled unless that host is connected; host rows and the Add host button are removed.
  - `GitModule({ bottom, bottomCollapsed }): JSX.Element` — states in order: no host → `EmptyState` (add host); host not connected → message `<label> ยังไม่ได้ connect` + `Connect` button; `gitCaps[host]` missing → calls `probeGit(host)` once, shows `กำลังตรวจ git…`; `null` → no-git message (Global Constraints) + `ตรวจอีกครั้ง` (calls `probeGit(host, true)`); capability with `remoteHttp`/`forward` false → the matching warning lines above the content; then the active workspace's `WorkspaceScreen` or `EmptyState` (no workspace on this host).
  - `EmptyState` uses `activeHostId` instead of `hosts[0]`, and clones only into the active host.

- [ ] **Step 1: Write the failing tests.**
  - `HostSelector.test.tsx`: lists hosts and marks the active one; clicking another host calls `selectHost('h2')`; Connect calls `api.hosts.connect` then `setStatus`; Remove host is disabled when the host has workspaces.
  - `WorkspaceSwitcher.test.tsx`: with two hosts, only `activeHostId`'s workspaces are listed; Clone is disabled when the active host is disconnected even if another host is connected.
  - `GitModule.test.tsx`:

```ts
it('probes git once when entering a connected host', async () => { /* gitCaps {} → probeGit called with ('h1') exactly once across re-renders */ })
it('shows the no-git message and re-probes with force', async () => {
  /* gitCaps {h1: null} → text 'ไม่พบ git บนเครื่องนี้'; click 'ตรวจอีกครั้ง' → probeGit('h1', true) */
})
it('shows forward and http warnings', async () => { /* {version, remoteHttp:false, forward:false} → both warning texts */ })
it('asks to connect when the host is disconnected', async () => { /* 'Box ยังไม่ได้ connect' + Connect */ })
it('renders the workspace screen when git is present', async () => {})
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/HostSelector.test.tsx tests/renderer/GitModule.test.tsx tests/renderer/WorkspaceSwitcher.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Move the host-row markup, host menu, `AddHostDialog`, `HostSettingsDialog` and `RemoveHostDialog` wiring from `WorkspaceSwitcher` into `HostSelector`, reusing the existing `.switcher*` / `.host-row` / `.menu` CSS classes. The probe-once guard in `GitModule` is a ref keyed by host id, reset when `gitCaps[host]` is cleared.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): host selector and git module gate`

---

### Task 6: Activity bar, topbar, host-scoped terminals

**Files:**
- Create: `src/renderer/src/components/ActivityBar.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/TerminalTabs.tsx`, `src/renderer/src/assets/main.css`
- Test: `tests/renderer/App.test.tsx`, `tests/renderer/TopBar.test.tsx`

**Interfaces:**
- Consumes: `HostSelector`, `GitModule` (Task 5); `OpenedTab.hostId` (Task 3); `activeHostId` (Task 4).
- Produces:
  - `ActivityBar({ onOpenSettings }: { onOpenSettings(): void }): JSX.Element` — vertical bar, 48px wide; `GitBranch` button `aria-label="Git"` with `aria-pressed="true"`; spacer; `Settings` button `aria-label="Settings"` at the bottom. (Phase 2 adds Containers and the module state.)
  - `TopBar({ now? })` — `HostSelector`, then `WorkspaceSwitcher` and the Sync button; the Settings button moves to `ActivityBar` (`onOpenSettings` prop removed).
  - `TerminalTabs` keeps every tab mounted but renders only tabs whose `hostId === activeHostId` (others get `hidden`); the active tab per host is remembered so switching back restores it.
  - Layout: `.app` → topbar on top, then a row of `ActivityBar` + `main` (`GitModule` with the existing `TerminalTabs` bottom slot).

- [ ] **Step 1: Write the failing tests.**
  - `TopBar.test.tsx`: renders `Switch host` and `Switch workspace`; no `Settings` button; Sync behavior unchanged.
  - `App.test.tsx`:

```ts
it('opens settings from the activity bar', async () => { /* click 'Settings' → dialog 'Settings' visible */ })
it('switching host hides but keeps the other host’s terminals', async () => {
  /* announce tabs {t1, hostId h1} and {t2, hostId h2}; active h1 → t1 visible, t2 hidden;
     selectHost h2 → t2 visible; api.terminal.close never called */
})
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/App.test.tsx tests/renderer/TopBar.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** CSS: `.app-body { display: flex; flex: 1; min-height: 0 }`, `.activity-bar` (column, `background: var(--bg-subtle)` or the nearest existing surface token, right border `var(--border)`), `.activity-btn[aria-pressed='true']` uses `var(--selected-bg)`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): activity bar and host-scoped terminals`

---

### Task 7: Protected host UI

**Files:**
- Modify: `src/renderer/src/components/HostSettingsDialog.tsx`, `src/renderer/src/components/HostSelector.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/assets/main.css`
- Modify: `docs/manual-test.md`
- Test: `tests/renderer/HostSettingsDialog.test.tsx` (create), `tests/renderer/HostSelector.test.tsx`, `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `Host.protected`, `hosts.update` patch (Task 1).
- Produces: checkbox `Protected host` with hint `ต้องพิมพ์ชื่อ host ก่อนสั่งคำสั่งอันตราย` in Host settings; `Lock` icon + text `protected` next to the host label in the `HostSelector` trigger and rows; `.app.protected` adds a 3px `var(--danger)` bar across the top of the window.

- [ ] **Step 1: Write the failing tests.**
  - `HostSettingsDialog.test.tsx`: toggling the checkbox and saving calls `api.hosts.update('h1', { label: 'Box', protected: true })`.
  - `HostSelector.test.tsx`: a protected active host shows `protected` in the trigger.
  - `App.test.tsx`: `.app` has class `protected` only while the active host is protected.
- [ ] **Step 2: Run** the three files — Expected: FAIL.
- [ ] **Step 3: Implement** (stripe as `.app.protected { box-shadow: inset 0 3px 0 var(--danger) }` so layout height does not change).
- [ ] **Step 4: Add manual checks** to `docs/manual-test.md`: host without git connects and Git module shows the no-git message; host switch keeps terminals; protected stripe and badge; reopening the app restores host and workspace.
- [ ] **Step 5: Run** `npm run typecheck && npx vitest run && npx eslint src tests` — Expected: PASS, no lint errors.
- [ ] **Step 6: Commit** `feat(hosts): protected host settings and indicators`
