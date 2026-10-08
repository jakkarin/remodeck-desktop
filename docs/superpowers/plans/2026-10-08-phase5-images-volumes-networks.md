# Phase 5 — Images / Volumes / Networks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Images, Volumes and Networks tabs next to Containers. Each lists its resources with an "in use" badge, and supports remove per row and prune per kind, gated by the danger table.

**Architecture:**
- Pure shared parsers turn Docker list JSON into rows and compute "in use" from the container list. `ContainerInfo` gains `imageId`, `volumes` and `networks`.
- In main, functions in `resources.ts` call the host's existing `DockerClient` through new `ContainerService` methods. Three IPC calls (`resources`, `removeResource`, `prune`) validate the kind and ref, and map Docker errors to Thai.
- In the renderer, `ContainersView` gets top-level tabs. A `ResourcesView` per kind fetches on open and after each action (no cache), and reuses the GroupPanel/ItemRow list style.

**Tech Stack:** Electron main (DockerClient over `docker system dial-stdio`), React 19, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-remodeck-containers-design.md` (§3.3 images/volumes/networks, §4.1 tab strip, §4.3, §4.4, §5 404/409 rows)

## Global Constraints

- **Fetching (§3.3):** images, volumes and networks are listed, removed and pruned through the client directly. Nothing is cached; lists are fetched again when the tab opens or after a command.
- **Rows (§4.3):** each row shows name/tag, size (if available), created, and an "in use" badge computed from the container list. Each row has a remove button, and the header has a prune button.
- **Danger levels (§4.4)** come only from `dangerLevel()`:

  | Actions | Normal host | Protected host |
  |---|---|---|
  | `image-rm`, `image-prune`, `network-rm`, `network-prune` | `click` | `type` |
  | `volume-rm`, `volume-prune` | `type` | `type` |

- **Docker errors (§5):**
  - **404:** `<kind> นี้ถูกลบไปแล้ว` (`image`, `volume` or `network`), then reload the list.
  - **409 (and 403 for networks):** map known cases to Thai:
    - image in use: `image นี้ถูกใช้โดย container อยู่ ต้องลบ container นั้นก่อน`
    - volume in use: `volume นี้ถูกใช้โดย container อยู่ ต้องลบ container นั้นก่อน`
    - network with active endpoints: `network นี้ยังมี container ต่ออยู่`
    - predefined network: `ลบ network พื้นฐาน (bridge/host/none) ไม่ได้`
  - **Anything else:** Docker's own message.
- **Tab strip (§4.1):** `[Containers | Images | Volumes | Networks]`.
- **Copy:** user-facing copy is Thai, except command and field names (Remove, Prune, in use, Images…).
- **Screen design rules** (`docs/superpowers/specs/2026-10-08-containers-compose-list-design.md`):
  - Lists are semantic `ul`/`li` in bordered groups, not tables.
  - No row hover fill.
  - Clicking the row background runs nothing.
  - The Remove button keeps a fixed position.
  - Visible focus and accessible names.

  **Ruling:** spec §4.3 says "table". Resources use the same Compose-list pattern the user chose for Containers, so the module reads as one design.
- **Commit trailer:** implementer commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Image with several tags:** one row per tag. Removing a row untags only that tag, and the image stays while other tags remain. Tests: Task 1 (rows) and Task 2 (remove uses the tag).
2. **Dangling image (`<none>:<none>`) and an image with no RepoTags:** one row, named by the short id, removed by id. Test: Task 1.
3. **Network `bridge`/`host`/`none`:** no Remove button is offered, and main refuses them anyway. Tests: Task 2 and Task 4.
4. **Ref with characters that could change the API path (`../`, `?`, `#`, `%`, spaces):** main rejects it before any request. Test: Task 2.
5. **Prune on a protected host, or of volumes:** the action requires the typed host label. The result line reports what was removed. Test: Task 4.

---

### Task 1: Shared resource rows and "in use"

**Files:**
- Create: `src/shared/resources.ts`
- Modify: `src/shared/containers.ts` (`ContainerInfo` + `toContainerInfo`)
- Test: `tests/main/resources.test.ts`, `tests/main/containers.test.ts`

