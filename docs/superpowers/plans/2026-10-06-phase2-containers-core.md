# Phase 2 — Containers core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Containers module that, for the active host, probes docker, lists containers grouped by compose project with live updates, and runs start / stop / restart / remove behind the danger-confirmation rules.

**Architecture:** Main: `dockerProbe` classifies the host's docker; `ConnectionService.probeDocker` caches it like `probeGit` (shared `ProbeCache`). `DockerClient` speaks the Docker Engine HTTP API over `ssh <host> docker system dial-stdio` through a custom `http.Agent`. `ContainerService` keeps one container list per host, refreshed from the `/events` stream, and runs actions. Renderer: an `activeModule` switch in the activity bar, a `ContainersModule` gate (mirrors `GitModule`), a `useContainers` hook, a `ContainersView` list, and a shared `ConfirmDanger` dialog driven by `dangerLevel`.

**Tech Stack:** Electron 39 (Node 22: `stream.Duplex.from`, `http.Agent`), React 19, TypeScript, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-remodeck-containers-design.md` — this plan covers §7 Phase 2 (§3.1, §3.2, §3.3 list + events + actions, §4.1 list without detail pane, §4.4, §4.5, §2.5 ConfirmDanger, Containers icon / `activeModule` from §2.3–2.4). Not here: logs / exec / compose actions (Phase 3), stats + inspect (Phase 4), images / volumes / networks (Phase 5).

**Builds on Phase 1** (branch `containers`): `ConnectionService.probeGit`, `AppState` (`activeHostId`, `gitCaps`, `probeGit`, `dropCaps` epoch guard), `ActivityBar`, `GitModule`, `TerminalSlot` portal in `App.tsx`, `Host.protected`.

## Global Constraints

- No new runtime dependencies (no dockerode, no ssh2).
- Docker only; never call `sudo`.
- ssh args for dial-stdio: `-o BatchMode=yes -o ConnectTimeout=10 <sshHost> docker system dial-stdio`.
- `DockerClient`: keep-alive, `maxSockets: 4`, idle socket closed after 60 000 ms, request timeout 15 000 ms (streams exempt), `Host: docker` header, unversioned API paths.
- Container id must match `^[a-f0-9]{12,64}$` before any API call or IPC action.
- Events: `GET /events?filters=` + `encodeURIComponent('{"type":["container"]}')`; reconnect backoff 1000 → 2000 → 5000 → 10000 ms (stays at 10000).
- Thai copy (verbatim):
  - missing: `ไม่พบ docker บนเครื่องนี้`
  - no-permission: `user นี้ไม่มีสิทธิ์ใช้ docker — รัน sudo usermod -aG docker $USER แล้ว disconnect / connect ใหม่`
  - no-daemon: `docker daemon ไม่ทำงาน — เช่น sudo systemctl start docker`
  - too-old: `docker บนเครื่องนี้เก่าเกินไป (ต้อง 18.09 ขึ้นไป)`
  - 404: `container นี้ถูกลบไปแล้ว`
  - 409 on remove of a running container: `ต้อง stop container ก่อนจึงจะ remove ได้`
  - dial failure banner: `เชื่อมต่อ docker บน <label> ไม่ได้`
  - live paused badge: `หยุดอัปเดตสด`
  - no containers: `ยังไม่มี container บน <label>`
  - protected hint (restored now that typed confirmation exists): `ต้องพิมพ์ชื่อ host ก่อนสั่งคำสั่งอันตราย`
- localStorage via `readJson`/`writeJson`: `remodeck.activeModule`, `remodeck.composeCollapsed`.
- Every task ends with `npm run typecheck` and `npx vitest run` green.

## Review Focus

1. **ssh dial process dies mid-request** (host drops, docker gone) — the request rejects with an error, never hangs. Test in Task 3.
2. **Container gone between event and refetch** — the refetch returns `[]` and the container leaves the list. Test in Task 5.
3. **Event burst for one container** (start emits several events) — at most one refetch in flight per container id. Test in Task 5.
4. **Dispose during reconnect backoff** — after `dispose(hostId)` no further `/events` connection is opened. Test in Task 5.
5. **Docker 304 Not Modified** (start an already running container, stop a stopped one) — treated as success. Test in Task 5.

---

### Task 1: Docker probe script and parser

**Files:**
- Create: `src/main/docker/dockerProbe.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/docker/dockerProbe.test.ts`

**Interfaces:**
- Produces:
  - `type DockerCapability = { state: 'ok'; version: string; apiVersion: string } | { state: 'missing' | 'no-permission' | 'no-daemon' | 'too-old'; detail: string }`
  - `DOCKER_PROBE_SCRIPT: string`
  - `parseDockerProbe(stdout: string): DockerCapability`

- [ ] **Step 1: Write the failing tests.** Script (exact, spec §3.1):

```sh
command -v docker >/dev/null 2>&1 || { echo "probe=missing"; exit 0; }
out=$(docker version --format '{{json .}}' 2>&1); echo "probe-exit=$?"; printf '%s\n' "$out"
docker system dial-stdio --help >/dev/null 2>&1 && echo "dialstdio=1" || echo "dialstdio=0"
```

Parser rules, in order: `probe=missing` → `missing`; `probe-exit` ≠ 0 and output contains `permission denied` (case-insensitive) → `no-permission`; `probe-exit` ≠ 0 otherwise → `no-daemon` with detail = constraint copy + `\n` + the docker output trimmed; `dialstdio=0` → `too-old`; else the first line starting with `{` parsed as JSON → `ok` with `Server.Version`, `Server.ApiVersion`; JSON missing `Server` or unparsable → `no-daemon`.

```ts
it('missing', () => expect(parseDockerProbe('probe=missing\n')).toEqual({ state: 'missing', detail: 'ไม่พบ docker บนเครื่องนี้' }))
it('no-permission', () => {
  const out = 'probe-exit=1\n{"Client":{}}\npermission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\ndialstdio=1\n'
  expect(parseDockerProbe(out).state).toBe('no-permission')
})
it('no-daemon keeps the docker output', () => {
  const out = 'probe-exit=1\nCannot connect to the Docker daemon at unix:///var/run/docker.sock\ndialstdio=1\n'
  expect(parseDockerProbe(out)).toEqual({ state: 'no-daemon', detail: 'docker daemon ไม่ทำงาน — เช่น sudo systemctl start docker\nCannot connect to the Docker daemon at unix:///var/run/docker.sock' })
})
it('too-old', () => expect(parseDockerProbe('probe-exit=0\n{"Server":{"Version":"18.06.0","ApiVersion":"1.38"}}\ndialstdio=0\n').state).toBe('too-old'))
it('ok', () => expect(parseDockerProbe('probe-exit=0\n{"Client":{},"Server":{"Version":"27.3.1","ApiVersion":"1.47"}}\ndialstdio=1\n')).toEqual({ state: 'ok', version: '27.3.1', apiVersion: '1.47' }))
it('ok output without Server is no-daemon', () => expect(parseDockerProbe('probe-exit=0\n{"Client":{}}\ndialstdio=1\n').state).toBe('no-daemon'))
```

- [ ] **Step 2: Run** `npx vitest run tests/main/docker/dockerProbe.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `dockerProbe.ts` and the type.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): probe script and parser`

---

### Task 2: `probeDocker` with a shared probe cache

**Files:**
- Create: `src/main/connection/probeCache.ts`
- Modify: `src/main/connection/connectionService.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts`, `src/renderer/src/state.tsx`
- Test: `tests/main/probeCache.test.ts`, `tests/main/connection.test.ts`, `tests/renderer/state.test.tsx`, `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: `DOCKER_PROBE_SCRIPT`, `parseDockerProbe`, `DockerCapability` (Task 1).
- Produces:
  - `class ProbeCache<T> { get(hostId: string, force: boolean, run: (current: () => boolean) => Promise<T>): Promise<T>; clear(hostId: string): void }` — caches successful results only, dedupes in-flight, a result is stored only while its probe is still the current one (same semantics `probeGit` has today; move them, don't re-invent).
  - `ConnectionService.probeDocker(hostId: string, force?: boolean): Promise<DockerCapability>` — throws `Host ยังไม่ได้ connect` when not connected; non-zero ssh exit → reject with stderr trimmed or `ssh exit N`.
  - IPC `hosts.probeDocker(hostId, force?)` (channel `hosts:probeDocker`).
  - `AppState.dockerCaps: Record<string, DockerCapability>` (missing key = not probed) and `AppState.probeDocker(hostId: string, force?: boolean): Promise<void>`; `dropCaps` clears both git and docker entries and bumps the same epoch.

- [ ] **Step 1: Write the failing tests.** `probeCache.test.ts`: caches until `force`; dedupes concurrent calls; failed run is not cached; a forced run wins over an older in-flight run; `clear` drops a result still in flight. `connection.test.ts`: `probeDocker` parses the script output via the fake target (script-aware like the git tests), caches, clears on disconnect; all existing `probeGit` tests still pass unchanged. `state.test.tsx`: `probeDocker` stores under `dockerCaps`; a docker probe resolving after disconnect is dropped; disconnect clears `dockerCaps`.
- [ ] **Step 2: Run** the four test files — Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Rewrite `probeGit` on top of `ProbeCache<GitCapability | null>`; add `probeDocker` on `ProbeCache<DockerCapability>`; both caches cleared where `clearProbe` runs today.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): cached docker probe over IPC`

---

### Task 3: `DockerClient` over a spawned duplex

**Files:**
- Create: `src/main/docker/dialStdio.ts`, `src/main/docker/dockerClient.ts`
- Test: `tests/main/docker/dialStdio.test.ts`, `tests/main/docker/dockerClient.test.ts`

**Interfaces:**
- Produces:
  - `spawnDuplex(cmd: string, args: string[]): Duplex` — child stdout as readable, stdin as writable (`Duplex.from`); destroying the duplex kills the child; child exit ends/destroys the duplex (an exit before any output destroys it with `Error(stderr.trim() || 'exit N')`).
  - `sshDialStdio(sshPath: string, sshHost: string): Duplex` — `spawnDuplex(sshPath, [...constraint args])`.
  - `class DockerError extends Error { constructor(readonly status: number, message: string) }`
  - `class DockerClient { constructor(opts: { connect: () => Duplex; timeoutMs?: number; idleMs?: number }); json<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>; stream(path: string): { lines: AsyncIterable<unknown>; close(): void }; destroy(): void }` — `json` resolves `undefined` for 204/304 or empty bodies; non-2xx/304 → `DockerError(status, body.message ?? statusMessage)`.

- [ ] **Step 1: Write the failing tests.**
  - `dialStdio.test.ts` (uses `process.execPath` as cmd): echo child (`-e process.stdin.pipe(process.stdout)`) round-trips bytes; `destroy()` kills the child (its `exit` fires); a child that writes to stderr and exits 1 destroys the duplex with that stderr text.
  - `dockerClient.test.ts` against a local `http.createServer` whose `connect` is `() => net.connect(port)`:

```ts
it('GETs JSON with Host: docker', async () => { /* server echoes req.headers.host; expect 'docker' */ })
it('POSTs a JSON body', async () => {})
it('maps an error body to DockerError', async () => {
  // server: 404 {"message":"No such container: abc"}
  await expect(client.json('GET', '/containers/abc/json')).rejects.toMatchObject({ status: 404, message: 'No such container: abc' })
})
it('treats 304 as success', async () => { await expect(client.json('POST', '/containers/x/start')).resolves.toBeUndefined() })
it('reuses one connection for sequential requests', async () => { /* server counts 'connection' events: 1 after two requests */ })
it('opens at most 4 connections', async () => { /* 6 concurrent slow requests → server saw 4 connections */ })
it('closes idle connections after idleMs', async () => { /* idleMs: 50; after a request + 100ms the server socket is closed */ })
it('times out a request', async () => { /* timeoutMs: 50, server never answers → rejects */ })
it('rejects when the dial stream dies mid-request', async () => { /* connect returns a Duplex destroyed after the request is written → rejects, no hang */ })
it('streams JSON lines split across chunks and stops on close', async () => {
  // server writes '{"id":"a"}\n{"i' then 'd":"b"}\n' → lines yields {id:'a'}, {id:'b'}; close() ends iteration
})
```

- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement.** Agent: subclass `http.Agent` with `keepAlive: true, maxSockets: 4` and `createConnection = () => this.opts.connect()`; on the agent's `free` event call `socket.setTimeout(idleMs, () => socket.destroy())`, and clear it (`setTimeout(0)`) when a socket is reused. Streams use their own agent-less socket per call (`agent: false` with `createConnection`) so they never occupy the pool.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): Engine API client over ssh dial-stdio`

