# regit-desktop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron desktop app that manages git repos living in Linux AI sandboxes over SSH, routing all GitHub traffic through a host-side bare mirror and an approval-gated HTTP bridge so the sandbox never holds GitHub credentials.

**Architecture:** Main process shells out to system `git` and `ssh` (no `ssh2`). One bare mirror per GitHub repo on the host; each sandbox workspace is a remote `ws-<id>` in that mirror. App-launched terminals get an `ssh -R` tunnel to a local smart-HTTP proxy (`GitBridge`) plus a per-shell `url.<bridge>.insteadOf=https://github.com/` env override. Renderer (React) talks to main only through a typed preload API.

**Tech Stack:** Electron + electron-vite + React + TypeScript, xterm.js + node-pty, Vitest (+ @testing-library/react, jsdom for renderer tests).

**Spec:** `docs/superpowers/specs/2026-10-03-regit-desktop-mvp-design.md` — read it before starting any task.

## Global Constraints

- Host OS: Windows 11 (dev machine); sandbox OS: Linux only. Node 22, git ≥ 2.45 on host.
- Call system binaries only: `git`, `ssh`, `bash` (Git Bash on host, for tests). Never add `ssh2` or a git library.
- SSH binary: use `C:/Windows/System32/OpenSSH/ssh.exe` if it exists, else `ssh` from PATH. Host git calls set `GIT_SSH_COMMAND="<sshPath> -o BatchMode=yes"` so git transport and `SandboxExec` use the same ssh (same agent, same config).
- Non-interactive ssh (`SandboxExec`, git transport, forward check) always uses `-o BatchMode=yes -o ConnectTimeout=10`. Only terminal ssh is interactive.
- Every host git call sets `GIT_TERMINAL_PROMPT=0`.
- Never pass `--force` / `+` refspec when pushing to GitHub. Forced refspecs are allowed only for pushes into a sandbox under `refs/remotes/origin/*`.
- Zero footprint: the app writes nothing into a sandbox except `git init`, `remote origin`, `refs/remotes/origin/*`, tags, and the initial `checkout -b <default>` — only for workspaces it creates. Never edit GitHub repo settings. Removing a workspace never deletes anything in the sandbox.
- No token is ever written to app files or sent to a sandbox. Credentials come from `git credential fill` (protocol=https, host=github.com) each time.
- App data dir: `%APPDATA%/regit/` → `config.json`, `push-log.jsonl`, `mirrors/<owner>/<repo>.git`. Tests inject a temp dir instead.
- Hosts start `disconnected` on every launch; connect state is never persisted.
- Bridge listens on `127.0.0.1` only. Approval timeout 60 000 ms = deny. Remote forward port random in [20000, 60000), max 5 attempts.
- Protected branches default `["main","master"]`; rules (no ref deletion, no push to protected) apply even with always-allow unless the repo's `enforceRules` is `false`.
- User-facing copy is Thai, exact strings given in tasks.

## Review Focus

1. **Sandbox paths with `~` or spaces** (`~/my repos/api`) — every script and git URL must quote correctly; expected: clone/sync work. Tests: Task 4 `shPath`, Task 7 clone with spaced path.
2. **Branch names containing `/`** (`feat/a`) — mapping `ws-<id>/feat/a` → `refs/heads/feat/a`, compare URL keeps slashes. Tests: Task 9 push, Task 10 `compareUrl`.
3. **Empty GitHub repo** (no commits, no HEAD) — clone must succeed with an empty sandbox repo and `defaultBranch` staying `main`. Test: Task 7.
4. **git's large-push probe** (POST body exactly `0000`) — bridge must pass it through without prompting. Test: Task 11 parser + Task 13 bridge.
5. **Concurrent Sync of two workspaces sharing one mirror** — must serialize and both succeed. Test: Task 8.

---

### Task 1: Project scaffold

**Files:**
- Create: project via electron-vite `react-ts` template at repo root (`package.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/...`)
- Create: `vitest.config.ts`, `tests/smoke.test.ts`, `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test` (`vitest run`), `typecheck`.

- [ ] **Step 1:** Generate the template into a temp folder and move it to the repo root (keep `docs/`): `npm create @quick-start/electron@latest regit-tmp -- --template react-ts`, then move contents, `npm install`.
- [ ] **Step 2:** Add dev deps `vitest @testing-library/react @testing-library/jest-dom jsdom`. `vitest.config.ts`: `test.include = ['tests/**/*.test.ts','tests/**/*.test.tsx']`, `environmentMatchGlobs: [['tests/renderer/**','jsdom']]`, `testTimeout: 30000`.
- [ ] **Step 3:** Write `tests/smoke.test.ts`: `expect(1 + 1).toBe(2)`. Run `npm test` → PASS. Run `npm run typecheck` → no errors. Run `npm run dev` → window opens; close it.
- [ ] **Step 4:** Commit `chore: scaffold electron-vite react-ts app with vitest`.

---

### Task 2: Process runner, HostGit, mirror lock

**Files:**
- Create: `src/main/proc/run.ts`, `src/main/proc/sshPath.ts`, `src/main/git/hostGit.ts`, `src/main/git/lock.ts`
- Test: `tests/main/git/hostGit.test.ts`, `tests/main/git/lock.test.ts`

**Interfaces:**
- Produces:
  - `type ProcResult = { code: number; stdout: string; stderr: string }`
  - `runProcess(cmd: string, args: string[], opts?: { cwd?: string; input?: string | Buffer; env?: Record<string,string>; timeoutMs?: number }): Promise<ProcResult>` — never rejects on non-zero exit; rejects only on spawn failure / timeout.
  - `resolveSshPath(): string`
  - `class GitError extends Error { args: string[]; code: number; stderr: string }` — `message` = `git <args>\n<stderr>`.
  - `class HostGit { constructor(opts?: { gitPath?: string; sshPath?: string }); readonly env: Record<string,string>; run(cwd: string | null, args: string[], opts?: { input?: string; allowFail?: boolean }): Promise<ProcResult> }` — throws `GitError` on non-zero unless `allowFail`.
  - `withLock<T>(key: string, fn: () => Promise<T>): Promise<T>` — per-key FIFO mutex.