**Interfaces:**
- `ContainerInfo` gains:
  - `imageId: string` (from `ImageID`, else `''`).
  - `volumes: string[]`: `Mounts[]` entries with `Type === 'volume'`, their `Name`. Sorted and unique.
  - `networks: string[]`: keys of `NetworkSettings.Networks`. Sorted.
- Produces (`src/shared/resources.ts`, types and pure functions only):
  - `export type ResourceKind = 'image' | 'volume' | 'network'`
  - `export const RESOURCE_KINDS: readonly ResourceKind[]`
  - `export type ResourceRow = { kind: ResourceKind; ref: string; name: string; id: string; size: number | null; created: number | null; driver: string; builtIn: boolean }`
    - `ref` is what main uses to remove the resource.
    - `created` is epoch milliseconds.
  - `export type PruneResult = { deleted: number; reclaimed: number | null }`
  - `toImageRows(raw: unknown): ResourceRow[]`
    - One row per `RepoTags` entry that is not `<none>:<none>`: `ref` = tag, `name` = tag, `id` = `Id`, `size` = `Size`, `created` = `Created` × 1000, `driver` = `''`, `builtIn` false.
    - An image with no usable tag gives one row: `name` = the first 12 hex chars after `sha256:`, `ref` = full `Id`.
    - Sorted by name.
  - `toVolumeRows(raw: unknown): ResourceRow[]`
    - Reads `raw.Volumes ?? []`: `ref` = `name` = `Name`, `id` = `Name`, `size` null, `created` = `Date.parse(CreatedAt)` or null, `driver` = `Driver`, `builtIn` false.
    - Sorted by name.
  - `toNetworkRows(raw: unknown): ResourceRow[]`
    - `ref` = `Id`, `name` = `Name`, `id` = `Id`, `size` null, `created` = `Date.parse(Created)` or null, `driver` = `Driver`.
    - `builtIn` = name ∈ {`bridge`, `host`, `none`}.
    - Sorted by name.
  - `isInUse(row: ResourceRow, containers: ContainerInfo[]): boolean`
    - image: some `c.imageId === row.id`
    - volume: some `c.volumes` includes `row.name`
    - network: some `c.networks` includes `row.name`
  - `parsePrune(kind: ResourceKind, raw: unknown): PruneResult`
    - image: `ImagesDeleted.length` (null counts as 0), `SpaceReclaimed`.
    - volume: `VolumesDeleted.length`, `SpaceReclaimed`.
    - network: `NetworksDeleted.length`, `reclaimed` null.
  - Ref validators (anchored regexes):
    - `IMAGE_REF = /^(sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._\-/]*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(@sha256:[a-f0-9]{64})?)$/`. It must also reject any `..` segment.
    - `VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/`
    - `NETWORK_ID = /^[a-f0-9]{12,64}$/`

- [ ] **Step 1: Write failing tests**
  - `toContainerInfo reads imageId, volume mounts (not bind mounts) and network names`
  - `toImageRows: one row per tag, dangling image by short id, sorted`
    - An image with `RepoTags ['a:1','b:2']` gives 2 rows with `ref` `'a:1'`/`'b:2'` and the same `id`.
    - An image with `['<none>:<none>']`, or with `RepoTags` null, gives one row named `abcdef012345`, with `ref` = full `Id`.
  - `toVolumeRows / toNetworkRows map fields; bridge/host/none are builtIn`
  - `isInUse per kind`
  - `parsePrune per kind; null lists count 0`
  - `IMAGE_REF accepts nginx:1.27, ghcr.io/o/app:v1, sha256 ids; rejects ../x, a?b, a#b, a%2f, 'a b', ''`
  - `VOLUME_NAME / NETWORK_ID accept and reject`
  - `tolerates malformed input`: `toImageRows(null)`, `toVolumeRows({})` and `toNetworkRows('x')` each return `[]`.
- [ ] **Step 2: Run `npx vitest run tests/main/resources.test.ts tests/main/containers.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Update any test fixtures or object literals that construct `ContainerInfo` so the typecheck passes (`npm run typecheck`).
- [ ] **Step 4: Run the tests and the typecheck.** Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(containers): resource rows, in-use and prune parsing`.

### Task 2: Main — list, remove, prune over IPC

