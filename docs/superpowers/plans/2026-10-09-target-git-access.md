# Target Git Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** remodeck stores scoped git tokens on Windows and installs them, with a generic credential helper and a `gh` wrapper, onto a target host so any agent there can `git push` and `gh pr create` with the right token per repo.

**Architecture:** Pure scope logic lives in `src/shared/gitAccess.ts` (used by main and renderer). Main has a `GitTokenService` (validate via a `ProviderAdapter`, encrypt with `safeStorage` into `secrets.json`, metadata in `config.json`) and a `TargetAccessService` that pipes generated POSIX sh scripts to `SshTarget.exec` for install / status / remove. The renderer gets a Git tokens settings section and a Git access panel in Host settings.

**Tech Stack:** Electron (`safeStorage`), TypeScript, POSIX sh on the target, Vitest (node + jsdom projects), Testing Library.

**Spec:** [docs/superpowers/specs/2026-10-09-target-git-access-design.md](../specs/2026-10-09-target-git-access-design.md)

## Global Constraints

- Only provider `github` with host `github.com` this round; data model and target layout stay host-generic.
- Target root: `~/.config/remodeck/git-access/` (`0700`); token files `tokens/<host>/<path>/@token` (`0600`).
- Wrapper path `~/.local/bin/gh`, marker on line 2: `# remodeck-cli-wrapper gh v<N>`; `WRAPPER_VERSION = 1`.
- Include line: `git config --global --add include.path "$HOME/.config/remodeck/git-access/gitconfig"`; helper path written as absolute `$HOME/...`.
- GitHub git username `x-access-token`; CLI env `GH_TOKEN`; repo flags `-R`, `--repo`; repo env `GH_REPO`.
- Token values never in argv, logs, `push-log.jsonl`, thrown messages, or IPC responses; they reach the target only inside the script on ssh stdin.
- No fallback to plaintext on Windows when `safeStorage.isEncryptionAvailable()` is false.
- Never touch target shell rc files; never install packages on the target; touch the target only on explicit Install / Update / Remove / Check.
- User-facing copy is English, sentence case (matches commit `0bb2ee6`).
- Expiry warning threshold: 7 days.

## Review Focus