- [ ] **Step 1: Failing tests**
  - `hostGit.test.ts`: `run(tmp, ['init'])` → code 0; `run(tmp, ['rev-parse','HEAD'])` rejects with `GitError` whose `stderr` is non-empty; same with `allowFail:true` resolves with `code !== 0`; `new HostGit({sshPath:'C:/x/ssh.exe'}).env` has `GIT_TERMINAL_PROMPT: '0'` and `GIT_SSH_COMMAND: '"C:/x/ssh.exe" -o BatchMode=yes -o ConnectTimeout=10'`.
  - `lock.test.ts`: two `withLock('m', …)` calls with 50 ms sleeps record order `['a-start','a-end','b-start','b-end']`; different keys overlap.
- [ ] **Step 2:** `npm test -- tests/main/git` → FAIL (modules missing).
- [ ] **Step 3:** Implement. `runProcess` uses `child_process.spawn` (no shell). `HostGit` env: `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="<sshPath> -o BatchMode=yes -o ConnectTimeout=10"`.
- [ ] **Step 4:** `npm test -- tests/main/git` → PASS.
- [ ] **Step 5:** Commit `feat(main): process runner, HostGit and per-mirror lock`.

---

### Task 3: Shared types, Store, git output parsers

**Files:**
- Create: `src/shared/types.ts`, `src/main/store/store.ts`, `src/main/git/parsers.ts`
- Test: `tests/main/store.test.ts`, `tests/main/git/parsers.test.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`):
  ```ts
  type Host = { id: string; sshHost: string; label: string }
  type Repo = { id: string; owner: string; name: string; defaultBranch: string;
                protectedBranches: string[]; alwaysAllowPush: boolean; enforceRules: boolean }
  type Workspace = { id: string; repoId: string; hostId: string; sandboxPath: string }
  type Config = { hosts: Host[]; repos: Repo[]; workspaces: Workspace[] }
  type RefUpdate = { oldSha: string; newSha: string; ref: string }
  type PushLogEntry = { time: string; repo: string; workspaceId: string | null; channel: 'review' | 'bridge';
                        updates: RefUpdate[]; result: 'ok' | 'denied' | 'blocked' | 'rejected' | 'error'; detail?: string }
  type BranchInfo = { name: string; sha: string; base: string; ahead: number; behind: number; merged: boolean; rewritten: boolean }
  type CommitInfo = { sha: string; subject: string; author: string; date: string }
  type WorktreeInfo = { path: string; branch: string | null; head: string | null; dirty: number }
  type HostState = 'disconnected' | 'connecting' | 'connected' | 'error'
  type HostStatus = { state: HostState; gitVersion?: string; warnings: string[]; error?: string }
  type PushOutcome = { ok: true } | { ok: false; reason: 'protected' | 'non-fast-forward' | 'error'; message: string }
  type ApprovalDecision = 'once' | 'session' | 'always' | 'deny'
  type ApprovalRequest = { id: string; repoId: string; repoLabel: string; sessionId: string; tabLabel: string; updates: RefUpdate[] }
  ```
- Produces (`Store`): `constructor(dir: string)`; `get config(): Config`; `addHost(sshHost: string, label: string): Host`; `removeHost(id)` (throws if it has workspaces); `upsertRepo(owner: string, name: string): Repo` (dedupe case-insensitively; defaults `defaultBranch:'main'`, protected `['main','master']`, `alwaysAllowPush:false`, `enforceRules:true`); `updateRepo(id: string, patch: Partial<Omit<Repo,'id'|'owner'|'name'>>): Repo`; `addWorkspace(repoId, hostId, sandboxPath): Workspace`; `removeWorkspace(id): void`; `mirrorPath(repo: Repo): string`; `appendPushLog(e: PushLogEntry): void`; `readPushLog(limit: number): PushLogEntry[]` (newest first). Ids: `crypto.randomUUID().slice(0, 8)`. Every mutation writes `config.json` atomically (write tmp + rename).
- Produces (`parsers.ts`): `parseSymrefHead(lsRemote: string): string | null`; `parseRefs(out: string): Map<string, string>` (input format `%(refname)%00%(objectname)` per line); `parseWorktrees(porcelain: string): { path: string; branch: string | null; head: string | null }[]` (strip `refs/heads/`); `countDirty(statusV2: string): number` (lines starting `1 `, `2 `, `u `, `? `).

