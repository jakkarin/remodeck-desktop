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
- Every push (bridge or Review) is logged to `push-log.jsonl`.
- Zero footprint: nothing is written to the repo's working tree or commits; in the sandbox the app only
  does `git init`, sets `remote origin`, and updates `refs/remotes/origin/*` and tags. Removing a
  workspace in the app never deletes anything in the sandbox.
