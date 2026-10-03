# regit-desktop — MVP Design

วันที่: 2026-10-03
สถานะ: Draft (รอ review)

## 1. เป้าหมาย

Desktop app (ใช้เอง) สำหรับจัดการ git ของ repo ที่อยู่ใน **AI sandbox** (Linux) ผ่าน SSH
โดยที่ **sandbox ไม่เคยถือ credential ของ GitHub** และไม่ต้องมี network ออกไป GitHub

### สิ่งที่ผู้ใช้บอก
- ใช้เองคนเดียว, ปลายทางเป็น Linux อย่างเดียว
- Sandbox ต่อ GitHub เองไม่ได้ (ไม่มี credential / อาจไม่มี network)
- ไม่ติดตั้งอะไรเพิ่มบน sandbox (ยกเว้น `git` ที่ผู้ใช้ติดตั้งเอง)
- AI ใน sandbox commit และแตก branch ได้ตามปกติ แต่ push/pull GitHub เองไม่ได้
- Terminal ที่เปิดจากแอปต้อง push/pull ได้ (เช่นรัน Claude Code CLI ในนั้น) แต่ session อื่นต้องทำไม่ได้
- อยากได้ MVP เร็ว → TypeScript
- ต่อได้หลาย sandbox (host) และแต่ละ host จัดการได้หลาย repo
- ไม่ auto-connect — ผู้ใช้กด Connect เองทีละ host
- หลาย sandbox ทำงานบน GitHub repo เดียวกันได้

### หลักการ: ไม่ทิ้งร่องรอยให้คนอื่น (zero footprint)
เครื่องมือนี้ต้องไม่เพิ่มงานหรือเปลี่ยนพฤติกรรมให้งานอื่น หรือคนในทีมที่ใช้ repo เดียวกัน
- ไม่เขียนไฟล์ใดๆ ลง working tree หรือ commit ของ repo (ไม่มี instructions file, ไม่มี config file ใน repo)
- ไม่แก้ไฟล์ config ของ agent หรือของผู้ใช้ใน sandbox; สิ่งที่แอปตั้งใน sandbox มีแค่ `git init`, `remote origin` และ ref ใต้ `refs/remotes/origin/*` + tags ของ workspace ที่แอปสร้างเอง
- ไม่แก้ settings / rulesets / webhooks ของ GitHub repo
- บน GitHub มีแค่สิ่งที่ผู้ใช้สั่ง push เอง (branch ที่ผู้ใช้เลือก) — ไม่มี branch/tag อัตโนมัติ
- สำหรับคนอื่นในทีม commit และ branch ที่ push ผ่านเครื่องมือนี้ต้องดูเหมือน push จาก git ปกติทุกประการ

### คำศัพท์
- **Host** — เครื่อง sandbox หนึ่งเครื่อง (ชื่อตาม `~/.ssh/config`)
- **Workspace** — repo หนึ่งชุดใน sandbox = (Host, path ใน sandbox, GitHub repo)
  host เดียวมีได้หลาย workspace; GitHub repo เดียวมีได้หลาย workspace (ต่างเครื่อง หรือเครื่องเดียวต่าง path)
- **Mirror** — bare repo บน host หนึ่งตัว **ต่อ GitHub repo** ใช้ร่วมกันทุก workspace ของ repo นั้น

### Success criteria
1. Clone repo จาก GitHub ลง sandbox ได้ด้วยการกดไม่กี่ครั้ง
2. AI ทำงานบน branch ใน sandbox → กด Sync → review diff → push ขึ้น GitHub → เปิด PR ได้
3. หลัง merge บน GitHub กด Sync แล้ว sandbox เห็น `origin/main` ล่าสุด
4. Terminal จากแอป push/pull ได้ผ่าน bridge พร้อม popup อนุมัติบนเครื่อง host
5. ไม่มี GitHub token ถูกเขียนลงไฟล์ใดๆ ใน sandbox

### Non-goals (MVP)
- File watcher (ใช้ปุ่ม Refresh)
- หน้าแก้ merge conflict ในแอป (ให้ AI rebase ใน sandbox)
- Commit signing (GPG/SSH)
- สร้าง PR ผ่าน API (เปิด browser ไปหน้า compare แทน)
- ปลายทางที่ไม่ใช่ Linux, การใช้งานหลายคน
- Packaging/installer (รันจาก dev build ก่อน)

## 2. สถาปัตยกรรม