- [ ] **Step 1: Failing tests**
  - Store: new Store on empty dir → `config` equals `{hosts:[],repos:[],workspaces:[]}`; add host/repo/workspace, new `Store(sameDir)` reads them back; `upsertRepo('Acme','API')` twice returns same id; `mirrorPath` ends with `mirrors/acme/api.git`; push log append ×3 then `readPushLog(2)` returns last two newest-first; `removeHost` with a workspace throws.
  - Parsers: `parseSymrefHead('ref: refs/heads/main\tHEAD\nabc\tHEAD\n')` → `'main'`; empty string → `null`; `parseWorktrees` on a two-entry porcelain sample (one detached) → branch `'feat/a'` and `null`; `countDirty('# branch.oid x\n1 .M N... …\n? new.txt\n')` → `2`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): shared types, config store and git parsers`.

---

### Task 4: Sandbox targets and shell quoting

**Files:**
- Create: `src/main/sandbox/target.ts`, `src/main/sandbox/shell.ts`
- Test: `tests/main/sandbox/shell.test.ts`, `tests/main/sandbox/target.test.ts`

**Interfaces:**
- Produces:
  - `shQuote(s: string): string` — single-quote, `'` → `'\''`.
  - `shPath(p: string): string` — `'~'` → `"$HOME"`; `'~/rest'` → `"$HOME"/` + `shQuote('rest')`; else `shQuote(p)`.
  - `interface SandboxTarget { exec(script: string): Promise<ProcResult>; gitUrl(path: string): string }`
  - `class SshTarget implements SandboxTarget { constructor(sshHost: string, sshPath: string) }` — exec = `ssh -o BatchMode=yes -o ConnectTimeout=10 <host> bash -s` with script on stdin; `gitUrl('~/x')` → `ssh://<host>/~/x`, `gitUrl('/srv/x')` → `ssh://<host>/srv/x`.
  - `sshExecArgs(sshHost: string): string[]` (exported for test).
  - `class LocalTarget implements SandboxTarget { constructor(homeDir: string) }` — test double: runs `bash -s` locally with `HOME=homeDir`; `gitUrl(p)` resolves `~` to `homeDir` and returns a plain path.

- [ ] **Step 1: Failing tests** — `shPath('~/my repos/it\'s')` → `"$HOME"/'my repos/it'\''s'`; `shPath('/srv/a b')` → `'/srv/a b'`; `sshExecArgs('box')` equals `['-o','BatchMode=yes','-o','ConnectTimeout=10','box','bash','-s']`; `LocalTarget.exec('mkdir -p ' + shPath('~/a b') + ' && echo ok')` → stdout `ok\n` and dir exists under homeDir.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): sandbox exec targets and shell quoting`.

---

### Task 5: Preflight and ConnectionService

**Files:**
- Create: `src/main/sandbox/preflight.ts`, `src/main/connection/connectionService.ts`
- Test: `tests/main/connection.test.ts`

**Interfaces:**
- Consumes: `SandboxTarget` (Task 4), `HostStatus` (Task 3).
- Produces:
  - `PREFLIGHT_SCRIPT: string` — prints `git=<git --version or empty>` and `remotehttp=<1|0>` (from `test -x "$(git --exec-path)/git-remote-http"`).
  - `parsePreflight(stdout: string): { gitVersion: string | null; remoteHttp: boolean }`
  - `checkRemoteForward(sshPath: string, sshHost: string): Promise<boolean>` — `ssh -o BatchMode=yes -o ConnectTimeout=10 -o ExitOnForwardFailure=yes -R 127.0.0.1:<random port>:127.0.0.1:9 <host> true`, true iff exit 0.
  - `class ConnectionService extends EventEmitter` — `constructor(deps: { targetFor(hostId: string): SandboxTarget; checkForward(hostId: string): Promise<boolean>; onDisconnect(hostId: string): void })`; `status(hostId): HostStatus` (default `{state:'disconnected',warnings:[]}`); `connect(hostId): Promise<HostStatus>`; `disconnect(hostId): void`; `requireConnected(hostId): void` (throws `Error('Host ยังไม่ได้ connect')`). Emits `'status'` `(hostId, HostStatus)` on every change.
- Copy (exact):
  - ssh failure → `state:'error'`, `error` = ssh stderr + `\nลองรัน ssh <sshHost> ใน terminal ของระบบก่อน`
  - no git → `state:'error'`, `error: 'ไม่พบ git บนเครื่องนี้ — ติดตั้งก่อน เช่น sudo apt install git หรือ sudo dnf install git แล้วกด Reload'`
  - no git-remote-http → warning `'git บนเครื่องนี้ไม่รองรับ HTTP — push/pull จาก terminal ของแอปจะใช้ไม่ได้'`
  - forward fails → warning `'sshd ปิด AllowTcpForwarding — push/pull จาก terminal ของแอปจะใช้ไม่ได้'`

- [ ] **Step 1: Failing tests** (fake target returning canned `ProcResult`): initial status disconnected; connect with git present → `connected`, `gitVersion` set, emits `connecting` then `connected`; missing git → `error` with exact copy; `remotehttp=0` → connected + warning; forward false → connected + warning; ssh exit 255 → error contains stderr; `disconnect` → `disconnected` and `onDisconnect` called; `requireConnected` throws when not connected.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): preflight checks and connection state`.

---

### Task 6: MirrorService

**Files:**
- Create: `src/main/mirror/mirrorService.ts`, `tests/helpers/repos.ts`
- Test: `tests/main/mirror.test.ts`

**Interfaces:**
- Consumes: `HostGit`, `withLock` (Task 2), `Repo`, `Workspace` (Task 3).
- Produces:
  - `class MirrorService { constructor(git: HostGit, originUrl: (repo: Repo) => string) ; ensure(repo: Repo, mirrorPath: string): Promise<void>; addWorkspace(mirrorPath: string, wsId: string, url: string): Promise<void>; removeWorkspace(mirrorPath: string, wsId: string): Promise<void>; rebuild(repo: Repo, mirrorPath: string, workspaces: { id: string; url: string }[]): Promise<void> }`
  - `ensure` is idempotent: bare init if missing; remote `origin` with fetch refspecs exactly `+refs/heads/*:refs/remotes/origin/*` and `+refs/tags/*:refs/tags/*` (url updated if changed). `addWorkspace` sets remote `ws-<id>` fetch `+refs/heads/*:refs/remotes/ws-<id>/*` (idempotent). `removeWorkspace` = `git remote remove ws-<id>` (deletes its refs). All mutate under `withLock(mirrorPath)`.
  - Default `originUrl` (wired in Task 14): `https://github.com/<owner>/<name>.git`.