---

### Task 4: Container model and compose grouping

**Files:**
- Create: `src/shared/containers.ts`
- Test: `tests/shared/containers.test.ts`

**Interfaces:**
- Produces (types-only module plus pure functions, no node imports):
  - `type ContainerState = 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead'`
  - `type ContainerInfo = { id: string; name: string; image: string; state: ContainerState; status: string; created: number; ports: string[]; compose: { project: string; service: string; workingDir: string; configFiles: string[] } | null }`
  - `toContainerInfo(raw: unknown): ContainerInfo` — from one `/containers/json` entry: `name` = first of `Names` without the leading `/`; `ports` = `"<PublicPort>→<PrivatePort>/<Type>"` for published ports, `"<PrivatePort>/<Type>"` otherwise, deduped (IPv4/IPv6 duplicates), sorted; `compose` from labels `com.docker.compose.project`, `.service`, `com.docker.compose.project.working_dir`, `com.docker.compose.project.config_files` (comma-separated), else `null`.
  - `groupContainers(list: ContainerInfo[]): { projects: { name: string; workingDir: string; configFiles: string[]; containers: ContainerInfo[] }[]; standalone: ContainerInfo[] }` — projects sorted by name, containers by name.
  - `CONTAINER_ID = /^[a-f0-9]{12,64}$/`
  - `type ContainerAction = 'start' | 'stop' | 'restart' | 'remove'`