```
GitHub ⇄ [Host: bare mirror + Credential Manager] ⇄ (SSH) ⇄ [Sandbox: working repo + worktrees]
                    ▲
                    └── Git Bridge (HTTP proxy) ◄── ssh -R ── terminal session ที่เปิดจากแอป
```

Stack: **Electron + electron-vite + React + TypeScript**, **xterm.js + node-pty** (terminal), **Vitest** (test)

หลักการสำคัญ: **เรียก `git` และ `ssh` ของระบบโดยตรง** (ไม่ใช้ `ssh2`)
→ ได้ `~/.ssh/config`, ProxyJump, ssh-agent, known_hosts, Git Credential Manager ฟรี

### Components (main process)

| Module | หน้าที่ | ขึ้นกับ |
|---|---|---|
| `HostGit` | รัน `git` บน host (ใน mirror), parse output; **ล็อกต่อ mirror** (คำสั่งที่เขียน mirror ทำทีละคำสั่ง) | system `git` |
| `ConnectionService` | สถานะ host: `disconnected` → `connecting` → `connected` / `error`; Connect = รัน Preflight (§6); Disconnect = ปิด terminal ของ host นั้นทั้งหมด | `SandboxExec` |
| `SandboxExec` | รัน script ผ่าน `ssh <host> bash -s` (ส่ง script ทาง stdin, รวมหลายคำสั่งต่อครั้ง) | system `ssh` |
| `MirrorService` | สร้าง/rebuild mirror, ตั้ง remotes + refspec | `HostGit` |
| `SyncService` | Clone-to-sandbox, Sync, Push to GitHub, ตรวจ history rewritten | `HostGit`, `SandboxExec` |
| `GitHubClient` | list repo, หา default branch, สร้าง compare URL | token จาก `git credential fill` |
| `TerminalService` | เปิด pty ที่รัน `ssh -t -R ...` ไปที่ path ของ repo/worktree | node-pty, `GitBridge` |
| `GitBridge` | HTTP proxy git smart-HTTP → GitHub, ใส่ credential, บังคับกฎ, ขออนุมัติ | `ApprovalService` |
| `ApprovalService` | popup อนุมัติ, เก็บ always-allow, push log | `Store` |
| `Store` | อ่าน/เขียน `%APPDATA%/regit/config.json` และ `push-log.jsonl` | fs |

Renderer คุยกับ main ผ่าน IPC ที่ typed (preload `contextBridge`) เท่านั้น

### หน้าจอ (renderer)
1. **Sidebar** — tree: Host → Workspaces; แต่ละ host มีจุดสถานะ + ปุ่ม **Connect / Disconnect**; ปุ่ม Add host, ปุ่ม Clone ต่อ host
   - เปิดแอป: ทุก host เป็น `disconnected` (ไม่ auto-connect)
   - workspace ของ host ที่ไม่ได้ connect ยังเปิดดู branch/log/diff ที่ Sync ไว้ล่าสุดได้ (อ่านจาก mirror) และ Push to GitHub ได้ แต่ Sync / Open terminal / Clone ถูก disable
2. **Clone** — (ต้อง connect host ก่อน) เลือก repo จาก GitHub (list ผ่าน API, หรือวาง URL), เลือก path ใน sandbox (default `~/repos/<repo>`); ถ้ามี mirror ของ repo นี้อยู่แล้วใช้ตัวเดิม
3. **Workspace** — รายการ branch ของ sandbox พร้อม ahead/behind เทียบ origin, ป้าย `merged`/`history rewritten`, รายการ worktree + จำนวนไฟล์ dirty, ปุ่ม Sync / Refresh / Open terminal
4. **Review** — log + diff ของ `sandbox/<branch>` เทียบ base, ช่องชื่อ branch ปลายทาง (default = ชื่อเดียวกัน), ปุ่ม Push to GitHub, Open PR
5. **Terminal** — แท็บ xterm.js หลายแท็บ
6. **Settings** — always-allow list (Revoke), protected branches ต่อ repo, push log

## 3. Mirror และคำสั่ง git

Mirror: `%APPDATA%/regit/mirrors/<owner>/<repo>.git` (bare) — **เป็น cache เท่านั้น** ลบแล้วสร้างใหม่ได้โดยไม่เสียข้อมูล

| remote | URL | fetch refspec |
|---|---|---|
| `origin` | `https://github.com/<owner>/<repo>.git` | `+refs/heads/*:refs/remotes/origin/*`, `+refs/tags/*:refs/tags/*` |
| `ws-<workspaceId>` (หนึ่งตัวต่อ workspace) | `ssh://<host>/<path>` | `+refs/heads/*:refs/remotes/ws-<workspaceId>/*` |