1. Running on Windows: `LocalTarget` integration tests must assert target state through `target.exec` (bash), not Node `fs` — earlier suites failed on Windows path translation. Permission-bit assertions use `it.skipIf(process.platform === 'win32')`.
2. Repo URLs with mixed case, trailing `.git`, trailing `/`, or `ssh://git@github.com/` form must resolve to the same scope as the token (helper and wrapper both normalize).
3. A pre-existing `~/.local/bin/gh` that is not ours must survive Install and Remove byte-for-byte.
4. A token containing characters that are special in shell (`$`, `` ` ``, `'`, `\`) must be written verbatim — install uses quoted heredoc delimiters; token values with whitespace/newlines are rejected before any script is built.
5. Running Install twice, or Install after a half-failed Install, converges to the same state; removing a scope from the set deletes its `@token` and now-empty dirs but never a sibling override.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/shared/gitAccess.ts` (create) | `GitToken`, `HostGitAccess`, `GitAccessStatus` types; scope normalize / validate / compare / match; token value check |
| `src/shared/types.ts` (modify) | `Config.gitTokens`, `Host.gitAccess?` |
| `src/main/gitAccess/providers.ts` (create) | `ProviderAdapter`, `githubAdapter`, `adapterForHost` |
| `src/main/gitAccess/secretStore.ts` (create) | `Encryptor`, `SecretStore` over `secrets.json` |
| `src/main/store/store.ts` (modify) | load/save `gitTokens`, `Host.gitAccess`; token and host-access mutations |
| `src/main/gitAccess/gitTokenService.ts` (create) | add / replace / setLabel / remove tokens |
| `src/main/gitAccess/scripts.ts` (create) | helper, wrapper, install, remove, status script builders |
| `src/main/gitAccess/statusParse.ts` (create) | parse status output; compute stale / missing / outdated |
| `src/main/gitAccess/redact.ts` (create) | replace known secrets in text |
| `src/main/gitAccess/targetAccessService.ts` (create) | install / remove / status on a host |
| `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts` (modify) | `gitTokens.*`, `gitAccess.*` IPC |
| `src/renderer/src/components/settings/GitTokensSection.tsx` (create) | Settings → Git tokens |
| `src/renderer/src/components/HostGitAccessPanel.tsx` (create) | Host settings → Git access on this host |
| `src/renderer/src/settingsOpener.ts`, `SettingsView.tsx`, `HostSettingsDialog.tsx` (modify) | mount the new UI |
| `README.md`, `docs/manual-test.md` (modify) | security boundary, manual checklist |

---

### Task 1: Scope model (shared)

**Files:**
- Create: `src/shared/gitAccess.ts`
- Modify: `src/shared/types.ts` (`Host`, `Config`)
- Test: `tests/main/gitAccess/scope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GitProviderId = 'github'
  export type GitToken = { id: string; provider: GitProviderId; host: string; path: string; login: string; label: string; expiresAt: string | null; updatedAt: string }
  export type HostGitAccess = { installedAt: string; installed: Record<string, string>; wrapperVersion: number | null }
  export type GitAccessStatus = {
    helperInstalled: boolean; includeActive: boolean; scopesOnTarget: string[]
    cli: { path: string | null; version: string | null }
    wrapper: { state: 'ours' | 'foreign' | 'none'; version: number | null; outdated: boolean; loginShell: boolean; nonLoginShell: boolean }
    otherHelpers: string[]; stale: string[]; missing: string[]
  }
  export function normalizeScopePath(path: string): string
  export function validateScope(host: string, path: string): string | null
  export function scopeKey(s: { host: string; path: string }): string
  export function compareScopes(a: { host: string; path: string }, b: { host: string; path: string }): number
  export function matchScope<T extends { host: string; path: string }>(items: T[], host: string, repoPath: string): T | null
  export function isValidTokenValue(token: string): boolean
  ```
  `Host` gains `gitAccess?: HostGitAccess`; `Config` gains `gitTokens: GitToken[]`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(normalizeScopePath('/Org-A/Payments.git/')).toBe('org-a/payments')
expect(validateScope('github.com', 'org-a/../x')).toMatch(/segment/)
expect(validateScope('github.com', 'org a')).not.toBeNull()
expect(validateScope('GitHub.com', 'org-a')).not.toBeNull()          // host must already be lowercase
expect(validateScope('github.com', '')).not.toBeNull()
expect(validateScope('github.com', 'org-a/payments')).toBeNull()
const items = [{ host: 'github.com', path: 'org-a' }, { host: 'github.com', path: 'org-a/payments' }]
expect(matchScope(items, 'github.com', 'Org-A/Payments.git')).toBe(items[1])
expect(matchScope(items, 'github.com', 'org-a/x')).toBe(items[0])
expect(matchScope(items, 'github.com', 'org-ab/x')).toBeNull()
expect(matchScope(items, 'gitlab.com', 'org-a/x')).toBeNull()
expect(['org-a/payments', 'org-a-x', 'org-a'].map(p => ({ host: 'github.com', path: p })).sort(compareScopes).map(s => s.path))
  .toEqual(['org-a', 'org-a/payments', 'org-a-x'])
expect(isValidTokenValue('github_pat_ABC$`\'\\')).toBe(true)
expect(isValidTokenValue('a b')).toBe(false)
expect(isValidTokenValue('a\nb')).toBe(false)
expect(isValidTokenValue('x'.repeat(513))).toBe(false)
```

- [ ] **Step 2: Run** `npx vitest run tests/main/gitAccess/scope.test.ts` — Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/shared/gitAccess.ts` and extend `types.ts`**

Segment rule from the spec: non-empty, not `.`/`..`, `/^[a-z0-9._-]+$/`. Host rule: `/^[a-z0-9.-]+$/`. `compareScopes` compares host, then path segment by segment (shorter prefix first). `matchScope` normalizes `repoPath`, then tries full path and drops trailing segments down to one. `isValidTokenValue`: `/^[\x21-\x7e]{1,512}$/`.

Also add `gitTokens: []` to both return paths of `Store.load` so the new `Config` field typechecks (real loading lands in Task 3).

- [ ] **Step 4: Run** the test file and `npm run typecheck` — Expected: PASS

- [ ] **Step 5: Commit** `feat(git-access): scope model shared by main and renderer`