- [ ] **Step 1: Write the failing tests** with a realistic raw entry (copy the shape of Docker's `/containers/json` output: `Id`, `Names`, `Image`, `State`, `Status`, `Created`, `Ports`, `Labels`), covering: name strip, port formatting and IPv4/IPv6 dedupe, compose label parsing (two config files), non-compose → `null`, grouping order.
- [ ] **Step 2: Run** `npx vitest run tests/shared/containers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): container model and compose grouping`

---

### Task 5: `ContainerService`

**Files:**
- Create: `src/main/docker/containerService.ts`
- Test: `tests/main/docker/containerService.test.ts`

**Interfaces:**
- Consumes: `DockerClient`, `DockerError` (Task 3); `toContainerInfo`, `CONTAINER_ID`, `ContainerAction`, `ContainerInfo` (Task 4).
- Produces: `class ContainerService extends EventEmitter` with
  - `constructor(deps: { clientFor(hostId: string): DockerClient; sleep?(ms: number): Promise<void> })`
  - `open(hostId: string): Promise<ContainerInfo[]>` — first call per host lists and starts the events loop; later calls return the current list
  - `action(hostId: string, id: string, action: ContainerAction): Promise<void>`
  - `dispose(hostId: string): void` — stops the loop, closes the stream, `destroy()`s the client, forgets the list
  - events `'changed'(hostId, list: ContainerInfo[])`, `'live'(hostId, live: boolean)`

- [ ] **Step 1: Write the failing tests** with a fake client (`json` / `stream` scripted per path; `stream().lines` driven by a controllable async queue):

```ts
it('lists all containers on open', async () => { /* GET /containers/json?all=1 → mapped list */ })
it('refetches only the container named by an event', async () => {
  // event {Type:'container', Actor:{ID:'<64 hex>'}} → GET /containers/json?all=1&filters=<encoded {"id":["<id>"]}> → list updated, 'changed' emitted
})
it('drops a container whose refetch is empty', async () => {})
it('keeps one refetch in flight per container id', async () => { /* 3 events same id while first refetch pending → 1 GET for that id until it resolves, then one more */ })
it('reconnects with backoff and relists', async () => {
  // stream ends twice → sleep called with 1000 then 2000; live false then true; list re-fetched after reconnect
})
it('backoff stays at 10000', async () => { /* 6 failures → sleeps [1000,2000,5000,10000,10000,10000] */ })
it('stops after dispose during backoff', async () => { /* dispose while sleep pending → no further stream() call */ })
it('rejects an invalid id without calling docker', async () => { await expect(svc.action('h', 'nope', 'stop')).rejects.toThrow() })
it('maps actions to endpoints', async () => { /* start/stop/restart → POST /containers/<id>/<action>; remove → DELETE /containers/<id> */ })
it('treats 304 as success', async () => {})
it('maps 404 and 409-on-remove to Thai messages', async () => {
  // DockerError(404) → 'container นี้ถูกลบไปแล้ว'; DockerError(409,'You cannot remove a running container ...') → 'ต้อง stop container ก่อนจึงจะ remove ได้'
})
```

- [ ] **Step 2: Run** `npx vitest run tests/main/docker/containerService.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Event id = `event.Actor?.ID ?? event.id`; ignore events whose id fails `CONTAINER_ID`. Other `DockerError`s rethrow with Docker's message.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): container service with live events`

---

### Task 6: Wire containers into the app and IPC

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts`
- Test: `tests/main/ipc.test.ts`, `tests/main/containersApi.test.ts` (create)

**Interfaces:**
- Consumes: `ContainerService` (Task 5), `sshDialStdio`, `DockerClient` (Task 3), `ConnectionService.probeDocker` (Task 2).
- Produces:
  - IPC `containers.open(hostId): Promise<ContainerInfo[]>` (channel `containers:open`) — `hostOf`, `requireConnected`, then `probeDocker(hostId)` must be `ok` (else throw its `detail`), then `service.open`
  - IPC `containers.action(hostId, id, action): Promise<void>` (channel `containers:action`) — validates `action` is one of the four
  - events `containers-changed (hostId, list)` and `containers-live (hostId, live)` (channels `event:containers-changed`, `event:containers-live`)
  - `ContainerService.dispose(hostId)` runs on host disconnect (inside the existing `onDisconnect`), on host remove, and for every host in app `dispose`
  - `export function containersApi(deps: { hostOf; connection; service }): MainApi['containers']` in `app.ts` so the guards are unit-testable

- [ ] **Step 1: Write the failing tests.** `ipc.test.ts`: mock api gains `containers.open/action`. `containersApi.test.ts`: `open` on a disconnected host throws `Host ยังไม่ได้ connect`; `open` when `probeDocker` returns `no-permission` throws that detail and never calls `service.open`; `action` with `'kill'` throws.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement.** Client factory per host: `new DockerClient({ connect: () => sshDialStdio(sshPath, sshHostFor(hostId)) })`, created lazily and kept until `dispose`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(docker): containers IPC and lifecycle`

---

### Task 7: `dangerLevel` and `ConfirmDanger`

**Files:**
- Create: `src/renderer/src/danger.ts`, `src/renderer/src/components/ConfirmDanger.tsx`
- Modify: `src/renderer/src/components/HostSettingsDialog.tsx` (hint copy)
- Test: `tests/renderer/danger.test.ts`, `tests/renderer/ConfirmDanger.test.tsx`, `tests/renderer/HostSettingsDialog.test.tsx`

**Interfaces:**
- Produces:
  - `type DangerAction = 'start' | 'logs' | 'shell' | 'inspect' | 'stop' | 'restart' | 'compose-up' | 'compose-pull' | 'compose-restart' | 'remove' | 'compose-down' | 'image-rm' | 'image-prune' | 'network-rm' | 'network-prune' | 'volume-rm' | 'volume-prune'`
  - `dangerLevel(action: DangerAction, isProtected: boolean): 'none' | 'click' | 'type'` — exactly spec §4.4
  - `ConfirmDanger({ host, summary, confirmLabel, mode, onConfirm, onClose }: { host: Host; summary: string; confirmLabel: string; mode: 'click' | 'type'; onConfirm(): Promise<void>; onClose(): void }): JSX.Element` — dialog `role="dialog"` labelled by the host label shown large; summary line; danger button; in `type` mode a text input `aria-label="พิมพ์ชื่อ host เพื่อยืนยัน"` and the button stays disabled until the input equals `host.label` exactly; errors from `onConfirm` shown in the dialog, which stays open

- [ ] **Step 1: Write the failing tests.** `danger.test.ts`: a table test over all 17 actions × {false, true} matching §4.4 (start/logs/shell/inspect → none/none; stop/restart/compose-up/compose-pull/compose-restart → none/click; remove/compose-down/image-rm/image-prune/network-rm/network-prune → click/type; volume-rm/volume-prune → type/type). `ConfirmDanger.test.tsx`: click mode confirms immediately; type mode disabled for `box`, `Box ` and enabled for `Box`; rejection shows the error and keeps the dialog. `HostSettingsDialog.test.tsx`: hint text is the protected-hint constraint copy.
- [ ] **Step 2: Run** the three files — Expected: FAIL.
- [ ] **Step 3: Implement** (reuse `.dialog` / `.dialog-backdrop` / `Button variant="danger"`).
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): danger levels and typed confirmation`

---

### Task 8: Module switch in the activity bar

**Files:**
- Modify: `src/renderer/src/state.tsx`, `src/renderer/src/hostContext.ts`, `src/renderer/src/components/ActivityBar.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/App.tsx`
- Create: `src/renderer/src/components/ContainersModule.tsx` (placeholder body for this task: the gate only, see Task 9)
- Test: `tests/renderer/App.test.tsx`, `tests/renderer/TopBar.test.tsx`, `tests/renderer/hostContext.test.ts`

**Interfaces:**
- Consumes: `dockerCaps`, `probeDocker` (Task 2).
- Produces:
  - `type Module = 'git' | 'containers'`; `readActiveModule(): Module` (default `'git'`, invalid stored value → `'git'`), `saveActiveModule(m: Module)` (key `remodeck.activeModule`)
  - `AppState.activeModule: Module`, `AppState.selectModule(m: Module): void`
  - `ActivityBar` buttons `Git` (`GitBranch`) and `Containers` (lucide `Container`), `aria-pressed` on the active one
  - `TopBar` shows `WorkspaceSwitcher` and Sync only when `activeModule === 'git'`
  - `App` renders `GitModule` or `ContainersModule` (both get the same `TerminalSlot` bottom)
  - `ContainersModule({ bottom, bottomCollapsed })` gate, mirroring `GitModule`: no host → `EmptyState`; not connected → `<label> ยังไม่ได้ connect` + Connect; `dockerCaps` missing → probe once (same probe-once guard and probing/error handling as `GitModule`), `กำลังตรวจ docker…`; non-`ok` → lucide `Container` icon + `detail` (pre-wrapped) + `ตรวจอีกครั้ง` (force, disabled while probing); `ok` → `ContainersView` (Task 9; in this task render a `<div data-testid="containers-view" />` stub)

- [ ] **Step 1: Write the failing tests.** `hostContext.test.ts`: module round-trip and invalid value fallback. `App.test.tsx`: clicking Containers shows the docker gate and persists the module; reload restores it; terminals stay alive across a module switch (xterm count unchanged, no dispose). `TopBar.test.tsx`: `Switch workspace` absent in containers module. Gate tests in `tests/renderer/ContainersModule.test.tsx`: probes once; `no-permission` shows its detail and re-probes with force; `ok` renders the stub.
- [ ] **Step 2: Run** the four files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): containers module switch and docker gate`

