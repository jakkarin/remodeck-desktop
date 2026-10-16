# Local Host ("This computer") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, non-removable host `local` ("This computer") that runs everything on the Windows machine through Git Bash and local Docker, and make the app always start on it.

**Architecture:** `Host` gains `kind`. The four places that talk to a host — script exec (`targetFor`), connect, terminal spawn, Docker dial — branch on `kind`; everything above them (sync, mirror, bridge, approval, UI) is unchanged. The renderer picks `local` on startup and connects it automatically.

**Tech Stack:** Electron, TypeScript, React, node-pty, Vitest (+ Testing Library), Git for Windows bash.

**Spec:** `docs/superpowers/specs/2026-10-15-local-host-design.md`

## Global Constraints

- Local host: `id: 'local'`, `kind: 'local'`, `sshHost: ''`, default label `This computer`, always at index 0, cannot be removed.
- `Host.kind` is optional; missing means `'ssh'` (old configs must load unchanged).
- Never use `bash` from `PATH` for the local host (it is often WSL). Only Git for Windows' `bash.exe`.
- Missing bash error text, verbatim: `Git for Windows is required: install it from https://git-scm.com`
- Remove error text, verbatim: `This computer cannot be removed`
- Local paths are stored normalised: forward slashes, upper-case drive letter, no trailing `/` (e.g. `D:/develop/app`).
- SSH host behaviour (paths, connect error text, terminal args, docker dial) must not change.
- Run `npm run typecheck`, `npm run lint` and `npm test` green before every commit.

## Review Focus