---

### Task 2: GitHub provider adapter

**Files:**
- Create: `src/main/gitAccess/providers.ts`
- Test: `tests/main/gitAccess/providers.test.ts`

**Interfaces:**
- Consumes: `GitProviderId`, `normalizeScopePath` (Task 1)
- Produces:
  ```ts
  export type CliSpec = { command: string; tokenEnv: string; repoFlags: string[]; repoEnv: string | null }
  export interface ProviderAdapter {
    readonly id: GitProviderId; readonly defaultHosts: readonly string[]; readonly gitUsername: string
    readonly cli: CliSpec | null
    validatePath(path: string): string | null
    validateToken(host: string, path: string, token: string): Promise<{ login: string; expiresAt: string | null }>
  }
  export function createGithubAdapter(fetchImpl?: typeof fetch, apiBase?: string): ProviderAdapter
  export function adapterForHost(adapters: ProviderAdapter[], host: string): ProviderAdapter | null
  ```

- [ ] **Step 1: Write the failing tests** with a fake `fetch` keyed by URL:

```ts
// GET /user 200 with header github-authentication-token-expiration: '2026-12-01 00:00:00 UTC'
await expect(a.validateToken('github.com', 'org-a', 'tok')).resolves.toEqual({ login: 'jak', expiresAt: '2026-12-01T00:00:00.000Z' })
// /orgs/org-a 404, /users/org-a 200 -> resolves
// /orgs/x 404, /users/x 404 -> rejects /Owner x not found/
// /user 401 -> rejects 'Token is invalid or expired'
// path 'org-a/payments': GET /repos/org-a/payments 200 -> resolves; 404 -> rejects /can't access org-a\/payments/
// no expiry header -> expiresAt null
// every request carries Authorization: Bearer tok and Accept: application/vnd.github+json
expect(a.validatePath('a/b/c')).not.toBeNull()
expect(a.validatePath('a/b')).toBeNull()
expect(adapterForHost([a], 'github.com')).toBe(a)
expect(adapterForHost([a], 'gitlab.com')).toBeNull()
// a rejected error message never contains 'tok'
```

- [ ] **Step 2: Run** `npx vitest run tests/main/gitAccess/providers.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement** per the spec table: `defaultHosts ['github.com']`, `gitUsername 'x-access-token'`, `cli { command: 'gh', tokenEnv: 'GH_TOKEN', repoFlags: ['-R', '--repo'], repoEnv: 'GH_REPO' }`, `validatePath` 1–2 segments. Default `apiBase` `https://api.github.com`. Parse the expiry header with `Date` after replacing `' UTC'` with `'Z'` and the first space with `T`.

- [ ] **Step 4: Run** — Expected: PASS

- [ ] **Step 5: Commit** `feat(git-access): GitHub provider adapter with token validation`

---

### Task 3: Secret store and config persistence

**Files:**
- Create: `src/main/gitAccess/secretStore.ts`
- Modify: `src/main/store/store.ts`
- Test: `tests/main/gitAccess/secretStore.test.ts`, `tests/main/store.test.ts` (append)