---

### Task 9: Containers list with live updates and actions

**Files:**
- Create: `src/renderer/src/useContainers.ts`, `src/renderer/src/components/ContainersView.tsx`
- Modify: `src/renderer/src/components/ContainersModule.tsx`, `src/renderer/src/assets/main.css`, `docs/manual-test.md`
- Test: `tests/renderer/useContainers.test.tsx`, `tests/renderer/ContainersView.test.tsx`

**Interfaces:**
- Consumes: `containers.open/action`, events `containers-changed` / `containers-live` (Task 6); `groupContainers`, `ContainerInfo` (Task 4); `dangerLevel`, `ConfirmDanger` (Task 7).
- Produces:
  - `useContainers(hostId: string): { list: ContainerInfo[] | null; live: boolean; error: string | null; retry(): void }` — calls `api.containers.open(hostId)`; applies only events whose `hostId` matches; resets when `hostId` changes; a result from a previous host is ignored
  - `ContainersView({ host }: { host: Host }): JSX.Element`:
    - header: filter input `aria-label="Filter containers"` (matches name or image, case-insensitive), checkbox `แสดงตัวที่หยุด` (default off: only `running` / `restarting` / `paused`), badge `หยุดอัปเดตสด` when `live` is false
    - groups from `groupContainers`; project header `<name> (compose)` with a collapse toggle, collapsed set persisted per host in `remodeck.composeCollapsed` (`Record<hostId, string[]>`); `Standalone` group for the rest; groups with no visible rows are hidden
    - row: state dot, name (mono), image, ports joined by `, `, `status`; buttons with aria-labels `Start <name>` (when not running), `Stop <name>` / `Restart <name>` (when running), `Remove <name>`
    - every action goes through `dangerLevel(action, host.protected)`: `none` runs directly, otherwise `ConfirmDanger` with summary `<action> · <name>`; errors show in an `ErrorBanner` above the list
    - `error` from the hook → banner `เชื่อมต่อ docker บน <label> ไม่ได้` + the error text + a `Retry` button calling `retry()`
    - empty list → `ยังไม่มี container บน <label>`
  - Manual checks added to `docs/manual-test.md` (existing table style): no-docker host message; user not in docker group; live update when a container is started from a shell; remove on a protected host needs the typed name.

- [ ] **Step 1: Write the failing tests.** `useContainers.test.tsx`: open result shown; `containers-changed` for the same host replaces the list, for another host is ignored; switching host while the first open is pending ignores the stale result; `containers-live false` → `live` false. `ContainersView.test.tsx`: compose grouping and Standalone; stopped hidden by default and shown with the checkbox; filter by image; collapse persists per host; Stop on a normal host calls `api.containers.action('h1', id, 'stop')` without a dialog; Stop on a protected host opens a click confirm; Remove on a protected host requires typing the label; action error shows in the banner; live badge.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement**, replacing the Task 8 stub in `ContainersModule`; the list sits above the `bottom` slot the way `WorkspaceScreen` places it.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run && npx eslint` on the changed files — Expected: PASS, no new lint errors.
- [ ] **Step 5: Commit** `feat(renderer): containers list with live updates and actions`
