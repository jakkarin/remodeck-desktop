# remodeck

**Git & Docker on your servers, over SSH.**

Desktop app (Windows, Electron + TypeScript) for managing git in repos that live in an **AI sandbox**
(Linux, reached over SSH) — while the sandbox **never holds a GitHub credential** and needs no network
access to GitHub.

แอป desktop สำหรับจัดการ git ของ repo ใน AI sandbox (Linux) ผ่าน SSH โดย sandbox ไม่เคยถือ
credential ของ GitHub: Clone / Sync / Review diff / Push / เปิด PR จากเครื่อง host และเปิด terminal
ที่ push/pull ได้ผ่าน Git Bridge พร้อม popup อนุมัติ

## Prerequisites / สิ่งที่ต้องมี

- An SSH alias in `~/.ssh/config` so that `ssh <alias>` works from Windows (key loaded in ssh-agent)
  — ตั้ง alias ใน `~/.ssh/config` ให้ `ssh <alias>` ใช้ได้
- `git` installed on the sandbox (and on Windows) — ติดตั้ง `git` บน sandbox เอง (แอปไม่ติดตั้งอะไรบน sandbox)
- GitHub login on Windows through Git Credential Manager:
  ```
  git credential-manager github login
  ```
- Node.js + npm

## Run / รัน

```bash
npm install
# if Electron's binary is missing / ถ้า electron binary หาย:
node node_modules/electron/install.js

npm run dev      # start the app (dev build)
npm test         # unit + integration tests (Vitest)
```

Manual end-to-end checklist: [docs/manual-test.md](docs/manual-test.md).

UI tokens and reusable component usage: [Neutral design guidelines](docs/design-guidelines.md).

## Security boundary / ขอบเขตความปลอดภัย

- The GitHub token never enters the sandbox. Terminals opened from the app reach GitHub through the
  local **Git Bridge** (`127.0.0.1`, via an ssh remote forward) which injects the credential on the host.
  — GitHub token ไม่เคยเข้า sandbox ไม่ว่ากรณีใด
- Fetch/pull through the bridge needs no approval; every push needs approval in a popup on the host
  (Allow once / for this session / always for this repo / Deny; no answer in 60 s = Deny).
- Fixed rules on the host (apply even with "always allow"; can be turned off per repo in Settings):
  no ref deletion, no pushes to protected branches (default `main`, `master`).
- The bridge cannot detect force pushes on unprotected branches; the popup shows `old → new` so you decide.
- Session isolation is a **soft boundary**: if the AI runs as the same Linux user as the app's terminal,
  other processes of that user can read its environment and use the forwarded port while the terminal
  is open. The real gates are the approval popup and the fixed rules on the host, which the sandbox
  cannot touch.
- Optional, per host and off by default: **Git access on this host** (Host settings) writes your scoped
  tokens in plain text on that host so agents there can use `git` and `gh` directly. Anything running as
  that user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval, but
  bridge rules do not apply to agents pushing directly, so protection relies on each token's scope and
  expiry and on GitHub rulesets. Remove from host deletes every file again. Inside remodeck terminals,
  `gh` resolves the repo from the configured `origin` URL, not from the Git Bridge rewrite of it.
  Only if you tick it at install time, remodeck also puts `~/.local/bin` first in `PATH` from a marked
  block at the top of `~/.bashrc` (never a symlinked one); Remove from host deletes that block too.
  When another credential helper (such as `gh auth setup-git`) is configured, you can tick an option to have
  remodeck's helper asked first; the other helpers stay as fallback for repos without a remodeck token.
  It only changes remodeck's own included file and moves its `include.path` line to the end of your global git config.
  People who log in to the host as the same Linux user share one install. They can read and use each other's tokens,
  Install or Update host from another person's remodeck replaces the tokens there with their own selection, and their
  Remove from host deletes everything. Give each person their own Linux user to keep tokens apart.
  — ค่าเริ่มต้นยังไม่มี token ใน sandbox แต่ถ้า opt-in ต่อ host token จะถูกเก็บเป็น plain text บน host นั้น
  และ process ใดที่รันเป็น user เดียวกันอ่านได้ การป้องกันจริงมาจาก scope/วันหมดอายุของ token และ ruleset ของ GitHub
  ถ้าติ๊กยินยอมตอน install จะเพิ่ม `~/.local/bin` ไว้หน้า `PATH` ที่บนสุดของ `~/.bashrc` และลบออกให้ตอน Remove
  ถ้ามี credential helper อื่นอยู่ (เช่น `gh auth setup-git`) ติ๊กให้ helper ของ remodeck ถูกถามก่อนได้ helper เดิมยังเป็น fallback
  คนที่ login เข้า host ด้วย Linux user เดียวกันจะใช้ชุดติดตั้งเดียวกัน อ่านและใช้ token ของกันได้
  ถ้าอีกคนกด Install หรือ Update host จาก remodeck ของเขา token บน host จะถูกแทนด้วยของเขา และ Remove from host จะลบทั้งหมด
  ถ้าต้องการแยก token ให้แต่ละคนใช้ Linux user ของตัวเอง
- Every push (bridge or Review) is logged to `push-log.jsonl`.
- Zero footprint: nothing is written to the repo's working tree or commits; in the sandbox the app only
  does `git init`, sets `remote origin`, and updates `refs/remotes/origin/*` and tags. Removing a
  workspace in the app never deletes anything in the sandbox.