**Interfaces:**
- Consumes: `GitToken`, `HostGitAccess`, `compareScopes`, `scopeKey` (Task 1)
- Produces:
  ```ts
  export interface Encryptor { isAvailable(): boolean; encrypt(plain: string): Buffer; decrypt(blob: Buffer): string }
  export function electronEncryptor(): Encryptor   // wraps electron safeStorage; only imported by app.ts
  export class SecretStore { constructor(dir: string, enc: Encryptor); set(id: string, secret: string): void; get(id: string): string; delete(id: string): void }
  // Store
  upsertGitToken(t: Omit<GitToken, 'id' | 'updatedAt'>): GitToken   // same host+path -> keeps id, new updatedAt
  setGitTokenLabel(id: string, label: string): GitToken
  removeGitToken(id: string): void
  setHostGitAccess(hostId: string, access: HostGitAccess | null): Host
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// SecretStore with a fake Encryptor (reverses bytes)
s.set('t1', 'secret'); expect(new SecretStore(dir, enc).get('t1')).toBe('secret')
expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain('secret')
s.delete('t1'); expect(() => s.get('t1')).toThrow(/No secret/)
expect(() => new SecretStore(dir, { ...enc, isAvailable: () => false }).set('t', 'x')).toThrow(/encryption isn't available/i)
// Store
const t = store.upsertGitToken({ provider: 'github', host: 'github.com', path: 'org-a', login: 'j', label: 'A', expiresAt: null })
const t2 = store.upsertGitToken({ ...same, label: 'B' }); expect(t2.id).toBe(t.id); expect(t2.updatedAt >= t.updatedAt).toBe(true)
expect(new Store(dir).config.gitTokens).toHaveLength(1)                         // persisted
expect(store.config.gitTokens.map(scopeKey)).toEqual(sorted by compareScopes)
store.setHostGitAccess(h.id, { installedAt: 'x', installed: { [t.id]: t.updatedAt }, wrapperVersion: 1 })
expect(new Store(dir).config.hosts[0].gitAccess?.wrapperVersion).toBe(1)
store.setHostGitAccess(h.id, null); expect(store.config.hosts[0].gitAccess).toBeUndefined()
// loading a config.json without gitTokens yields []; entries failing validateScope are dropped
```

- [ ] **Step 2: Run** both files — Expected: FAIL

- [ ] **Step 3: Implement.** `SecretStore` keeps `{ [id]: base64 }`, writes `secrets.json` via tmp + rename like `Store.save`. `set` throws `Encryption isn't available on this system, so the token can't be saved` when unavailable. `Store.load` adds `gitTokens` (filtered by `validateScope`), keeps `host.gitAccess` only when it is an object with an `installed` object. `removeGitToken` does not touch hosts (stale detection handles it).

- [ ] **Step 4: Run** both files and `npm run typecheck` — Expected: PASS

- [ ] **Step 5: Commit** `feat(git-access): encrypted secret store and token config`

---

### Task 4: Token service

**Files:**
- Create: `src/main/gitAccess/gitTokenService.ts`
- Test: `tests/main/gitAccess/gitTokenService.test.ts`

**Interfaces:**
- Consumes: `Store` methods and `SecretStore` (Task 3); `ProviderAdapter`, `adapterForHost` (Task 2); `normalizeScopePath`, `validateScope`, `isValidTokenValue` (Task 1)
- Produces:
  ```ts
  export type AddGitTokenInput = { host: string; path: string; label: string; token: string }
  export class GitTokenService {
    constructor(deps: { store: Store; secrets: SecretStore; adapters: ProviderAdapter[] })
    add(input: AddGitTokenInput): Promise<GitToken>        // existing scope = rotate
    replace(id: string, token: string): Promise<GitToken>
    setLabel(id: string, label: string): GitToken
    remove(id: string): void
    sourceFor(id: string): CredentialSource   // throws 'Unknown token' for an unknown id
    hostsUsing(id: string): Host[]
  }
  export interface CredentialSource { readonly tokenId: string; resolve(): Promise<{ token: string; expiresAt: string | null }> }
  export class StoredTokenSource implements CredentialSource   // reads SecretStore + GitToken.expiresAt
  ```

- [ ] **Step 1: Write the failing tests** (fake adapter recording calls)

```ts
await svc.add({ host: 'github.com', path: '/Org-A/', label: ' A ', token: 'tok' })
// adapter.validateToken called with ('github.com', 'org-a', 'tok'); stored path 'org-a', label 'A'; secrets.get(id) === 'tok'
await expect(svc.add({ ...in, host: 'gitlab.com' })).rejects.toThrow("gitlab.com isn't supported yet")
await expect(svc.add({ ...in, path: 'a/b/c' })).rejects.toThrow()            // adapter.validatePath
await expect(svc.add({ ...in, token: 'a b' })).rejects.toThrow('Token contains invalid characters')
// validateToken rejects -> nothing written to store or secrets
// add twice for the same scope -> same id, secret replaced
// replace(id, 'tok2') re-validates with the token's host/path
// remove(id) deletes the secret and the config entry
// hostsUsing(id) returns hosts whose gitAccess.installed has id
await expect(svc.sourceFor(id).resolve()).resolves.toEqual({ token: 'tok', expiresAt: null })
expect(() => svc.sourceFor('nope')).toThrow('Unknown token')
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** — validation order: scope → adapter exists → `adapter.validatePath` → `isValidTokenValue` → `validateToken` → write secret → `store.upsertGitToken`. Label falls back to the scope key when empty.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): token service`

