# Local host ("This computer")

วันที่: 2026-10-15 · สถานะ: draft รอผู้ใช้ review

## เป้าหมาย

ให้ remodeck จัดการ repo ที่อยู่บน**เครื่อง Windows ที่รันแอปเอง** ได้ โดยไม่ต้องมี SSH และให้แอป**เปิดมาที่ host นี้ทุกครั้ง**

- มี host ในตัวชื่อ **This computer** (`id: 'local'`) อยู่บนสุดของรายการเสมอ ลบไม่ได้
- ฟีเจอร์เดิมทำงานเหมือน SSH host: Clone, Add existing, Sync, Review diff, Push (ผ่าน mirror + approval), เปิด PR,
  terminal (Git Bash) และ Containers (Docker Desktop ถ้ามี)
- ทุกครั้งที่เปิดแอป เลือก host `local` และ connect ให้อัตโนมัติ สลับไป SSH host ได้ระหว่างใช้งาน แต่เปิดครั้งหน้ากลับมา local

**เกณฑ์สำเร็จ:** บนเครื่องที่ติดตั้ง Git for Windows เปิดแอปแล้วอยู่ที่ This computer สถานะ connected ทันที,
Add existing `D:/develop/me/some-repo` ได้, เห็น branch/diff, push ผ่าน Review ได้, เปิด terminal แล้ว `git push` ขึ้น popup approval,
และถ้ามี Docker Desktop ก็เห็น containers ในโมดูล Containers

## การตัดสินใจหลัก

| เรื่อง | ตัดสินใจ | เหตุผล |
| --- | --- | --- |
| แบบจำลอง | host ในตัว `kind: 'local'` แตกแขนงตาม kind ในจุดที่รันคำสั่ง | UI, sync, mirror, approval ใช้ของเดิมทั้งหมด |
| ทางเลือกที่ไม่เอา | รัน sshd บนเครื่อง / โมดูล Local แยก | อย่างแรกผู้ใช้ต้องตั้ง OpenSSH Server เอง อย่างหลังซ้ำซ้อนทั้งชุด |
| รัน script | Git Bash (`bash -s`) ด้วย `HOME` จริงของผู้ใช้ | script preflight/sync/worktree เดิมเป็น POSIX sh อยู่แล้ว ใช้ได้ไม่ต้องแก้ |
| URL ของ workspace | path ตรง ๆ (`D:/x/y`) | mirror fetch/push ไป local path ได้โดยไม่ต้องมี transport |
| terminal | Git Bash `--login -i` ใน node-pty, bridge ผ่าน `127.0.0.1:<bridgePort>` ตรง ๆ | ไม่ต้อง tunnel; push จาก terminal ยังผ่าน approval |
| Docker | `docker system dial-stdio` บนเครื่อง | ใช้ Docker Desktop ด้วย client เดิม |
| Git access on this host | ซ่อนสำหรับ local | เครื่องนี้มี Git Credential Manager อยู่แล้ว |
| host เริ่มต้น | `local` ทุกครั้งที่เปิดแอป | ผู้ใช้เลือก "Always start on Local" |

## นอกขอบเขต

- รองรับ local บน macOS/Linux (แอปเป็น Windows-first; โค้ดไม่ปิดทางไว้ แต่ไม่ทดสอบ)
- terminal แบบ PowerShell/cmd
- เปลี่ยน sshHost ของ host local หรือมี local host มากกว่าหนึ่งตัว

## รายละเอียด

### 1. ข้อมูล (`src/shared/types.ts`, `src/main/store/store.ts`)

- `Host` เพิ่ม `kind?: 'ssh' | 'local'` (ไม่มี = `'ssh'` เพื่อเข้ากับ config เดิม) และ export `LOCAL_HOST_ID = 'local'`
- `Store.load()` ถ้าไม่มี host `id === 'local'` ให้แทรก `{ id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false }`
  ไว้ index 0 แล้ว save; ถ้ามีอยู่แล้วบังคับ `kind: 'local'`, `sshHost: ''` และย้ายไป index 0
- `removeHost('local')` throw `'This computer cannot be removed'`
- `updateHost` แก้ label/protected ได้ตามเดิม
- helper `isLocalHost(h)` ใน shared ใช้ทั้ง main และ renderer

### 2. Target (`src/main/sandbox/target.ts`)

- `LocalTarget` กลายเป็น target จริง: constructor รับ `homeDir` (production = `os.homedir()`) และ `bashPath` ที่ resolve แล้ว
- `resolveBashPath()` ใหม่ (`src/main/proc/bashPath.ts`): ลองตามลำดับ `C:/Program Files/Git/bin/bash.exe`,
  `C:/Program Files (x86)/Git/bin/bash.exe`, ไล่จาก `git.exe` ใน `PATH` (`<git>/../bin/bash.exe`) คืน `null` ถ้าไม่เจอ
  — **ไม่ใช้ `bash` จาก PATH ก่อน** เพราะบน Windows มักเป็น WSL `bash.exe` ซึ่ง path/HOME คนละโลก
- `gitUrl(path)` คงพฤติกรรมเดิม (ขยาย `~` เป็น homeDir, คืน path)
- ใน `app.ts` `targetFor(hostId)` คืน `LocalTarget` เมื่อ host เป็น local; ถ้าไม่เจอ bash, `exec` reject ด้วย
  `'Git for Windows is required: install it from https://git-scm.com'`
- test เดิมที่ `new LocalTarget(home)` ยังใช้ได้ (bashPath เป็น optional, fallback ตามลำดับเดิม)

### 3. Path (`src/main/sandbox/shell.ts`)