ในเอกสารนี้ `sandbox` / `sandbox/<branch>` หมายถึง remote ของ workspace ที่กำลังทำงานอยู่ (`ws-<workspaceId>`)

### หลาย workspace บน GitHub repo เดียวกัน
- ref ของแต่ละ workspace แยก namespace กัน → branch ชื่อเดียวกันในสองเครื่อง (`ws-a/feat-a`, `ws-b/feat-a`) ไม่ชนกัน
- Sync ทำทีละ workspace: fetch origin (ร่วมกัน) + fetch/push เฉพาะ workspace นั้น
- ทั้งสองเครื่อง push `feat-a` ขึ้น GitHub → คนที่สองถูก reject non-fast-forward (ไม่มีการเขียนทับ) → จัดการตาม §3
- หน้า Review แสดงชื่อ workspace ต้นทางเสมอ เพื่อไม่ให้สับสนว่า push ของเครื่องไหน
- ลบ workspace → `git remote remove ws-<id>` ใน mirror (ลบ ref ของ workspace นั้นด้วย); ลบ workspace สุดท้ายของ repo → ถามว่าจะลบ mirror ด้วยไหม
- **ไม่ลบอะไรใน sandbox** เมื่อลบ workspace ในแอป

### Clone to sandbox
1. ตรวจ sandbox (ดู §6 Preflight)
2. ตรวจว่า `<path>` ยังไม่มีหรือว่าง ถ้าไม่ว่าง → error
3. สร้าง mirror, `fetch origin`, หา default branch (`git ls-remote --symref origin HEAD`)
4. sandbox: `git init <path>`
5. host: `git push sandbox '+refs/remotes/origin/*:refs/remotes/origin/*' 'refs/tags/*:refs/tags/*'`
6. sandbox: `git remote add origin https://github.com/<owner>/<repo>.git` แล้ว `git checkout -b <default> origin/<default>`

### Sync (ปุ่มเดียว, ทำสองทาง, ปลอดภัยเสมอ)
1. `fetch --prune origin`
2. จด sha เดิมของ `refs/remotes/sandbox/*` → `fetch --prune sandbox` → ref ไหนที่ sha เดิมไม่ใช่ ancestor ของใหม่ (`merge-base --is-ancestor`) → ติดป้าย `history rewritten`
3. `push sandbox '+refs/remotes/origin/*:refs/remotes/origin/*' 'refs/tags/*:refs/tags/*'`

ไม่มีขั้นไหนแตะ `refs/heads/*` หรือ working tree ของ sandbox
→ `main` ของ sandbox ไม่ขยับเอง; AI เริ่มงานใหม่ด้วย `git checkout -b <new> origin/main`

### Push to GitHub (จากหน้า Review)
`git push origin refs/remotes/sandbox/<branch>:refs/heads/<target>` — **ไม่มี `--force` ในทุกกรณี**
- `<target>` default = `<branch>` แก้ได้
- ถูก reject (non-fast-forward) → ข้อความ "GitHub มี commit ใหม่กว่า — กด Sync แล้วให้ AI rebase บน origin/<target>"
- ปุ่มนี้ไม่ผ่าน popup (ผู้ใช้กดเองบน host อยู่แล้ว) แต่ยังเคารพ protected branches และบันทึก push log

### Open PR
เปิด browser: `https://github.com/<owner>/<repo>/compare/<base>...<target>?expand=1`

### ข้อมูลหน้า Workspace/Review
- branch list, ahead/behind, log, diff → คำนวณใน mirror (เร็ว ไม่ต้อง ssh)
- base ของ branch = `origin/<branch>` ถ้ามี ไม่งั้น `origin/<default>`
- ป้าย `merged` = `sandbox/<branch>` เป็น ancestor ของ `origin/<default>`
- worktree + dirty count → ssh ครั้งเดียว: `git worktree list --porcelain` + `git -C <wt> status --porcelain=v2` ต่อ worktree

## 4. Integrated terminal

`TerminalService` spawn ด้วย node-pty:

```
ssh -t -o ExitOnForwardFailure=yes -R 127.0.0.1:<rport>:127.0.0.1:<bridgePort> <host> \
  "cd '<path>' && export GIT_CONFIG_COUNT=1 \
     GIT_CONFIG_KEY_0='url.http://127.0.0.1:<rport>/s/<token>/.insteadOf' \
     GIT_CONFIG_VALUE_0='https://github.com/' && exec \$SHELL -l"
```