- Produces (`tests/helpers/repos.ts`, reused by Tasks 7–9, 13): `makeTmp(): string`; `makeFakeGitHub(tmp): { url: string; seed(files: Record<string,string>, branch?: string): Promise<string /*sha*/> }` (bare repo + a scratch clone to commit/push); `git(cwd, ...args): Promise<string>` (stdout, throws on fail).

- [ ] **Step 1: Failing tests** — `ensure` twice → `git config --get-all remote.origin.fetch` lists exactly the two refspecs; `addWorkspace('w1', url)` twice → single remote; `removeWorkspace('w1')` → `git remote` no longer lists `ws-w1` and `refs/remotes/ws-w1/*` gone; `rebuild` on a mirror with a corrupted `HEAD` file → mirror usable again with both remotes.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): mirror service`.

---

### Task 7: SyncService.cloneToSandbox

**Files:**
- Create: `src/main/sync/syncService.ts`
- Test: `tests/main/sync/clone.test.ts`

**Interfaces:**
- Consumes: `HostGit`, `withLock`, `MirrorService`, `Store`, `SandboxTarget`, `shPath`, `parseSymrefHead`.
- Produces: `class SyncService { constructor(deps: { git: HostGit; mirror: MirrorService; store: Store; targetFor: (hostId: string) => SandboxTarget }); cloneToSandbox(ws: Workspace): Promise<void> }` (later tasks add methods to this class). Private helper `remoteName(wsId) = 'ws-' + wsId`.
- Behaviour (spec §3 "Clone to sandbox"), in order:
  1. Sandbox script: path must not exist or be empty, else throw `Error('Path ไม่ว่าง: <path>')`.
  2. `mirror.ensure`, `fetch --prune origin`, `ls-remote --symref origin HEAD` → if non-null `store.updateRepo(..., {defaultBranch})`.
  3. Sandbox: `mkdir -p <p> && git init <p>` (via `shPath`).
  4. `mirror.addWorkspace(mirrorPath, ws.id, target.gitUrl(path))`; host `push ws-<id> '+refs/remotes/origin/*:refs/remotes/origin/*' 'refs/tags/*:refs/tags/*'` (skip when mirror has no refs).
  5. Sandbox: `git remote add origin https://github.com/<owner>/<name>.git`; if `refs/remotes/origin/<default>` exists: `git checkout -b <default> origin/<default>`.
  - Steps 2–4 under `withLock(mirrorPath)`.

