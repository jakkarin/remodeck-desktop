# Phase 4 — Stats + inspect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live CPU% and RAM for running containers, plus a details panel (Overview / Env / JSON) for the selected container.

**Architecture:**
- **Pure shared functions** turn raw Docker JSON into view data: `computeStats` and `toContainerDetails`.
- **Main:** a stats loop runs per host while the renderer asks for it, polling one container at a time with `stream=false`. `containers.inspect` returns the raw inspect JSON.
- **Renderer:** a hook turns stats on while the Containers list is visible. A two-column layout shows the details of the container picked through its name button.

**Tech Stack:** Electron main (DockerClient over `docker system dial-stdio`), React 19, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-remodeck-containers-design.md` (§3.3 stats / inspect, §4.1, §4.2, §5 stats row, §6)

## Global Constraints

- **Stats polling:** `containers.watchStats(hostId, on)` turns polling on when the Containers page is visible and off when it is hidden. While on, the stats of every running container are fetched every 5 seconds over the same socket pool.
- **Stats formulas:** CPU% = Δcontainer / Δsystem × online_cpus × 100. RAM = usage − cache. The result is emitted as `containers:stats(hostId, map)`. A container whose stats fail is left out of the map, and the UI shows `—`.
- **inspect:** the whole JSON goes to the renderer; env values are hidden in the UI.
- **Overview tab:** image, created, state / exit code, restart policy, ports, mounts (source → target, rw/ro), networks (name + IP), labels.
- **Env tab:**
  - Each variable is listed as `KEY = ••••••`.
  - Each row has an eye button that reveals that one value.
  - There is no reveal-all button.
- **JSON tab:** the raw inspect, read-only. `Env` inside it is replaced by `"<hidden: N vars>"`.
- **Danger level:** inspect is `none` (from `dangerLevel`).
- **Disconnect or remove host:** `dispose(hostId)` also stops stats.
- **Screen design rules** (`docs/superpowers/specs/2026-10-08-containers-compose-list-design.md`):
  - No row hover fill.
  - Clicking the row background runs no command.
  - Buttons have accessible names and visible focus.
- **Copy:** user-facing copy is Thai; tab and field names may stay English (Overview, Env, JSON).
- **Commit trailer:** implementer commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

**Layout ruling (spec §4.1 says "use the existing `SplitLayout`"):** `SplitLayout` is the Git module's fixed 3-column grid (`left | middle | right`, with a persisted Git layout). So Containers uses its own CSS two-column layout in `ContainersView`:
- the list on the left (`minmax(0, 1fr)`);
- the details on the right (`clamp(320px, 38%, 480px)`), shown only while a container is selected.

There is no drag handle. It stacks below the list under 720px of container width.

## Review Focus

1. **Many running containers on a slow host:** a stats cycle never overlaps the next one, and it never takes more than one socket at a time, so start/stop actions and event refetches are not starved. Test: Task 2 (sequential, at most one stats request in flight).
2. **Stats for a container that stopped mid-cycle (404/409), or malformed stats JSON:** that id is left out of the map, the cycle continues, and nothing throws. Tests: Task 1 (malformed input returns `null`) and Task 2 (a failing request is skipped).
3. **Selected container removed:** the details panel closes instead of showing stale data or an error loop. Test: Task 4.
4. **Env value containing `=`, or an entry without `=`:** split at the first `=` only; a bare `KEY` gets the value `''`. Test: Task 1.
5. **Switching to another container while values are revealed:** the revealed set resets, so a secret from container A is never shown under container B. Test: Task 4.

---

### Task 1: Pure stats and details functions

**Files:**
- Create: `src/shared/containerDetails.ts`
- Test: `tests/main/containerDetails.test.ts`

**Interfaces:**
- Produces:
  - `export type ContainerStats = { cpu: number; memBytes: number; memLimit: number }`
  - `export function computeStats(raw: unknown): ContainerStats | null`
  - `export type ContainerDetails` with:
    - `overview: { image: string; created: string; state: string; exitCode: number | null; restartPolicy: string; ports: string[]; mounts: { source: string; target: string; mode: 'rw' | 'ro' }[]; networks: { name: string; ip: string }[]; labels: [string, string][] }`
    - `env: { key: string; value: string }[]`
    - `json: string`
  - `export function toContainerDetails(raw: unknown): ContainerDetails`

Field sources:

| Field | Source in raw inspect |
|---|---|
| `image` | `Config.Image` |
| `created` | `Created` (ISO string) |
| `state` | `State.Status` |
| `exitCode` | `State.ExitCode`, or null when not a number |
| `restartPolicy` | `HostConfig.RestartPolicy.Name`, with `:<MaximumRetryCount>` appended when the name is `on-failure` and the count is > 0. Empty name becomes `no`. |
| `ports` | `NetworkSettings.Ports`. `{"80/tcp":[{"HostPort":"8080"}]}` becomes `8080→80/tcp`; a `null` binding becomes `80/tcp`. Duplicate host bindings (IPv4 and IPv6) are deduped. Sorted by container port. |
| `mounts` | `Mounts[]`: `Source`, `Destination`, `RW` |
| `networks` | `NetworkSettings.Networks` (`name`, then `IPAddress`). Sorted by name. |
| `labels` | `Config.Labels`, sorted by key |

- `env` comes from `Config.Env`, split at the first `=`.
- `json` is `JSON.stringify(rawCopy, null, 2)` where `rawCopy.Config.Env` is replaced by `"<hidden: N vars>"`. The input object must not be mutated.
- `computeStats`:
  - Uses `cpu_stats.cpu_usage.total_usage`, `precpu_stats.cpu_usage.total_usage`, `cpu_stats.system_cpu_usage`, `precpu_stats.system_cpu_usage`.
  - `online_cpus` falls back to `cpu_stats.cpu_usage.percpu_usage.length`, then to 1.
  - CPU is 0 when Δsystem ≤ 0 or Δcontainer < 0.
  - Cache is `memory_stats.stats.inactive_file`, falling back to `total_inactive_file`, then `cache`, then 0. The `memBytes` result is clamped to ≥ 0.
  - Returns null when `memory_stats.usage` or `cpu_stats` is missing.

- [ ] **Step 1: Write failing tests**

```ts
it('computeStats: cpu% and mem minus inactive_file', () => {
  const raw = {
    cpu_stats: { cpu_usage: { total_usage: 400 }, system_cpu_usage: 2000, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000 },
    memory_stats: { usage: 50_000_000, limit: 1_000_000_000, stats: { inactive_file: 8_000_000 } }
  }
  expect(computeStats(raw)).toEqual({ cpu: 40, memBytes: 42_000_000, memLimit: 1_000_000_000 })
})
it('computeStats: cgroup v1 cache, percpu fallback, zero system delta', () => {
  const raw = {
    cpu_stats: { cpu_usage: { total_usage: 10, percpu_usage: [1, 2, 3, 4] }, system_cpu_usage: 5 },
    precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 5 },
    memory_stats: { usage: 100, limit: 1000, stats: { cache: 30 } }
  }
  expect(computeStats(raw)).toEqual({ cpu: 0, memBytes: 70, memLimit: 1000 })
})
it('computeStats: malformed input is null', () => {
  for (const bad of [null, {}, { cpu_stats: {} }, 'x']) expect(computeStats(bad)).toBeNull()
})
it('toContainerDetails: overview fields', () => {
  /* raw with Config.Image 'nginx:1.27', Created, State {Status:'exited', ExitCode:137},
     HostConfig.RestartPolicy {Name:'on-failure', MaximumRetryCount:3},
     NetworkSettings.Ports {'80/tcp':[{HostIp:'0.0.0.0',HostPort:'8080'},{HostIp:'::',HostPort:'8080'}],'443/tcp':null},
     Mounts [{Source:'/srv/data',Destination:'/data',RW:false}],
     NetworkSettings.Networks {web:{IPAddress:'172.18.0.2'}}, Config.Labels {b:'2',a:'1'} */
  // expect restartPolicy 'on-failure:3', ports ['8080→80/tcp','443/tcp'],
  // mounts [{source:'/srv/data',target:'/data',mode:'ro'}], networks [{name:'web',ip:'172.18.0.2'}],
  // labels [['a','1'],['b','2']], exitCode 137
})
it('toContainerDetails: env split at first =, bare key', () => {
  // Config.Env ['A=1', 'URL=a=b', 'BARE'] → [{key:'A',value:'1'},{key:'URL',value:'a=b'},{key:'BARE',value:''}]
})
it('toContainerDetails: json hides env and does not mutate input', () => {
  // json contains '"Env": "<hidden: 3 vars>"' and none of the values; raw.Config.Env still has 3 entries
})
it('toContainerDetails: tolerates a sparse object', () => {
  // toContainerDetails({}) → image '', restartPolicy 'no', exitCode null, empty arrays, json '{}'
})
```

- [ ] **Step 2: Run `npx vitest run tests/main/containerDetails.test.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/shared/containerDetails.ts`.** It holds types and pure functions only, with no node imports.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(containers): pure stats and inspect view functions`.