**Files:**
- Create: `src/main/docker/resources.ts`
- Modify: `src/main/docker/containerService.ts`, `src/main/app.ts` (`containersApi`), `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `tests/main/docker/resources.test.ts`, `tests/main/docker/containerService.test.ts`, `tests/main/containersApi.test.ts`, `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: Task 1 parsers and validators.
- Produces:
  - `listResources(client: Pick<DockerClient, 'json'>, kind: ResourceKind): Promise<ResourceRow[]>`
    - image: `GET /images/json`
    - volume: `GET /volumes`
    - network: `GET /networks`
  - `removeResource(client, kind, ref): Promise<void>`
    - Validates `ref` first with `IMAGE_REF` / `VOLUME_NAME` / `NETWORK_ID`; on failure throws `ชื่อ <kind> ไม่ถูกต้อง`.
    - image: `DELETE /images/<ref>` (no force). Keep `/` as-is in the path, since Docker's route takes the full name; encode `:` and `@` with `encodeURIComponent` per segment.
    - volume: `DELETE /volumes/<ref>`
    - network: `DELETE /networks/<ref>`
    - Timeout `{ timeoutMs: 120000 }`.
  - `pruneResources(client, kind): Promise<PruneResult>`
    - `POST /images/prune`, `/volumes/prune` or `/networks/prune`.
    - Timeout `{ timeoutMs: 120000 }`.
  - `dockerErrorMessage(kind, e: unknown): Error` maps a `DockerError` to the Thai messages in Global Constraints:
    - 404 → `<kind> นี้ถูกลบไปแล้ว`.
    - image 409 → the image-in-use message.
    - volume 409 → the volume-in-use message.
    - network 403/409 with `/active endpoints/i` → the active-endpoints message.
    - network 403 with `/pre-defined|predefined/i` → the predefined-network message.
    - Otherwise `new Error(e.message)`. A non-`DockerError` passes through unchanged.
  - `ContainerService.resources(hostId, kind)`, `.removeResource(hostId, kind, ref)` and `.prune(hostId, kind)` delegate to these using the host's client.
    - Each throws `ยังไม่ได้เปิด host นี้` when the host is not open or is disposed.
    - Errors pass through `dockerErrorMessage`.
    - Removing a network whose current list row is `builtIn`: throw the predefined message without calling Docker. Do this by looking up the row in a fresh `listResources` result; if the ref is not found, let Docker decide.
  - `RemodeckApi.containers.resources(hostId, kind): Promise<ResourceRow[]>`, `removeResource(hostId, kind, ref): Promise<void>` and `prune(hostId, kind): Promise<PruneResult>`
    - All `invoke` channels: `containers:resources`, `containers:removeResource`, `containers:prune`.
    - Each runs the host-exists and `requireConnected` checks first.
    - `kind` must be in `RESOURCE_KINDS`, otherwise `Invalid resource kind`. `ref` must be a string.

- [ ] **Step 1: Write failing tests (resources.ts)**, using a fake client recording `(method, path, body, opts)`:
  - `lists each kind via the right path and parser`
  - `remove image by tag keeps slashes: DELETE /images/ghcr.io/o/app%3Av1`
  - `remove rejects bad refs before any request` (`../x`, `a?b`, `a b`, a non-hex network id)
  - `prune posts to the right path and parses the result`
  - `dockerErrorMessage maps 404/409/403 cases to the Thai copy and passes others through`
- [ ] **Step 2: Write failing tests (service and api)**
  - `service methods require an open host`
  - `removing a builtIn network throws the predefined message without DELETE`
  - `containersApi validates kind and connection`
  - `ipc channels listed`
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement**, mirroring how `containers.inspect` is wired.
- [ ] **Step 5: Run the focused tests and `npm run typecheck`.** Expected: PASS, 0 errors.
- [ ] **Step 6: Commit** `feat(containers): list, remove and prune images, volumes, networks`.

### Task 3: Tabs and read-only resource lists

**Files:**
- Create: `src/renderer/src/components/ResourcesView.tsx`
- Modify: `src/renderer/src/components/ContainersView.tsx` (tab strip), `src/renderer/src/containerPresentation.ts` (if a byte/date formatter is needed), `src/renderer/src/assets/main.css`
- Test: `tests/renderer/ResourcesView.test.tsx`, `tests/renderer/ContainersView.test.tsx`