- [ ] **Step 1: Failing tests** (LocalTarget + fake GitHub; origin URL injected to fake):
  - clone into `~/repos/my api` (space) → sandbox `git branch --show-current` = `main`, `git remote get-url origin` = `https://github.com/acme/api.git`, `refs/remotes/origin/main` sha equals GitHub's.
  - non-empty target dir → rejects with `Path ไม่ว่าง:`; mirror untouched.
  - empty GitHub repo → resolves; sandbox is a git repo with no commits; repo `defaultBranch` stays `main`.
  - zero footprint: after clone, sandbox `git status --porcelain` is empty and `git config --list --local` has no keys other than `core.*`, `remote.origin.*`, `branch.<default>.*`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): clone repo into sandbox via mirror`.

---

### Task 8: SyncService.sync and history-rewrite detection

**Files:**
- Modify: `src/main/sync/syncService.ts`
- Test: `tests/main/sync/sync.test.ts`

**Interfaces:**
- Produces: `sync(ws: Workspace): Promise<{ rewritten: string[] }>`; `rewrittenBranches(wsId: string): Set<string>` (replaced on every sync).
- Behaviour (spec §3 "Sync"), all host git steps under `withLock(mirrorPath)`:
  1. `fetch --prune origin`
  2. snapshot `refs/remotes/ws-<id>/*` (`for-each-ref` + `parseRefs`), `fetch --prune ws-<id>`, for each branch whose old sha is not an ancestor of the new sha (`merge-base --is-ancestor`, exit 1) → rewritten.
  3. `push ws-<id> '+refs/remotes/origin/*:refs/remotes/origin/*' 'refs/tags/*:refs/tags/*'`.

- [ ] **Step 1: Failing tests** (two sandboxes `w1`, `w2` cloned from the same fake GitHub):
  - commit on `feat-a` in w1 → after `sync(w1)` mirror has `refs/remotes/ws-w1/feat-a`.
  - push a new commit to fake GitHub `main` → after `sync(w1)` sandbox `origin/main` updated, sandbox local `main` and working tree unchanged.
  - both sandboxes create `feat-a` with different commits → after syncing both, `ws-w1/feat-a` ≠ `ws-w2/feat-a`, both present.
  - amend + re-commit on w1 `feat-a` → second `sync(w1)` returns `rewritten: ['feat-a']`.
  - branch deleted in sandbox → pruned from mirror.
  - `Promise.all([sync(w1), sync(w2)])` → both resolve (Review Focus 5).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): two-way sync with history rewrite detection`.

---

### Task 9: Workspace queries and Push to GitHub

**Files:**
- Create: `src/main/sync/queries.ts`
- Modify: `src/main/sync/syncService.ts`
- Test: `tests/main/sync/queries.test.ts`, `tests/main/sync/push.test.ts`

**Interfaces:**
- Consumes: `SyncService.rewrittenBranches` (Task 8), parsers (Task 3).
- Produces (`queries.ts`):
  - `listBranches(git: HostGit, mirrorPath: string, wsId: string, defaultBranch: string, rewritten: Set<string>): Promise<BranchInfo[]>` — skip `HEAD`; `base` = `origin/<name>` if it exists else `origin/<defaultBranch>`; `behind ahead` from `rev-list --left-right --count <base>...<ref>`; `merged` = `merge-base --is-ancestor <ref> origin/<default>` (false when no default ref).
  - `listCommits(git, mirrorPath, base: string, ref: string, limit = 200): Promise<CommitInfo[]>` — format `%H%x00%s%x00%an%x00%aI`.
  - `getDiff(git, mirrorPath, base: string, ref: string): Promise<string>` — `diff <base>...<ref>`.
  - `listWorktrees(target: SandboxTarget, sandboxPath: string): Promise<WorktreeInfo[]>` — one script: `git worktree list --porcelain`, then per worktree a delimited `git -C <wt> status --porcelain=v2` block.
- Produces (`SyncService`, `PushOutcome` from Task 3): `pushToGitHub(ws: Workspace, branch: string, target: string): Promise<PushOutcome>`.
  - If `repo.enforceRules` and `target` ∈ `protectedBranches` → `{ok:false, reason:'protected', message:'branch <target> ถูกป้องกัน — แก้ได้ใน Settings'}`, git not run, log `blocked`.
  - Run `push origin refs/remotes/ws-<id>/<branch>:refs/heads/<target>` (allowFail). Rejected with `[rejected]` and `non-fast-forward` or `fetch first` → `reason:'non-fast-forward'`, message `GitHub มี commit ใหม่กว่า — กด Sync แล้วให้ AI rebase บน origin/<target>`, log `rejected`. Other failure → `reason:'error'`, message = stderr, log `error`. Success → `fetch origin`, log `ok`. Log entries use `channel:'review'` and old/new shas from before/after.

- [ ] **Step 1: Failing tests**
  - queries: branch `feat/a` 2 commits ahead of `main` → `{name:'feat/a', base:'origin/main', ahead:2, behind:0, merged:false}`; after GitHub merges it → `merged:true`; `listCommits` returns 2 subjects newest first; `getDiff` contains the changed filename; `listWorktrees` on sandbox with an extra worktree with 1 untracked file → 2 entries, dirty `0` and `1`.
  - push: `feat/a` → GitHub has `refs/heads/feat/a` with the sandbox sha (Review Focus 2); push to `main` with defaults → `protected`, GitHub unchanged; GitHub `feat-x` moved ahead independently → `non-fast-forward` with exact message; push log has one entry per attempt with correct `result`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): workspace queries and push to GitHub`.

---

### Task 10: GitHub client and credentials

**Files:**
- Create: `src/main/github/credentials.ts`, `src/main/github/githubClient.ts`
- Test: `tests/main/github.test.ts`

**Interfaces:**
- Produces:
  - `type Credential = { username: string; password: string }`
  - `getGitHubCredential(git: HostGit): Promise<Credential | null>` — `git credential fill` with input `protocol=https\nhost=github.com\n\n`; null on failure or missing password.
  - `parseCredentialOutput(out: string): Credential | null`
  - `parseRepoInput(input: string): { owner: string; name: string } | null` — accepts `https://github.com/o/r(.git)(/)`, `git@github.com:o/r.git`, `o/r`.
  - `compareUrl(owner, name, base, target): string` → `https://github.com/<owner>/<name>/compare/<base>...<target>?expand=1` (slashes kept, other chars `encodeURIComponent`-ed per segment).
  - `class GitHubClient { constructor(cred: () => Promise<Credential | null>, fetchImpl?: typeof fetch, apiBase = 'https://api.github.com'); listRepos(): Promise<{ owner: string; name: string; defaultBranch: string }[]> }` — `GET /user/repos?per_page=100&sort=pushed`, `Authorization: Bearer <password>`; no credential → throw `Error('ยังไม่ได้ login GitHub — รัน git credential-manager github login ก่อน')`.

- [ ] **Step 1: Failing tests** — `parseCredentialOutput('protocol=https\nhost=github.com\nusername=u\npassword=p\n')` → `{username:'u',password:'p'}`; `parseRepoInput` on the 3 forms + `'nope'` → null; `compareUrl('acme','api','main','feat/a')` exact string; `listRepos` with fake fetch maps `owner.login`, `name`, `default_branch` and sends the Bearer header; null credential → exact error.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): GitHub client and credential lookup`.

---

### Task 11: pkt-line parser and push rules

**Files:**
- Create: `src/main/bridge/pktline.ts`, `src/main/bridge/rules.ts`
- Test: `tests/main/bridge/pktline.test.ts`, `tests/main/bridge/rules.test.ts`

**Interfaces:**
- Produces:
  - `parseReceivePackCommands(buf: Buffer): { commands: RefUpdate[]; headerLength: number } | null` — null if the flush packet hasn't arrived yet; strips capabilities after `\0` on the first line; body `0000` → `{commands: [], headerLength: 4}`.
  - `ZERO_SHA = '0'.repeat(40)`
  - `evaluateRules(updates: RefUpdate[], policy: Pick<Repo,'enforceRules'|'protectedBranches'>): { allowed: true } | { allowed: false; reason: string }` — when `enforceRules`: deletion → `ห้ามลบ <ref>`; `refs/heads/<p>` with `p` protected → `branch <p> ถูกป้องกัน`.

- [ ] **Step 1: Failing tests** — build packets with a helper `pkt(s) = (s.length+4).toString(16).padStart(4,'0') + s`; two commands with capabilities on the first → both parsed, `headerLength` equals the header byte length, trailing `PACK…` bytes ignored; header split mid-packet → null; `'0000'` → empty commands (Review Focus 4); rules: deletion blocked, `refs/heads/main` blocked, `refs/heads/feat` allowed, `refs/tags/v1` allowed, `enforceRules:false` allows everything.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(bridge): receive-pack command parser and push rules`.

---

### Task 12: ApprovalService

**Files:**
- Create: `src/main/approval/approvalService.ts`
- Test: `tests/main/approval.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 3), `RefUpdate`.
- Produces (`ApprovalDecision`, `ApprovalRequest` from Task 3):
  - `class ApprovalService { constructor(deps: { store: Store; prompt: (req: ApprovalRequest) => Promise<ApprovalDecision>; notify: (message: string) => void; timeoutMs?: number /*60000*/ }); request(req: Omit<ApprovalRequest,'id'>): Promise<boolean>; revokeSession(sessionId: string): void }`
  - Order: repo `alwaysAllowPush` → `notify('Push <refs> → <repoLabel>')`, true. Session grant → true. Else prompt raced with timeout (timeout → false). `'always'` → `store.updateRepo(repoId,{alwaysAllowPush:true})`; `'session'` → grant for `sessionId`.

- [ ] **Step 1: Failing tests** (fake timers) — `once` → true and next request prompts again; `session` → next request same session no prompt, other session prompts; `revokeSession` → prompts again; `always` → persisted in store, next request no prompt, `notify` called; `deny` → false; no answer for 60 000 ms → false.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): push approval service`.