- A local path with spaces (`C:/Users/Jane Doe/repos/app`) must work for add existing, sync, worktrees and terminal cwd → Task 2 test `shPath quotes a spaced drive path`, Task 5 test `local terminal cwd keeps spaces`.
- The same folder typed differently (`d:\develop\app\` vs stored `D:/develop/app`) must be rejected as a duplicate → Task 2 test `rejects a local duplicate typed differently`.
- WSL `bash.exe` first on `PATH` must not be picked → Task 3 test `ignores bash on PATH that is not next to git`.
- Git for Windows missing: Connect shows the verbatim error and nothing crashes → Task 4 test `local connect error without bash`.
- `git worktree list` returning `/d/...` style paths still opens a terminal in the right folder → Task 2 test `normalizeLocalPath converts msys paths`.

---

### Task 1: Local host in shared types and Store

**Files:**
- Modify: `src/shared/types.ts` (Host type)
- Modify: `src/main/store/store.ts` (`load`, `removeHost`, `updateHost`)
- Test: `tests/main/store.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`): `Host.kind?: 'ssh' | 'local'`; `export const LOCAL_HOST_ID = 'local'`; `export function isLocalHost(h: Pick<Host, 'id' | 'kind'>): boolean` (true iff `h.kind === 'local'`).

- [ ] **Step 1: Write failing tests** in `tests/main/store.test.ts`:
  - `adds This computer on a fresh store`: new Store on empty dir → `hosts[0]` equals `{ id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false }`; config file on disk contains it.
  - `moves an existing local host to the top and keeps its label`: config `hosts: [ssh host 'a', { id: 'local', sshHost: 'x', label: 'Mine', protected: true }]` → `hosts.map(h=>h.id)` is `['local','a']`, local has `kind:'local'`, `sshHost:''`, `label:'Mine'`, `protected:true`.
  - `loads old ssh hosts without kind`: an ssh host without `kind` loads with `kind` undefined and `isLocalHost` false.
  - `refuses to remove This computer`: `removeHost('local')` throws `This computer cannot be removed`.
- [ ] **Step 2: Run** `npx vitest run tests/main/store.test.ts` — expect the 4 new tests FAIL.
- [ ] **Step 3: Implement.** In `load()` after mapping hosts, call a module function `withLocalHost(hosts: Host[]): { hosts: Host[]; changed: boolean }`; save when `changed`. In `removeHost`, check `id === LOCAL_HOST_ID` first. Fix any existing store tests that assumed `hosts` starts empty (expect `local` at index 0).
- [ ] **Step 4: Run** `npx vitest run tests/main/store.test.ts` — PASS; then `npm test` and fix other suites asserting on `hosts` length.
- [ ] **Step 5: Commit** `feat: add built-in This computer host to the store`

### Task 2: Local paths

**Files:**
- Modify: `src/main/sandbox/shell.ts`
- Modify: `src/main/sync/syncService.ts:364-371` (`checkExistingPath`), `:223` (`cloneToSandbox` validation)
- Modify: `src/main/app.ts` (`workspaces.clone`, `inspectExisting`, `addExisting`: pass `{ local }` and normalise before `addWorkspace`)
- Test: `tests/main/sandbox/shell.test.ts` (create if missing), `tests/main/sync/*` (existing addExisting suite)

**Interfaces:**
- Consumes: `isLocalHost`, `LOCAL_HOST_ID` (Task 1).
- Produces (in `shell.ts`): `validateSandboxPath(p: string, opts?: { local?: boolean }): void`; `normalizeLocalPath(p: string): string`; `sameSandboxPath(a: string, b: string, local: boolean): boolean` (local: case-insensitive compare of normalised paths; ssh: strict equality after trimming trailing `/`).

- [ ] **Step 1: Write failing tests:**
  - `accepts drive paths only for local`: `validateSandboxPath('D:/x', { local: true })` and `'D:\\x\\y'` pass; `'D:/x'` without `local` throws `Path must start with / or ~/`; `'D:/'` and `'D:'` with local throw.
  - `normalizeLocalPath`: `'d:\\develop\\app\\'` → `'D:/develop/app'`; `'~/repos/a'` unchanged; `'/d/develop/app'` → `'D:/develop/app'` (test name `normalizeLocalPath converts msys paths`); `'/home/x'` unchanged.
  - `shPath quotes a spaced drive path`: `shPath('C:/Users/Jane Doe/a')` → `'C:/Users/Jane Doe/a'` wrapped in single quotes.
  - `rejects a local duplicate typed differently` (syncService suite): store has local workspace `D:/develop/app`; `describeExisting('local', 'd:\\develop\\app\\')` rejects `This workspace already exists: D:/develop/app`.
- [ ] **Step 2: Run** the two test files — FAIL.
- [ ] **Step 3: Implement.** `checkExistingPath` looks up the host, validates with `{ local }`, normalises with `normalizeLocalPath` (local) or trailing-slash trim (ssh), and compares with `sameSandboxPath`. `cloneToSandbox` and `app.ts` pass `{ local: isLocalHost(hostOf(hostId)) }`; `workspaces.clone` normalises `sandboxPath` before `store.addWorkspace`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: accept Windows paths for the local host`

### Task 3: Git Bash resolution and the real LocalTarget

**Files:**
- Create: `src/main/proc/bashPath.ts`
- Modify: `src/main/sandbox/target.ts` (`LocalTarget`)
- Modify: `src/main/app.ts` (`targetFor`)
- Test: `tests/main/sandbox/bashPath.test.ts`

**Interfaces:**
- Produces: `resolveBashPath(deps?: { exists?(p: string): boolean; pathEnv?: string; programFiles?: string[] }): string | null`; `new LocalTarget(homeDir: string, bashPath?: string | null)` — when `bashPath` is `null`, `exec` rejects with the verbatim missing-bash error; when `undefined`, keeps today's fallback (tests only). `app.ts` resolves once at startup: `const bashPath = resolveBashPath()`; `targetFor(id)` returns `new LocalTarget(os.homedir(), bashPath)` for local hosts.

- [ ] **Step 1: Write failing tests:**
  - `prefers Program Files Git bash`: `exists` true for `C:/Program Files/Git/bin/bash.exe` → returns it.
  - `derives bash from git on PATH`: Program Files missing, `pathEnv` contains `E:/tools/Git/cmd`, `exists` true for `E:/tools/Git/cmd/git.exe` and `E:/tools/Git/bin/bash.exe` → returns the latter.
  - `ignores bash on PATH that is not next to git`: `pathEnv` = `C:/Windows/System32`, `exists` true only for `C:/Windows/System32/bash.exe` → `null`.
  - `LocalTarget with null bash rejects`: `new LocalTarget('C:/h', null).exec('true')` rejects with the verbatim error.
- [ ] **Step 2: Run** `npx vitest run tests/main/sandbox/bashPath.test.ts` — FAIL.
- [ ] **Step 3: Implement** `resolveBashPath` (candidates in order: each `programFiles` entry + `/Git/bin/bash.exe`, defaulting to `process.env.ProgramFiles` and `ProgramFiles(x86)`; then for each `PATH` dir containing `git.exe`, `<dir>/../bin/bash.exe`) and wire `LocalTarget`/`targetFor`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: run local host scripts with Git for Windows bash`

### Task 4: Connection for the local host

**Files:**
- Modify: `src/main/connection/connectionService.ts` (`ConnectionDeps`, `doConnect`, `doProbe`)
- Modify: `src/main/app.ts` (deps wiring)
- Test: `tests/main/connection.test.ts`

**Interfaces:**
- Consumes: `LocalTarget` (Task 3).
- Produces: `ConnectionDeps.isLocal(hostId: string): boolean`.

- [ ] **Step 1: Write failing tests:**
  - `local connect skips the forward check`: `isLocal` true, `checkForward` spy; connect then `probeGit` → `checkForward` not called and `cap.forward === true`.
  - `local connect error without bash`: `targetFor` returns a target whose `exec` rejects with the verbatim missing-bash error → status `{ state: 'error', error: 'Git for Windows is required: install it from https://git-scm.com' }` (no `Try running ssh` suffix).
- [ ] **Step 2: Run** `npx vitest run tests/main/connection.test.ts` — FAIL.
- [ ] **Step 3: Implement** the branch; the ssh error suffix is added only when `!isLocal(hostId)`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: connect the local host without ssh`

### Task 5: Local terminals

**Files:**
- Create: `src/main/terminal/localCommand.ts`
- Modify: `src/main/terminal/sshCommand.ts` (export `INSTEAD_OF` and a `bridgeGitEnv(baseUrl: string): Record<string, string>` helper used by both)
- Modify: `src/main/terminal/terminalService.ts` (`PtySpawner` opts, `Deps`, `open`, `openHost`, `basename`)
- Modify: `src/main/app.ts` (pass `bashPath`, `isLocal`)
- Test: `tests/main/terminal.test.ts`

**Interfaces:**
- Consumes: `isLocalHost` (Task 1), `bashPath` from `resolveBashPath` (Task 3).
- Produces: `buildLocalTerminal(o: { bashPath: string; bridgePort: number; token: string; path: string; homeDir: string }): { file: string; args: string[]; cwd: string; env: Record<string, string> }` with `args = ['--login', '-i']`, `cwd` = `path` with `~` expanded to `homeDir`, `env` = `process.env` + `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_i`, `GIT_CONFIG_VALUE_i` where key is `url.http://127.0.0.1:<bridgePort>/s/<token>/.insteadOf`; `buildLocalHostCommand(bashPath: string, cmd: string): { file: string; args: string[] }` = `[ '--login', '-c', cmd ]`. `PtySpawner(file, args, opts: { cols; rows; cwd?: string; env?: Record<string,string> })`. `Deps` gains `bashPath: string | null` and `homeDir: string`.

- [ ] **Step 1: Write failing tests:**
  - `buildLocalTerminal sets bridge env`: env has `GIT_CONFIG_COUNT: '3'`, `GIT_CONFIG_KEY_0: 'url.http://127.0.0.1:4000/s/tok/.insteadOf'`, `GIT_CONFIG_VALUE_0: 'https://github.com/'`.
  - `local terminal cwd keeps spaces`: path `'~/Jane Doe/a'`, homeDir `'C:/Users/x'` → `cwd === 'C:/Users/x/Jane Doe/a'`.
  - `opens a local workspace tab once with bash`: setup with a local host/workspace → spawn called once with `file === bashPath`, `args` `['--login','-i']`, `opts.cwd` = workspace path; a pty exit containing `remote port forwarding failed` does not retry; bridge session registered and revoked on close (same assertions as the ssh tab test).
  - `openHost on local runs bash -c`: spawn file is bashPath, args `['--login','-c','docker buildx prune --force']`.
  - `local open without bash throws` the verbatim missing-bash error.
  - `local open normalises an msys worktree path`: `open(wsId, '/d/develop/app-wt')` → spawn `opts.cwd === 'D:/develop/app-wt'` (uses `normalizeLocalPath` from Task 2).
- [ ] **Step 2: Run** `npx vitest run tests/main/terminal.test.ts` — FAIL.
- [ ] **Step 3: Implement.** In `open()`, branch on the host before `attempt`: local spawns once via `buildLocalTerminal`, wires data/exit/idle like `attempt` but without the retry window. `nodePtySpawner` forwards `cwd`/`env` (env default `process.env`). `basename` splits on `/` and `\`. Keep `buildTerminalSshArgs` output byte-identical (existing tests prove it).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: open local terminals in Git Bash through the git bridge`

### Task 6: Local Docker and API wiring

**Files:**
- Modify: `src/main/docker/dialStdio.ts` (add `localDialStdio(): Duplex`)
- Modify: `src/main/app.ts` (`clientFor`, `checkForward`/`sshHostFor` not called for local, `dispose`)
- Test: `tests/main/docker/dialStdio.test.ts` (create or extend)

**Interfaces:**
- Produces: `localDialArgs(): string[]` = `['system', 'dial-stdio']`; `localDialStdio()` = `spawnDuplex('docker', localDialArgs())`.

- [ ] **Step 1: Write failing test** `localDialArgs is docker system dial-stdio`; also `sshDialArgs` unchanged (existing).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** and wire: `clientFor(hostId)` uses `localDialStdio()` when `isLocalHost(hostOf(hostId))`.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — PASS.
- [ ] **Step 5: Commit** `feat: use local Docker for This computer`

### Task 7: Start on Local and auto-connect

**Files:**
- Modify: `src/renderer/src/hostContext.ts` (`pickHost`)
- Modify: `src/renderer/src/state.tsx` (`refresh`)
- Test: `tests/renderer/hostContext.test.ts`, `tests/renderer/state.test.tsx`

**Interfaces:**
- Consumes: `LOCAL_HOST_ID` (Task 1).
- Produces: `pickHost(hosts: Host[], preferred: string | null, opts?: { startup?: boolean }): string | null` — startup returns `'local'` when present, else old behaviour.

- [ ] **Step 1: Write failing tests:**
  - `startup picks local over the saved host` (hostContext): hosts `[local, a]`, preferred `'a'`, `{ startup: true }` → `'local'`; without startup → `'a'`.
  - `state starts on local and connects it` (state.test): saved active host `'a'` in storage; after mount `activeHostId === 'local'` and `api.hosts.connect` called once with `'local'`; not called for `'a'`.
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement.** In `refresh`, pass `{ startup: !loadedRef.current }`; after statuses load on the first refresh, if local status is `disconnected` call `api.hosts.connect('local')` and `setStatus` with the result (errors go to status, not thrown).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: always start on This computer`

### Task 8: Local host in the UI

**Files:**
- Modify: `src/renderer/src/components/HostSelector.tsx`, `ConnectPanel.tsx`, `HostSettingsDialog.tsx`, `AddExistingDialog.tsx`, `CloneDialog.tsx`, `EmptyState.tsx`
- Test: matching files in `tests/renderer/`

**Interfaces:**
- Consumes: `isLocalHost` (Task 1).

- [ ] **Step 1: Write failing tests:**
  - HostSelector: local row shows `This computer · <state text>` and no `ssh ` text; it has no Remove action.
  - ConnectPanel: local shows `Runs on this computer with Git Bash`, not `ssh`.
  - HostSettingsDialog: local has no SSH alias field and no Git access panel; label and protected still editable.
  - AddExistingDialog: local placeholder `D:/projects/my-app`; ssh keeps `~/work/my-app`.
  - EmptyState: when the only host is local (no workspaces, connected), Onboarding is not rendered and Add existing / Clone actions are.
- [ ] **Step 2: Run** `npx vitest run tests/renderer` — the new tests FAIL.
- [ ] **Step 3: Implement** using `Monitor` from `lucide-react` for local and existing shadcn components only.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test` — PASS.
- [ ] **Step 5: Commit** `feat: show This computer in host UI`

### Task 9: Docs and end-to-end check

**Files:**
- Modify: `README.md` (new bilingual "This computer" section per spec §8), `docs/manual-test.md` (local checklist per spec "การทดสอบ")

- [ ] **Step 1: Write docs.**
- [ ] **Step 2: Run** `npm run build` — exits 0.
- [ ] **Step 3: Run the app** (`npm run dev`) and check: opens on This computer, connected; Add existing on a repo under `D:/`; branches and diff load; terminal opens in the repo and `git fetch` works; Containers opens (or shows the probe error without Docker).
- [ ] **Step 4: Commit** `docs: document the This computer host`