- `<rport>` สุ่มในช่วง 20000–60000; ถ้า forward ไม่สำเร็จ (ssh exit) → สุ่มใหม่ สูงสุด 5 ครั้ง
- `<token>` สุ่ม 32 byte ต่อ session, ผูกกับ (workspace, terminal tab)
- ต้อง connect host ก่อนจึงเปิด terminal ได้
- `url.insteadOf` ทำให้ `origin` (https://github.com/...) ถูกเขียนใหม่ไปที่ bridge **เฉพาะใน shell นี้** ไม่แก้ไฟล์ config ใดๆ
- เปิดได้ทั้งที่ root ของ repo และที่ worktree แต่ละอัน
- ปิดแท็บ → kill pty → tunnel ปิด → token ถูก revoke

## 5. Git Bridge

HTTP server บน host ฟังที่ `127.0.0.1:<bridgePort>` (สุ่มตอนเปิดแอป)

### Routing
`/s/<token>/<owner>/<repo>.git/<rest>` → ตรวจ token ว่าถูกต้องและ repo ตรงกับที่ผูกไว้ → proxy ไป `https://github.com/<owner>/<repo>.git/<rest>`
พร้อม header `Authorization: Basic` จาก `git credential fill` (protocol=https, host=github.com)

รองรับเฉพาะ smart HTTP:
- `GET info/refs?service=git-upload-pack`, `POST git-upload-pack` → fetch/pull: **ไม่ถามอนุมัติ**
- `GET info/refs?service=git-receive-pack`, `POST git-receive-pack` → push: ผ่าน approval

token ผิด/repo ไม่ตรง/path อื่น → `403`

### ตรวจ push (`POST git-receive-pack`)
อ่าน pkt-line ส่วน command (`<old> <new> <ref>` จนถึง flush `0000`) ก่อน stream ส่วนที่เหลือ:
- **กฎตายตัว** (มีผลแม้ always allow; ปิดได้ต่อ repo ใน Settings):
  - ห้ามลบ ref (`<new>` = 0…0)
  - ห้าม push เข้า protected branches (default `main`, `master`)
- แล้วจึงเข้า approval

ข้อจำกัดที่ยอมรับ: bridge **ตรวจ force push บน branch ที่ไม่ protected ไม่ได้** (ต้องใช้ข้อมูล ancestry ที่ bridge ไม่มี) — ด่านที่เหลือคือ popup ที่แสดง `old → new` ให้ผู้ใช้ตัดสิน (แอปไม่แนะนำหรือแก้ settings ของ GitHub repo ตามหลัก zero footprint)

### Approval
Popup บนแอป host (ดึงหน้าต่างขึ้นหน้า + Windows notification ถ้าถูกย่อ)
เนื้อหา: repo, ref ที่จะอัปเดต, `old → new` (short sha), terminal tab ต้นทาง

| ตัวเลือก | ผล |
|---|---|
| Allow once | ครั้งนี้ |
| Allow for this session | จนกว่าจะปิดแท็บ terminal นั้น |
| Always allow for this repo | บันทึกใน config, ดู/Revoke ได้ใน Settings |
| Deny | `403` |

- Default = ถามทุกครั้ง
- ไม่ตอบภายใน 60 วินาที = Deny
- Always allow ยังแสดง notification แบบไม่ขัดจังหวะ
- ทุก push (ผ่าน bridge หรือปุ่ม Review) บันทึกลง `push-log.jsonl`: เวลา, repo, ref, old, new, ช่องทาง, ผล

### ขอบเขตความปลอดภัย (บันทึกไว้ให้ชัด)
ถ้า AI รันด้วย Linux user เดียวกับ terminal ของแอป การแยก session เป็น **soft boundary**:
process อื่นของ user เดียวกันอ่าน env (`/proc/<pid>/environ`) และเรียก port ที่ forward ไว้ได้ระหว่างที่ terminal เปิดอยู่
ด่านที่กันได้จริงคือ **popup อนุมัติ + กฎตายตัวบน host** ซึ่ง sandbox แตะไม่ได้
GitHub token ไม่เคยเข้า sandbox ไม่ว่ากรณีใด

## 6. Preflight และ Error handling

Preflight (ตอน Test connection / ก่อน Clone / ปุ่ม Reload) — ssh ครั้งเดียว:
- `command -v git` และ `git --version` → ไม่มี: แสดงคำเตือน + คำสั่งติดตั้งตัวอย่าง (`apt install git` / `dnf install git`) + ปุ่ม **Reload**
- `test -x "$(git --exec-path)/git-remote-http"` → ไม่มี: เตือนว่า terminal push/pull จะใช้ไม่ได้ (ฟีเจอร์อื่นยังใช้ได้)
- ทดสอบ remote forward (เปิด `-R` ชั่วคราว) → ไม่ได้: เตือนว่า sshd ปิด `AllowTcpForwarding`

| สถานการณ์ | การจัดการ |
|---|---|
| SSH ต่อไม่ได้ / host key ไม่รู้จัก | แสดง stderr ของ ssh ตรงๆ แนะนำให้ `ssh <host>` ใน terminal ระบบก่อน |
| Push ถูก reject non-fast-forward | ข้อความตาม §3 |
| History rewritten | ป้ายเตือนบน branch ในหน้า Workspace/Review |
| Mirror เสีย (git error เรื่อง object/ref) | ปุ่ม **Rebuild mirror** (ลบ → สร้าง → Sync) |
| ไม่มี credential ของ GitHub | ให้ผู้ใช้รัน `git credential-manager github login` หรือ `git fetch` สักครั้งในเครื่องเพื่อ login |
| คำสั่ง git ใดๆ ล้มเหลว | แสดงคำสั่ง + stderr ในแผง error ของหน้านั้น |

## 7. การเก็บข้อมูล

`%APPDATA%/regit/config.json`
```json
{
  "hosts": [
    { "id": "h1", "sshHost": "ai-box-1", "label": "AI box 1" },
    { "id": "h2", "sshHost": "ai-box-2", "label": "AI box 2" }
  ],
  "repos": [{
    "id": "r1", "owner": "acme", "name": "api",
    "defaultBranch": "main",
    "protectedBranches": ["main", "master"],
    "alwaysAllowPush": false
  }],
  "workspaces": [
    { "id": "w1", "repoId": "r1", "hostId": "h1", "sandboxPath": "~/repos/api" },
    { "id": "w2", "repoId": "r1", "hostId": "h2", "sandboxPath": "~/work/api" }
  ]
}
```
กฎ push (protected branches, always allow) ผูกกับ **repo** จึงมีผลกับทุก workspace ของ repo นั้น
สถานะ connect ไม่ถูกบันทึก (เปิดแอปใหม่ = disconnected ทั้งหมด)
`%APPDATA%/regit/push-log.jsonl` — append-only
ไม่เก็บ token ใดๆ ในไฟล์ของแอป (ดึงจาก Credential Manager ทุกครั้ง)

## 8. การทดสอบ

- **Unit (Vitest)**: parser ของ git output (porcelain v2, worktree list, ls-remote), pkt-line parser ของ receive-pack, กฎ approval/protected branch, การสร้าง ssh command line
- **Integration (Vitest)**: repo จริงในโฟลเดอร์ชั่วคราว (fake GitHub = bare repo, mirror, sandbox ×2) ใช้ path แทน URL; `SandboxExec` มี implementation แบบ local shell สำหรับ test → ทดสอบ Clone, Sync, Push, history rewritten, non-fast-forward, **สอง workspace บน repo เดียวกันที่มี branch ชื่อซ้ำ**, ลบ workspace
- **ConnectionService**: สถานะเริ่มต้น disconnected, ปุ่มที่ต้อง connect ถูก disable, Disconnect ปิด terminal ของ host
- **Bridge integration**: ชี้ upstream ไปที่ `git http-backend` ในเครื่อง แล้วรัน `git push/fetch` ผ่าน bridge → ตรวจ approve/deny/protected/delete
- **Manual**: flow end-to-end 11 ขั้นกับ sandbox จริง + terminal รัน Claude Code แล้ว push

## 9. Flow ผู้ใช้ (อ้างอิง)

1. เลือก sandbox → 2–4. Clone repo → 5. แอปเขียน repo ลง sandbox
6. AI สร้าง `feat-a` + commit → 7. กด **Sync** → 8. Review `feat-a`
9. **Push to GitHub** → 10. Open PR → 11. Merge บน GitHub → 12. กด **Sync** (sandbox ได้ `origin/main` ใหม่)

ทางเลือก: push/pull จาก terminal ของแอปโดยตรง (ผ่าน bridge + popup)