---

### Task 5: Credential helper and install script (git side)

**Files:**
- Create: `src/main/gitAccess/scripts.ts` (helper + install parts)
- Test: `tests/main/gitAccess/helperScript.test.ts`

**Interfaces:**
- Consumes: `CliSpec` (Task 2)
- Produces:
  ```ts
  export const WRAPPER_VERSION = 1
  export const ROOT = '$HOME/.config/remodeck/git-access'
  export type InstallInput = {
    tokens: { host: string; path: string; token: string }[]
    providers: { host: string; gitUsername: string }[]
    wrappers: { cli: CliSpec; defaultHost: string }[]   // Task 6 fills the wrapper part
  }
  export function helperScript(): string                  // content of git-credential-remodeck
  export function buildInstallScript(input: InstallInput): string
  ```
  Install script stdout ends with one line per wrapper: `wrapper=<cli>:installed` or `wrapper=<cli>:skipped`.

- [ ] **Step 1: Write the failing tests** using `LocalTarget` on a temp HOME (assert via `target.exec`):

```ts
await t.exec(buildInstallScript({ tokens: [
  { host: 'github.com', path: 'org-a', token: 'A$`x' },
  { host: 'github.com', path: 'org-a/payments', token: 'P' },
  { host: 'github.com', path: 'org-b', token: 'B' } ],
  providers: [{ host: 'github.com', gitUsername: 'x-access-token' }], wrappers: [] }))
const fill = (path: string) => t.exec(`printf 'protocol=https\\nhost=github.com\\npath=${path}\\n\\n' | GIT_TERMINAL_PROMPT=0 git credential fill`)
expect((await fill('org-a/x.git')).stdout).toContain('password=A$`x')
expect((await fill('Org-A/Payments.git')).stdout).toContain('password=P')
expect((await fill('org-b/y.git')).stdout).toContain('username=x-access-token')
expect((await fill('org-c/y.git')).code).not.toBe(0)                          // no answer -> prompt disabled -> fails
expect((await t.exec(`printf 'protocol=https\\nhost=gitlab.com\\npath=org-a/x\\n\\n' | sh "${ROOT}/git-credential-remodeck" get`)).stdout).toBe('')
expect((await t.exec(`sh "${ROOT}/git-credential-remodeck" --token-for github.com/org-a/payments`)).stdout).toBe('P')
// erase leaves @token in place
// second install with only org-b: org-a/@token and org-a/payments/@token gone, tokens/github.com/org-a dir gone, org-b intact
// `git config --global --get-all include.path` lists the include exactly once after two installs
// useHttpPath finding: pre-seed ~/.git-credentials with https://u:old@github.com and credential.helper=store;
//   record what `git credential fill` returns for org-c/y (no remodeck token). Assert the observed behavior and
//   copy it into the spec's gitconfig section (Task 11).
it.skipIf(process.platform === 'win32')('modes', ...) // dir 700, @token 600, helper 700 via `stat -c %a`
```

- [ ] **Step 2: Run** `npx vitest run tests/main/gitAccess/helperScript.test.ts` — Expected: FAIL

- [ ] **Step 3: Implement.** Helper is `#!/bin/sh`; reads key=value lines until blank; ignores non-`get` actions; looks up `gitUsername` in `providers.conf`; normalizes the path (lowercase via `tr`, strip `.git` and slashes); walks prefixes from longest to one segment. Install script: `set -eu`, `umask 077`, `mkdir -p`; every file written with `cat > "$f.tmp" <<'REMODECK_<random hex>'` then `mv`; token files written with `printf %s` from a quoted heredoc so no trailing newline; delete `@token` files not in the set, then `find "$ROOT/tokens" -type d -empty -delete`; add the include only when `git config --global --get-all include.path` doesn't already list it. Generate one heredoc delimiter per script with `crypto.randomBytes(8)`.

- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): credential helper and install script`

---

### Task 6: `gh` wrapper

**Files:**
- Modify: `src/main/gitAccess/scripts.ts`
- Test: `tests/main/gitAccess/wrapperScript.test.ts`

**Interfaces:**
- Consumes: `buildInstallScript`, `InstallInput`, `WRAPPER_VERSION` (Task 5)
- Produces: `export function cliWrapperScript(cli: CliSpec, defaultHost: string, version: number): string`; `buildInstallScript` now writes `~/.local/bin/<cli.command>` per the spec rules.

- [ ] **Step 1: Write the failing tests.** Put a fake `gh` at `$HOME/fakebin/gh` that prints `token=${GH_TOKEN:-none} args=$*`; run with `PATH="$HOME/.local/bin:$HOME/fakebin:$PATH"`; create repos with `git init` + `git remote add origin`.

```ts
// in repo origin https://github.com/org-a/payments.git: `gh pr create` -> 'token=P args=pr create'
// in repo origin git@github.com:Org-A/x.git -> token=A
// in repo origin ssh://git@github.com/org-b/y -> token=B
// outside any repo: `gh -R org-b/y pr list` -> token=B; `gh --repo=org-a/payments x` -> token=P; `gh -R github.com/org-b/y x` -> token=B
// GH_REPO=org-b/y gh x (outside repo) -> token=B
// GH_TOKEN=preset gh x (in org-a repo) -> token=preset
// outside repo, no flags -> token=none
// args with spaces and quotes pass through unchanged
// line 2 of ~/.local/bin/gh is '# remodeck-cli-wrapper gh v1'
// pre-existing ~/.local/bin/gh without marker: install prints 'wrapper=gh:skipped' and the file is byte-identical
// wrapper v0 file (marker v0) is replaced by v1
// PATH without a real gh: exit code 127 and stderr mentions 'gh not found'
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** per the spec's 5-step wrapper flow. Real binary lookup iterates `PATH` entries and skips candidates where `[ "$c" -ef "$0" ]`. Repo flag parsing only reads flags, it never consumes or reorders `"$@"`. URL parsing handles `https://<host>/`, `git@<host>:`, `ssh://git@<host>/`; `-R` with two parts uses `defaultHost`. Token lookup calls the helper with `--token-for`.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): gh wrapper that picks the token per repo`

---

### Task 7: Status and remove scripts

**Files:**
- Modify: `src/main/gitAccess/scripts.ts`
- Create: `src/main/gitAccess/statusParse.ts`
- Test: `tests/main/gitAccess/statusScript.test.ts`, `tests/main/gitAccess/statusParse.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 6
- Produces:
  ```ts
  export function buildStatusScript(clis: CliSpec[], hosts: string[]): string
  export function buildRemoveScript(clis: CliSpec[]): string
  export type RawStatus = { helper: boolean; include: boolean; scopes: string[]; cliPath: string | null; cliVersion: string | null
    wrapper: { state: 'ours' | 'foreign' | 'none'; version: number | null }; loginResolves: string | null; nonLoginResolves: string | null; otherHelpers: string[] }
  export function parseStatusOutput(stdout: string): RawStatus
  export function computeStatus(raw: RawStatus, access: HostGitAccess | undefined, tokens: GitToken[], wrapperVersion: number): GitAccessStatus
  ```
  Status script output, one `key=value` per line: `helper=0|1`, `include=0|1`, `scope=<host/path>` (repeat), `cli_path=`, `cli_version=`, `wrapper=ours:<N>|foreign|none`, `resolve_login=`, `resolve_nonlogin=`, `other_helper=` (repeat).

- [ ] **Step 1: Write the failing tests**

```ts
// statusParse (pure)
expect(parseStatusOutput('helper=1\ninclude=1\nscope=github.com/org-a\nwrapper=ours:1\ncli_version=2.62.0\n')).toMatchObject({ helper: true, scopes: ['github.com/org-a'], wrapper: { state: 'ours', version: 1 } })
// computeStatus: token updatedAt differs from access.installed[id] -> stale [id]; installed id whose scope is not on target -> missing [id];
// installed id no longer in tokens -> stale (removed token still on host); wrapper version 0 < 1 -> outdated true;
// loginShell true only when resolve_login equals "$HOME/.local/bin/gh" as reported
// status script on LocalTarget after install: helper=1, include=1, three scope lines, wrapper=ours:1
// with credential.helper=store set globally -> other_helper=store
// remove script: include gone, root gone, our wrapper gone, foreign wrapper untouched; running remove twice exits 0
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement.** Status uses `bash -lc 'command -v gh'` and `bash -c 'command -v gh'` for the two resolve lines, finds the real CLI the same way the wrapper does, and lists `credential.helper` plus `credential.https://<host>.helper` values that aren't ours. Remove uses `git config --global --fixed-value --unset-all include.path "$ROOT/gitconfig"` and falls back to the escaped-regex form when git exits 129 (unknown option); it must exit 0 when nothing is installed.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): status and remove scripts`