- `validateSandboxPath(p, { local })`: host local รับเพิ่ม `X:/...` และ `X:\...` (drive letter + path ที่ไม่ว่าง)
- `normalizeLocalPath(p)`: `\` → `/`, drive letter ตัวใหญ่, ตัด `/` ท้าย; เรียกก่อนบันทึก workspace
- `shPath` ใช้กับ `D:/x` ได้ตามเดิม (Git Bash เข้าใจ) ไม่ต้องแก้
- workspace ซ้ำตรวจด้วย path ที่ normalize แล้ว และไม่สนตัวพิมพ์เล็กใหญ่สำหรับ local
- path จาก `git worktree list` บน Git for Windows เป็น `D:/...` อยู่แล้ว; ถ้าได้ `/d/...` ให้แปลงเป็น `D:/...` ใน `normalizeLocalPath`

### 4. Connection (`src/main/connection/connectionService.ts`)

- deps เพิ่ม `isLocal(hostId)`; local: `checkForward` ไม่ถูกเรียก (ถือว่า bridge ใช้ได้) และ connect ทดสอบด้วย `exec('true')` ผ่าน LocalTarget
  — error จาก bash หาไม่เจอแสดงใน ConnectPanel ตามเดิม
- `probeGit`/`probeDocker` ใช้ script เดิมผ่าน LocalTarget
- renderer เรียก `hosts.connect('local')` อัตโนมัติตอนโหลดครั้งแรก

### 5. Terminal (`src/main/terminal/terminalService.ts`, `localCommand.ts` ใหม่)

- `buildLocalTerminal({ bashPath, bridgePort, token, path })` คืน `{ file, args, env, cwd }`:
  `file = bashPath`, `args = ['--login', '-i']`, `cwd = path` (ขยาย `~`), env = `process.env` + `GIT_CONFIG_COUNT`/`KEY_i`/`VALUE_i`
  ชุดเดียวกับ `buildTerminalSshArgs` แต่ URL เป็น `http://127.0.0.1:<bridgePort>/s/<token>/`
- `PtySpawner` เพิ่ม opts `cwd?`, `env?`
- `open()` สำหรับ local: spawn ครั้งเดียว ไม่มี retry ของ port forward; ส่วน bridge session, approval, idle event เหมือนเดิม
- `openHost()` สำหรับ local: `bash --login -c '<cmd>'`
- `uploadImage` ใช้ target เดิม → ได้ path แบบ `/c/Users/...` ซึ่ง Git Bash ใช้ได้
- label tab: `This computer:<basename>`; `basename` รองรับ `\`

### 6. Docker (`src/main/docker/dialStdio.ts`, `app.ts`)

- `localDialStdio()` = `spawnDuplex('docker', ['system', 'dial-stdio'])`
- `clientFor(hostId)` เลือกตาม kind; ไม่มี docker → probe แสดง error เดิม

### 7. Renderer

- `hostContext.pickHost(hosts, preferred, { startup })`: startup → `'local'` ถ้ามี; ไม่ใช่ startup ใช้ preferred ตามเดิม
  (ใน `state.refresh` ครั้งแรก `loadedRef.current === false` ส่ง startup)
- last workspace ต่อ host ยังจำไว้ (เปิดมาจะเลือก workspace ล่าสุดของ local)
- `HostSelector`: local แสดงไอคอน `Monitor`, คำอธิบาย `This computer · <state>` แทน `ssh <alias>`; ไม่มีเมนู Remove
- `ConnectPanel`: local แสดง "Runs on this computer with Git Bash" แทน `ssh <alias>`
- `HostSettingsDialog`: local ซ่อนช่อง SSH alias และ `HostGitAccessPanel`
- `CloneDialog`/`AddExistingDialog`: placeholder สำหรับ local เป็น `D:/projects/my-app`; Clone ใช้ `~/repos/<name>` เหมือนเดิม
- Onboarding ที่แสดงตอนยังไม่มี host จะไม่โผล่อีก เพราะมี local เสมอ → ปรับ empty state ให้ชวน Add existing / Clone แทน

### 8. README

เพิ่มหัวข้อ "This computer" สองภาษา: ต้องมี Git for Windows, Docker Desktop (ถ้าใช้ Containers),
local ไม่ใช่ sandbox — process บนเครื่องเข้าถึง Git Credential Manager ได้อยู่แล้ว; approval คุมเฉพาะ push ที่ผ่าน terminal ของ remodeck

## Error handling

| สถานการณ์ | ผล |
| --- | --- |
| ไม่มี Git for Windows | connect ล้ม ข้อความชี้ไปที่ git-scm.com |
| path ไม่มี / ไม่ใช่ git repo | ข้อความเดิมของ addExisting/clone |
| ไม่มี docker | Containers แสดง probe error เดิม |
| ลบ host local ผ่าน IPC | throw |

## การทดสอบ

- Unit: Store แทรก/ย้าย/กันลบ local; config เดิมที่ไม่มี `kind` โหลดได้; `validateSandboxPath`/`normalizeLocalPath`;
  `buildLocalTerminal`; `resolveBashPath` ด้วย fs ปลอม; `pickHost` startup; ConnectionService ไม่เรียก checkForward สำหรับ local;
  TerminalService spawn ด้วย bashPath/cwd/env สำหรับ local
- Integration: sync/addExisting test ที่ใช้ LocalTarget กับ repo ใน temp dir แบบ `D:/...` path
- Manual: เพิ่มหัวข้อใน `docs/manual-test.md` (เปิดแอป→local, add existing, review, push, terminal push approval, containers)