---

### Task 13: GitBridge HTTP proxy

**Files:**
- Create: `src/main/bridge/gitBridge.ts`, `tests/helpers/httpBackend.ts`
- Test: `tests/main/bridge/gitBridge.test.ts`

**Interfaces:**
- Consumes: `parseReceivePackCommands`, `evaluateRules` (Task 11), `ApprovalService` (Task 12), `Store`, `Credential` (Task 10).
- Produces:
  - `type BridgeSession = { token: string; sessionId: string; workspaceId: string; repo: Repo; tabLabel: string }`
  - `class GitBridge { constructor(deps: { upstreamBase?: string /*'https://github.com'*/; credential: () => Promise<Credential | null>; approval: ApprovalService; store: Store }); start(): Promise<number>; stop(): Promise<void>; registerSession(s: BridgeSession): void; revokeSession(token: string): void }`
  - Route: `^/s/([A-Za-z0-9_-]+)/([^/]+)/([^/]+?)(\.git)?/(info/refs|git-upload-pack|git-receive-pack)$`; unknown token, owner/name mismatch (case-insensitive) or other path → 403. Upstream URL `<upstreamBase>/<owner>/<name>.git/<rest>?<query>`.
  - Forward headers `content-type, accept, content-encoding, git-protocol, user-agent`; add `Authorization: Basic base64(user:pass)`; stream response status/headers/body back. No credential → 502 with body `no GitHub credential`.
  - `POST git-receive-pack`: buffer until `parseReceivePackCommands` ≠ null (cap 1 MiB → 413). Empty commands → forward without approval. Else `evaluateRules` (blocked → 403, log `blocked` with reason as `detail`) → `approval.request` (false → 403, log `denied`) → forward buffered bytes + rest of stream; log `ok` if upstream 200 else `error`. Logs use `channel:'bridge'`.
  - Upload-pack and `info/refs` never prompt.
- Produces (`tests/helpers/httpBackend.ts`): `startHttpBackend(projectRoot: string): Promise<{ url: string; requests: { method: string; path: string; authorization?: string }[]; close(): Promise<void> }>` — Node HTTP server spawning `git http-backend` per request (env `GIT_PROJECT_ROOT`, `GIT_HTTP_EXPORT_ALL=1`, `REMOTE_USER=test`, `REQUEST_METHOD`, `PATH_INFO`, `QUERY_STRING`, `CONTENT_TYPE`, `HTTP_CONTENT_ENCODING`, `HTTP_GIT_PROTOCOL`), parsing CGI `Status:` and headers.