---

### Task 8: Target access service and redaction

**Files:**
- Create: `src/main/gitAccess/redact.ts`, `src/main/gitAccess/targetAccessService.ts`
- Test: `tests/main/gitAccess/targetAccessService.test.ts`

**Interfaces:**
- Consumes: `GitTokenService.sourceFor(id).resolve()` (Task 4), script builders (Tasks 5–7), `computeStatus` (Task 7), `Store.setHostGitAccess` (Task 3), `SandboxTarget`
- Produces:
  ```ts
  export function redact(text: string, secrets: string[]): string     // each secret -> '***'
  export class TargetAccessService {
    constructor(deps: { store: Store; tokens: GitTokenService; adapters: ProviderAdapter[]; targetFor(hostId: string): SandboxTarget })
    status(hostId: string): Promise<GitAccessStatus>
    install(hostId: string, tokenIds: string[]): Promise<GitAccessStatus>
    remove(hostId: string): Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing tests** with a recording fake `SandboxTarget` plus one `LocalTarget` round trip:

```ts
// install with ids [a, p] -> script contains both tokens; store host.gitAccess.installed = { a: tA.updatedAt, p: tP.updatedAt }, wrapperVersion 1
// install output 'wrapper=gh:skipped' -> wrapperVersion null
// script exits 1 with stderr containing 'tok-secret' -> rejection message contains '***' and not 'tok-secret'
// install with an unknown token id -> rejects 'Unknown token', nothing executed
// install with [] -> rejects 'Choose at least one token'
// remove -> executes remove script, then host.gitAccess undefined
// status -> executes status script only (never install), returns computeStatus result
// LocalTarget: install then status returns stale [] and missing []; replace a token then status returns stale [id]
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement.** Providers in the install input come from the adapters of the selected tokens' hosts; wrappers from adapters with a `cli`, `defaultHost = adapter.defaultHosts[0]`. Every thrown error passes through `redact` with all secrets in the install input.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): target access service`

---

### Task 9: IPC wiring

**Files:**
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/app.ts`
- Test: `tests/main/ipc.test.ts` (append)

**Interfaces:**
- Consumes: `GitTokenService` (Task 4), `TargetAccessService` (Task 8), `electronEncryptor` (Task 3), `createGithubAdapter` (Task 2)
- Produces on `RemodeckApi`:
  ```ts
  gitTokens: {
    list(): Promise<GitToken[]>
    add(input: { host: string; path: string; label: string; token: string }): Promise<GitToken>
    replace(id: string, token: string): Promise<GitToken>
    setLabel(id: string, label: string): Promise<GitToken>
    remove(id: string): Promise<void>
  }
  gitAccess: {
    status(hostId: string): Promise<GitAccessStatus>
    install(hostId: string, tokenIds: string[]): Promise<GitAccessStatus>
    remove(hostId: string): Promise<void>
  }
  ```
  Channels `gitTokens:list|add|replace|setLabel|remove`, `gitAccess:status|install|remove`.

- [ ] **Step 1: Write the failing test** — `registerHandlers` with the extended `IPC_CHANNELS` throws `MainApi is missing gitTokens.list` for an api without the group, and registers all eight channels via `handle` when present.
- [ ] **Step 2: Run** `npx vitest run tests/main/ipc.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement.** In `createApp`, build `adapters = [createGithubAdapter()]`, `secrets = new SecretStore(opts.dataDir, electronEncryptor())`, the two services with `targetFor`, and the api groups. No method returns a token value.
- [ ] **Step 4: Run** the test, `npm run typecheck` — Expected: PASS
- [ ] **Step 5: Commit** `feat(git-access): expose tokens and host access over IPC`