### Task 2: Stats loop, inspect and IPC in main

**Files:**
- Create: `src/main/docker/statsLoop.ts`
- Modify: `src/main/docker/containerService.ts`, `src/main/app.ts` (`containersApi`, `wireContainerService`), `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `tests/main/docker/statsLoop.test.ts`, `tests/main/docker/containerService.test.ts`, `tests/main/containersApi.test.ts`, `tests/main/ipc.test.ts` (channel lists)

**Interfaces:**
- Consumes: `computeStats`, `ContainerStats` (Task 1).
- Produces:
  - `startStatsLoop(o: { client: Pick<DockerClient, 'json'>; runningIds(): string[]; emit(map: Record<string, ContainerStats>): void; sleep(ms: number): Promise<void> }): { stop(): void }`
    - Each cycle requests `GET /containers/<id>/stats?stream=false` with `{ timeoutMs: 10000 }`, one id after another, never in parallel.
    - A failing request or a `null` from `computeStats` skips that id.
    - After the cycle, it emits the map, unless it was stopped.
    - It then waits `sleep(5000)` before the next cycle.
    - After `stop()`, no further request starts and nothing more is emitted.
  - `ContainerService.watchStats(hostId: string, on: boolean): void`
    - A no-op when the host is not open, or is disposed.
    - Idempotent.
    - Running ids are those with `state === 'running'` in the current list.
    - Emits `'stats', hostId, map`.
    - `dispose` stops the loop.
  - `ContainerService.inspect(hostId: string, id: string): Promise<unknown>`
    - Validates the id with `CONTAINER_ID` (`container id ไม่ถูกต้อง`).
    - Throws `ยังไม่ได้เปิด host นี้` when the host is not open.
    - A `DockerError` 404 refetches the id, then throws `container นี้ถูกลบไปแล้ว`. Any other `DockerError` throws its message.
  - `RemodeckApi.containers.watchStats(hostId: string, on: boolean): void`
    - A `send` channel `containers:watchStats` (fire-and-forget, like `terminal.write`).
    - Main ignores it for an unknown or disconnected host and for a non-boolean `on`; it never throws.
  - `RemodeckApi.containers.inspect(hostId: string, id: string): Promise<unknown>`
    - An `invoke` channel `containers:inspect`.
    - Runs the host-exists and `requireConnected` checks first.
  - Event `containers-stats` (`event:containers-stats`), with the callback `(hostId: string, stats: Record<string, ContainerStats>) => void`. It is forwarded by `wireContainerService`.

- [ ] **Step 1: Write failing tests (statsLoop)**, using a fake client and a controllable `sleep`:
  - `polls running ids one at a time and emits the map`: assert at most one `json` call is pending at any moment.
  - `skips an id whose request rejects or whose stats are malformed`
  - `waits 5000 between cycles and re-reads runningIds each cycle`
  - `stop() during a cycle prevents emit and further requests`
- [ ] **Step 2: Write failing tests (containerService)**
  - `watchStats emits stats for running containers only`
  - `watchStats(false) and dispose stop the loop`
  - `watchStats on an unopened host is a no-op`
  - `inspect returns raw JSON; 404 maps to Thai message; bad id rejected`
- [ ] **Step 3: Write failing tests (containersApi)**
  - `inspect requires a connected host`
  - `watchStats ignores a disconnected host without throwing`
- [ ] **Step 4: Run the tests.** Expected: FAIL.
- [ ] **Step 5: Implement**, mirroring how `containers.open` and `containers.action` are wired. Channel lists that `tests/main/ipc.test.ts` checks must be updated.
- [ ] **Step 6: Run the focused tests, then `npm run typecheck`.** Expected: PASS, 0 errors.
- [ ] **Step 7: Commit** `feat(containers): stats polling and inspect over IPC`.

### Task 3: Stats in the list

**Files:**
- Create: `src/renderer/src/useContainerStats.ts`
- Modify: `src/renderer/src/components/ContainerItem.tsx`, `src/renderer/src/components/ContainersView.tsx`, `src/renderer/src/containerPresentation.ts` (formatters)
- Test: `tests/renderer/useContainerStats.test.tsx`, `tests/renderer/containerPresentation.test.ts`, `tests/renderer/ContainersView.test.tsx`

**Interfaces:**
- Consumes: `api.containers.watchStats`, the `containers-stats` event, and `ContainerStats` (Task 1/2).
- Produces:
  - `useContainerStats(hostId: string, enabled: boolean): Record<string, ContainerStats>`
    - Calls `watchStats(hostId, true)` while `enabled && document.visibilityState !== 'hidden'`, and `watchStats(hostId, false)` when that stops being true (`visibilitychange`, `enabled` false, unmount, host change).
    - Ignores events for other hosts.
    - Returns `{}` after a host change until new stats arrive.
  - `formatCpu(n: number): string`: `n.toFixed(1) + '%'`.
  - `formatMem(bytes: number): string`: `${Math.round(bytes / 1048576)} MB` below 1 GiB, otherwise `${(bytes / 1073741824).toFixed(1)} GB`.
  - `ContainerItem` gains a `stats?: ContainerStats` prop. For a `running` container, the metadata line shows `CPU 2.1%` and `RAM 40 MB`, or `CPU —` and `RAM —` when stats are absent. Non-running containers show no stats.
  - `ContainersView` calls `useContainerStats(host.id, list !== null)`.

- [ ] **Step 1: Write failing tests**
  - `formatCpu/formatMem` boundaries: `0.04` gives `0.0%`; 1048576 gives `1 MB`; 1073741824 gives `1.0 GB`.
  - `useContainerStats turns watching on when enabled and off on unmount`
  - `useContainerStats turns off when the document is hidden and back on when visible`
  - `useContainerStats ignores other hosts' stats`
  - `ContainersView shows CPU/RAM for running containers and — when missing; none for stopped`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): live CPU and RAM in containers list`.

### Task 4: Details panel

**Files:**
- Create: `src/renderer/src/components/ContainerDetailsPanel.tsx`
- Modify: `src/renderer/src/components/ContainerItem.tsx` (name becomes a select button), `src/renderer/src/components/ContainersView.tsx` (selection + two-column layout), `src/renderer/src/assets/main.css`
- Modify: `docs/manual-test.md` (Containers section: stats show and stop updating when hidden; details tabs; env reveal per row; JSON hides env)
- Test: `tests/renderer/ContainerDetailsPanel.test.tsx`, `tests/renderer/ContainersView.test.tsx`

**Interfaces:**
- Consumes:
  - `api.containers.inspect` (Task 2).
  - `toContainerDetails` (Task 1).
  - `dangerLevel('inspect', …)`, which is always `none`, so there is no confirm; call it anyway, like the other actions.
- `ContainerItem` gains `selected: boolean` and `onSelect(): void`. The container name renders as a `button` with:
  - `aria-label="รายละเอียด <name>"`
  - `aria-pressed={selected}`
  - the same visual style as the current name (no row hover fill)
- `ContainersView`:
  - Holds `selectedId: string | null` and clears it when that id leaves `list`.
  - Clicking the selected name again closes the panel.
  - Shows `ContainerDetailsPanel` in the right column only when an id is selected (see the Layout ruling).
- `ContainerDetailsPanel({ host, container, onClose })`:
  - Keyed by `container.id` in the parent.
  - Fetches `api.containers.inspect(host.id, container.id)` on mount, and again whenever `container.state` or `container.status` changes.
  - Ignores a late result after unmount or a newer fetch.
  - States: `กำลังโหลด…`, or the error text plus a `ลองอีกครั้ง` button.
  - Header: the container name and a close button (`aria-label="ปิดรายละเอียด"`).
  - Tabs: `Overview | Env | JSON`, using `role="tablist"` / `role="tab"` / `aria-selected`.
    - **Overview:** the fields from Task 1, as a definition list. Empty lists show `—`.
    - **Env:** one row per variable, `KEY = ••••••`, with an eye button per row:
      - `aria-label="แสดงค่า KEY"`, which becomes `ซ่อนค่า KEY` when revealed;
      - `aria-pressed`.
      - There is no reveal-all button.
      - With no variables, the tab shows `ไม่มี environment variable`.
    - **JSON:** `<pre>` with `details.json`. It is read-only.

- [ ] **Step 1: Write failing tests**
  - `panel loads inspect and shows overview fields`
  - `env values are hidden until that row's eye is pressed; other rows stay hidden`
  - `there is no reveal-all control` (no button whose name matches `/ทั้งหมด|all/i`)
  - `JSON tab shows <hidden: N vars> and no env values`
  - `refetches when container status changes; ignores a stale response`
  - `inspect error shows message and ลองอีกครั้ง retries`
  - `ContainersView: clicking a name opens details, clicking again closes`
  - `ContainersView: selected container removed from list closes the panel`
  - `ContainersView: switching selection resets revealed env` (reveal on A, select B, then B's value is hidden)
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, then update `docs/manual-test.md`.
- [ ] **Step 4: Run the full suite (`npx vitest run`) and `npm run typecheck`.** Expected: all PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(renderer): container details panel`.