- [ ] **Step 1: Failing tests** — fake GitHub = bare repo served by `startHttpBackend`; client = local clone using `-c url.http://127.0.0.1:<bridgePort>/s/<token>/.insteadOf=<backendUrl>/`:
  - `git fetch` works, no prompt, backend saw `Authorization: Basic` header.
  - `git push origin feat` with prompt → `'once'` → backend has the ref; push log `ok`.
  - prompt `'deny'` → push exits non-zero, backend unchanged, log `denied`.
  - push to `main` → blocked without prompting, log `blocked`.
  - `git push origin :feat` (delete) → blocked.
  - wrong token → 403; token for `acme/api` used on `acme/other` → 403; after `revokeSession` → 403.
  - `-c http.postBuffer=1024` with a push larger than 1 KiB (forces the `0000` probe) → succeeds with exactly one prompt.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with `node:http` server and `node:http`/`node:https` client chosen by upstream protocol. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(bridge): approval-gated git smart-HTTP proxy`.

---

### Task 14: TerminalService

**Files:**
- Create: `src/main/terminal/sshCommand.ts`, `src/main/terminal/terminalService.ts`
- Test: `tests/main/terminal.test.ts`

**Interfaces:**
- Consumes: `shPath` (Task 4), `GitBridge.registerSession/revokeSession` (Task 13), `ApprovalService.revokeSession`, `ConnectionService.requireConnected` (Task 5), `Store`.
- Produces:
  - `buildTerminalSshArgs(o: { sshHost: string; rport: number; bridgePort: number; token: string; path: string }): string[]` →
    `['-t','-o','ExitOnForwardFailure=yes','-R','127.0.0.1:<rport>:127.0.0.1:<bridgePort>', sshHost, remoteCmd]` where
    `remoteCmd = 'cd ' + shPath(path) + " && export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='url.http://127.0.0.1:<rport>/s/<token>/.insteadOf' GIT_CONFIG_VALUE_0='https://github.com/' && exec \"$SHELL\" -l"`
  - `randomPort(rand = Math.random): number` in `[20000, 60000)`.
  - `interface PtyLike { onData(cb: (d: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void; write(d: string): void; resize(c: number, r: number): void; kill(): void }`
  - `type PtySpawner = (file: string, args: string[], opts: { cols: number; rows: number }) => PtyLike`
  - `class TerminalService extends EventEmitter { constructor(deps: { sshPath: string; bridgePort: () => number; spawn: PtySpawner; store: Store; bridge: GitBridge; approval: ApprovalService; connection: ConnectionService }); open(workspaceId: string, path?: string): Promise<{ tabId: string; label: string }>; write(tabId, data): void; resize(tabId, cols, rows): void; close(tabId): void; closeAllForHost(hostId: string): void }` — emits `'data'` `(tabId, data)` and `'exit'` `(tabId, code)`.
  - Retry: if the pty exits within 3 s and its output contains `remote port forwarding failed`, respawn with a new `randomPort`, up to 5 attempts total, then emit `'exit'` with the last output kept. `close` kills pty and revokes bridge + approval session. `path` defaults to workspace `sandboxPath`; label `<host label>:<path basename>`.

- [ ] **Step 1: Failing tests** — exact `buildTerminalSshArgs` output for path `~/repos/api`; `randomPort` with `() => 0` → 20000 and `() => 0.9999` → 59999; fake spawner whose first two ptys exit with the forward error → third succeeds, 3 spawns, all with different `-R` ports; `close` → bridge `revokeSession` and approval `revokeSession` called; `open` on a disconnected host throws; `closeAllForHost` kills only that host's tabs.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; install `node-pty` (if the native build fails on Windows, use `@homebridge/node-pty-prebuilt-multiarch` with the same API) and add `electron-builder install-app-deps` as `postinstall`. The real spawner adapter lives in `terminalService.ts` but tests pass fakes. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(main): integrated ssh terminal with bridge tunnel`.

---

### Task 15: IPC contract and main wiring

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `src/main/app.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/main/ipc.test.ts`

**Interfaces:**
- Consumes: every service above.
- Produces (`src/shared/ipc.ts`) — `RegitApi`, exposed as `window.regit`:
  ```ts
  hosts: { list(): Promise<Host[]>; add(sshHost: string, label: string): Promise<Host>; remove(id: string): Promise<void>;
           status(id: string): Promise<HostStatus>; connect(id: string): Promise<HostStatus>; disconnect(id: string): Promise<void> }
  repos: { listGitHub(): Promise<{ owner: string; name: string; defaultBranch: string }[]>; list(): Promise<Repo[]>;
           updatePolicy(id: string, patch: Partial<Pick<Repo,'protectedBranches'|'alwaysAllowPush'|'enforceRules'>>): Promise<Repo> }
  workspaces: { list(): Promise<Workspace[]>; clone(hostId: string, repoInput: string, sandboxPath: string): Promise<Workspace>;
                remove(id: string, deleteMirrorIfLast: boolean): Promise<void>; sync(id: string): Promise<{ rewritten: string[] }>;
                branches(id: string): Promise<BranchInfo[]>; commits(id: string, branch: string): Promise<CommitInfo[]>;
                diff(id: string, branch: string): Promise<string>; worktrees(id: string): Promise<WorktreeInfo[]>;
                push(id: string, branch: string, target: string): Promise<PushOutcome>; openPR(id: string, target: string): Promise<void>;
                rebuildMirror(repoId: string): Promise<void> }
  terminal: { open(workspaceId: string, path?: string): Promise<{ tabId: string; label: string }>; write(tabId: string, d: string): void;
              resize(tabId: string, c: number, r: number): void; close(tabId: string): void }
  approval: { respond(requestId: string, decision: ApprovalDecision): void }
  pushLog: { read(limit: number): Promise<PushLogEntry[]> }
  on(event: 'host-status', cb: (hostId: string, s: HostStatus) => void): () => void
  on(event: 'terminal-data', cb: (tabId: string, d: string) => void): () => void
  on(event: 'terminal-exit', cb: (tabId: string, code: number) => void): () => void
  on(event: 'approval-request', cb: (req: ApprovalRequest) => void): () => void
  ```
  - `IPC_CHANNELS`: const object mapping each method to a channel string `'<group>:<method>'`.
- Produces (`src/main/app.ts`): `createApp(opts: { dataDir: string; window: () => BrowserWindow | null }): Promise<{ api: MainApi; dispose(): Promise<void> }>` building all services; `clone` = `parseRepoInput` → `upsertRepo` → `addWorkspace` → `requireConnected` → `cloneToSandbox` (on failure remove the workspace record); `remove` = `mirror.removeWorkspace` + `store.removeWorkspace` (+ delete mirror dir if last and flag); `sync` requires connected; `openPR` uses `shell.openExternal(compareUrl(...))` with base = `BranchInfo.base` minus `origin/`; approval `prompt` sends `approval-request` to the renderer, focuses the window (`window.show(); window.focus()`), and shows an Electron `Notification` when minimized; `respond` resolves the pending prompt; connection `onDisconnect` → `terminal.closeAllForHost`.
- `handlers.ts`: `registerHandlers(ipcMain, api: MainApi)` registers one `ipcMain.handle` per `IPC_CHANNELS` entry (`terminal.write/resize/close` and `approval.respond` use `ipcMain.on`).

- [ ] **Step 1: Failing test** — with a fake `ipcMain` recording registrations, `registerHandlers` covers every value in `IPC_CHANNELS` exactly once.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement contract, handlers, preload (`contextBridge.exposeInMainWorld('regit', api)`), wire `createApp` in `index.ts`, `GitBridge.start()` on launch and `dispose` on quit. **Step 4:** Run → PASS; `npm run typecheck` clean.
- [ ] **Step 5:** Commit `feat: typed IPC contract and main process wiring`.

---

### Task 16: Renderer — Sidebar, hosts, Clone

**Files:**
- Create: `src/renderer/src/api.ts`, `src/renderer/src/state.ts`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/AddHostDialog.tsx`, `src/renderer/src/components/CloneDialog.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/renderer/Sidebar.test.tsx`, `tests/renderer/CloneDialog.test.tsx`

**Interfaces:**
- Consumes: `RegitApi` (Task 15) via `api.ts` (`export const api: RegitApi = window.regit`, mockable in tests by `vi.mock`).
- Produces: `state.ts` — React context `useAppState()` with `hosts`, `statuses: Record<hostId, HostStatus>`, `repos`, `workspaces`, `selected: { kind: 'workspace' | 'settings'; id?: string }`, `refresh()`; subscribes to `host-status`.
- Sidebar: tree Host → Workspaces (`<owner>/<name> · <path>`); per host a status dot, **Connect** (disconnected/error) or **Disconnect** (connected), **Clone** (disabled unless connected); error text + **Reload** button (= connect) when `state==='error'`; warnings listed under the host. Footer: **Add host**, **Settings**.
- CloneDialog: repo picker from `repos.listGitHub()` with a free-text field (accepts URL / `owner/name`); path field defaulting to `~/repos/<name>` when a repo is picked; Clone button shows progress and error text from the rejected promise.

- [ ] **Step 1: Failing tests** — Sidebar with a disconnected host: Connect visible, Clone disabled; with `error` status: error text and Reload visible; clicking Connect calls `api.hosts.connect(id)`. CloneDialog: picking `acme/api` sets path `~/repos/api`; submit calls `api.workspaces.clone(hostId, 'acme/api', '~/repos/api')`; rejection message rendered.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): sidebar, host connection and clone dialog`.

---

### Task 17: Renderer — Workspace and Review

**Files:**
- Create: `src/renderer/src/components/WorkspaceView.tsx`, `src/renderer/src/components/ReviewView.tsx`
- Test: `tests/renderer/WorkspaceView.test.tsx`, `tests/renderer/ReviewView.test.tsx`

**Interfaces:**
- Consumes: `api.workspaces.*`, `useAppState`.
- WorkspaceView: header `<owner>/<name> @ <host label>:<path>`; buttons **Sync**, **Refresh**, **Open terminal** (Sync/Open terminal/worktrees disabled when host not connected; branches still load from mirror); branch table with ahead/behind and badges `merged` and `history rewritten`; worktree list (connected only) with dirty count and per-worktree Open terminal; **Rebuild mirror** button shown when any call fails with a `GitError` message. Clicking a branch opens ReviewView.
- ReviewView: shows source workspace label (`จาก <host label>:<path>`), commit list, unified diff in a monospace `<pre>` with `+`/`-` line colouring, target branch input defaulting to the branch name, **Push to GitHub** (shows `PushOutcome.message` on failure), **Open PR** (enabled after a successful push or when `origin/<target>` exists).

- [ ] **Step 1: Failing tests** — disconnected host: Sync disabled, branch list still rendered from mocked `branches()`; `rewritten:true` shows `history rewritten`; ReviewView target input defaults to `feat/a`, Push calls `push(wsId,'feat/a','feat/a')`, non-fast-forward outcome message is displayed verbatim.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): workspace and review views`.

---

### Task 18: Renderer — Terminal tabs, Approval modal, Settings

**Files:**
- Create: `src/renderer/src/components/TerminalTabs.tsx`, `src/renderer/src/components/ApprovalModal.tsx`, `src/renderer/src/components/SettingsView.tsx`
- Test: `tests/renderer/ApprovalModal.test.tsx`, `tests/renderer/SettingsView.test.tsx`

**Interfaces:**
- Consumes: `api.terminal.*`, `api.approval.respond`, `api.repos.updatePolicy`, `api.pushLog.read`, events `terminal-data`, `terminal-exit`, `approval-request`.
- TerminalTabs: bottom panel, one xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) per tab; input → `terminal.write`, fit → `terminal.resize`; exited tab shows `[ปิดแล้ว]` and stays until closed.
- ApprovalModal: queue of requests; shows repo label, tab label, each update as `<ref>: <old7> → <new7>` (`(new branch)` when old is zero); buttons exact labels `Allow once`, `Allow for this session`, `Always allow for this repo`, `Deny`, mapping to `'once'|'session'|'always'|'deny'`.
- SettingsView: per repo — `enforceRules` toggle, protected branches (comma-separated input), always-allow state with **Revoke** (sets `alwaysAllowPush:false`); push log table (latest 200).

- [ ] **Step 1: Failing tests** — ApprovalModal renders `refs/heads/feat: a1b2c3d → e4f5a6b`, clicking `Allow for this session` calls `respond(id,'session')` and shows the next queued request; SettingsView Revoke calls `updatePolicy(id,{alwaysAllowPush:false})`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): terminal tabs, approval modal and settings`.

---

### Task 19: Manual end-to-end verification

**Files:**
- Create: `docs/manual-test.md` (checklist with result column)

- [ ] **Step 1:** `npm test` and `npm run typecheck` → all green.
- [ ] **Step 2:** With a real Linux sandbox, run the spec §9 flow: add host → Connect → Clone → in a plain (non-app) ssh session commit `feat-a` → Sync → Review → Push → Open PR → merge on GitHub → Sync → sandbox `origin/main` updated, local `main` untouched.
- [ ] **Step 3:** Open terminal from the app → `git push origin feat-b` → popup appears on the host → Allow once works; Deny gives a failed push; push to `main` blocked. In a plain ssh session `git push` fails (no credential). `grep -r` the sandbox home for the token value → no matches.
- [ ] **Step 4:** Uninstall git on a test host (or use one without it) → Connect shows the install message; install → Reload → connected.
- [ ] **Step 5:** Record results in `docs/manual-test.md`; commit `docs: manual e2e verification results`.