---

### Task 10: Settings → Git tokens

**Files:**
- Create: `src/renderer/src/components/settings/GitTokensSection.tsx`
- Modify: `src/renderer/src/settingsOpener.ts` (add `'gitTokens'`), `src/renderer/src/components/SettingsView.tsx` (section `{ id: 'gitTokens', label: 'Git tokens' }` after Repositories)
- Test: `tests/renderer/GitTokensSection.test.tsx`

**Interfaces:**
- Consumes: `api.gitTokens.*`, `useAppState().hosts`, `compareScopes`, `scopeKey`

- [ ] **Step 1: Write the failing tests** (mock `api` like `HostSettingsDialog.test.tsx`; fix `Date.now` with `vi.setSystemTime('2026-10-09')`)

```tsx
// rows render in compareScopes order; github.com/org-a/payments row follows github.com/org-a
// expiry badges: '2026-10-12' -> 'Expires in 3 days' (warning); '2026-10-01' -> 'Expired'; null -> 'No expiry'
// host count per row from hosts[].gitAccess.installed
// Add token form: host select has only 'github.com'; submit calls api.gitTokens.add({ host: 'github.com', path: 'org-a', label: 'Work', token: 'tok' })
// token input has type=password and is cleared after success and after failure
// add rejects 'Token is invalid or expired' -> message shown inline
// Remove on a token installed on 1 host -> confirm text lists that host label before api.gitTokens.remove
// help text mentions 'Contents' and 'Pull requests' and links to https://github.com/settings/personal-access-tokens/new
```

- [ ] **Step 2: Run** `npx vitest run tests/renderer/GitTokensSection.test.tsx` — Expected: FAIL
- [ ] **Step 3: Implement** with existing `Button`, `TextInput`, `Badge`, and the list styling used by `RepositoriesSection`; Replace token opens the same form with host/path read-only.
- [ ] **Step 4: Run** the file and `tests/renderer/SettingsView.test.tsx` — Expected: PASS
- [ ] **Step 5: Commit** `feat(renderer): git tokens settings`

---

### Task 11: Host settings → Git access, docs

**Files:**
- Create: `src/renderer/src/components/HostGitAccessPanel.tsx`
- Modify: `src/renderer/src/components/HostSettingsDialog.tsx` (render the panel below the protected-host hint), `README.md` (Security boundary), `docs/manual-test.md`, spec gitconfig section (useHttpPath finding from Task 5)
- Test: `tests/renderer/HostGitAccessPanel.test.tsx`

**Interfaces:**
- Consumes: `api.gitAccess.*`, `api.gitTokens.list`, `ConfirmDanger`, `GitAccessStatus`

- [ ] **Step 1: Write the failing tests**

```tsx
// host without gitAccess: shows unchecked 'Enable git access on this host'; api.gitAccess.status not called
// enabling shows the spec warning text exactly:
//   'Tokens are stored in plain text on this host. Anything running as this user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval.'
// first Install opens ConfirmDanger (mode 'click', confirmLabel 'Install'); confirming calls api.gitAccess.install('h1', [checked ids])
// host with gitAccess: status loads on mount; checkboxes pre-checked from gitAccess.installed; primary button reads 'Update host'
// stale id -> 'Changed since install' badge on that row
// status rows: cli null -> 'gh not found on this host'; wrapper foreign -> 'gh wrapper not installed: ~/.local/bin/gh already exists';
//   nonLoginShell false -> mentions 'Put ~/.local/bin first in PATH'; wrapper outdated -> 'Update available'; otherHelpers ['store'] -> warning naming 'store'
// Remove from host -> ConfirmDanger, then api.gitAccess.remove('h1') and refresh()
// 'Check again' re-calls status; status rejection shows the error inline and keeps the panel usable
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement** the panel; exactly one primary button (Install / Update host). Docs: README states the default (no token in sandbox) and the per-host opt-in; manual-test adds the spec's two-org / override / Remove scenario with Claude Code or Codex on a real host.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npx eslint` on changed files — Expected: new tests pass; report any pre-existing Windows path failures separately with counts.
- [ ] **Step 5: Commit** `feat(renderer): git access panel in host settings` and `docs: git access on target hosts`