**Interfaces:**
- Consumes: `api.containers.resources` (Task 2), `isInUse`, `ResourceRow` (Task 1), and the existing `GroupPanel`/`ItemRow`/`Badge`/`ErrorBanner`/`TextInput` primitives.
- `ContainersView` renders a tab strip at the top:
  - `role="tablist"` with `aria-label="Docker resources"`.
  - Tabs `Containers | Images | Volumes | Networks`, each `role="tab"` with `aria-selected`.
  - It defaults to Containers and resets when the host changes (the view is already keyed by host).
  - On the Containers tab everything else is unchanged: toolbar, list, details panel and stats. The stats hook is enabled only while the Containers tab is shown.
  - The other tabs render `ResourcesView({ host, kind, containers: list ?? [] })`.
- `ResourcesView`:
  - Fetches on mount and whenever `kind` changes. A late response for an old kind or after unmount is ignored.
  - States: `กำลังโหลด…`; error banner plus the error text plus `ลองอีกครั้ง`; empty list `ยังไม่มี <kind> บน <host label>`.
  - Filter input `aria-label="Filter <Images|Volumes|Networks>"` matches the name (case-insensitive). With no matches it shows `ไม่มีรายการที่ตรงกับตัวกรอง`.
  - One `GroupPanel` titled `Images` / `Volumes` / `Networks`. Each `ItemRow` shows:
    - the name in mono;
    - a `Badge` reading `in use` when `isInUse`;
    - a `built-in` badge for builtIn networks;
    - metadata: size via `formatMem` when `size !== null`, driver when non-empty, and created via `toLocaleString` when not null.
  - Leave the actions slot empty in this task; Task 4 fills it.

- [ ] **Step 1: Write failing tests**
  - `tab strip switches between Containers and Images`
  - `stats watching is off while a resource tab is shown`
  - `ResourcesView loads rows and marks in-use from containers`
  - `filter, empty and error-retry states`
  - `ignores a late response after switching kind`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): images, volumes and networks tabs`.

### Task 4: Remove and prune with confirmation

**Files:**
- Modify: `src/renderer/src/components/ResourcesView.tsx`, `src/renderer/src/assets/main.css` (only if needed)
- Modify: `docs/manual-test.md` (Containers section: one item per tab for list, in use, remove of an in-use item showing the Thai error, prune on a normal vs protected host, volume always typed, built-in network has no Remove)
- Test: `tests/renderer/ResourcesView.test.tsx`

**Interfaces:**
- Consumes: `api.containers.removeResource`, `api.containers.prune` (Task 2), `dangerLevel`, `ConfirmDanger`.
- Per row: a Remove `IconButton` (lucide `Trash2`, `aria-label="Remove <name>"`). It is absent for builtIn networks; keep an empty slot so alignment is unchanged.
  - Danger action `image-rm` / `volume-rm` / `network-rm`.
  - Confirm summary `remove <kind> · <name>`; confirm label `Remove`.
- Group header action: a `Prune` button (`aria-label="Prune <images|volumes|networks>"`).
  - Danger action `image-prune` / `volume-prune` / `network-prune`.
  - Confirm summary `prune <kind>s`; confirm label `Prune`.
- Every action goes through `ConfirmDanger` when `dangerLevel` is not `none` (all of them are `click` or `type` here). A pending confirm records `hostId`; the same stale-host guard as `ContainersView` applies.
- After a successful remove or prune, the view reloads the list.
  - Prune also shows an info line `ลบแล้ว N รายการ` plus, when `reclaimed` is not null, ` · คืนพื้นที่ <formatMem(reclaimed)>`.
- Errors go to the error banner and the list reloads, so a 404 row disappears.
- While an action runs, its button is disabled (busy key per ref, and `prune:<kind>`).

- [ ] **Step 1: Write failing tests**
  - `image Remove asks click on a normal host and calls removeResource with the tag`
  - `volume Remove always asks for the typed host label`
  - `protected host: image prune requires the typed host label`
  - `built-in network has no Remove button`
  - `prune shows the result line and reloads`
  - `remove error (in use) shows the Thai message in the banner and reloads`
  - `busy: double-clicking Remove or Prune opens one confirm/one call`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, then update `docs/manual-test.md`.
- [ ] **Step 4: Run the full suite (`npx vitest run`) and `npm run typecheck`.** Expected: all PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(renderer): remove and prune docker resources`.
