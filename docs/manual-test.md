# Manual End-to-End Test Checklist

วันที่: 2026-10-03  
เวอร์ชัน: Task 19 Manual verification

## Setup

ผู้ใช้ต้องมีสิ่งต่อไปนี้พร้อมก่อนเริ่มทดสอบ:

- **SSH access** : `ssh <alias>` ใช้งานได้จาก Windows terminal โดยมี SSH key ใน ssh-agent
- **Git ติดตั้ง** : บน Windows และ sandbox ทั้งคู่
- **GitHub Credential Manager** : ติดตั้งแล้ว และเข้าสู่ระบบผ่าน `git credential-manager github login` บน Windows
- **Node.js และ npm** : ติดตั้งแล้ว
- **Electron binary** : ถ้าหายไป รัน `npm install && node node_modules/electron/install.js`
- **Development server** : รัน `npm run dev` เพื่อเริ่มแอป

## Test Cases

### 1. Spec §9 Main Flow — Add Host → Connect → Clone → Commit → Sync → Review → Push → PR → Merge → Sync

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 1.1 | เปิดแอป → Sidebar แสดง hosts ว่าง (disconnected) | ☐ |
| 1.2 | กด Add Host → ป้อนชื่อ SSH alias, label, save | ☐ |
| 1.3 | เลือก host → กด Connect → Preflight ตรวจ `git` บน sandbox | ☐ |
| 1.4 | ถ้า git ไม่มี → แสดงข้อความติดตั้ง + ปุ่ม Reload | ☐ |
| 1.5 | Host เข้าสถานะ `connected` | ☐ |
| 1.6 | กด Clone → เลือก repo จาก GitHub (search หรือ paste URL) | ☐ |
| 1.7 | ป้อน sandbox path (default `~/repos/<repo>`) → Clone | ☐ |
| 1.8 | Mirror สร้างและ fetch origin; sandbox init และ checkout default branch | ☐ |
| 1.9 | ใน plain SSH session (`ssh <host>` จาก terminal ระบบ) → `cd ~/repos/<repo>` และ `git checkout -b feat-a` | ☐ |
| 1.10 | สร้างไฟล์ใหม่ + commit (ข้อความ commit อิสระ) | ☐ |
| 1.11 | กด Refresh / Sync → branch `feat-a` ปรากฏใน Workspace view พร้อม ahead count | ☐ |
| 1.12 | คลิกเลือก `feat-a` → Review panel แสดง log + diff | ☐ |
| 1.13 | กด Push to GitHub → push สำเร็จ | ☐ |
| 1.14 | ไปที่ GitHub.com → PR draft จากปุ่ม "Open PR" ของแอป | ☐ |
| 1.15 | เพิ่มข้อมูล PR และ merge (เลือก "Squash and merge" หรือ "Create a merge commit") | ☐ |
| 1.16 | กลับแอป → กด Sync | ☐ |
| 1.17 | `origin/main` ของ sandbox ได้ commit ใหม่จาก PR ที่เพิ่งmerge | ☐ |
| 1.18 | Local main branch ยังอยู่ commit เดิม (ไม่เปลี่ยน) | ☐ |

### 2. Terminal from App — Git Push with Popup Authentication

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 2.1 | Workspace → กด Open Terminal → xterm.js tab เปิด, prompt หลัง `<path>` | ☐ |
| 2.2 | ใน terminal: `git checkout -b feat-b` | ☐ |
| 2.3 | สร้างไฟล์ใหม่ + `git add` + `git commit -m "feat-b"` | ☐ |
| 2.4 | `git push origin feat-b` | ☐ |
| 2.5 | Popup ปรากฏบนเครื่อง host | ☐ |
| 2.6 | Content: repo name, ref (`feat-b`), old→new sha (short), terminal tab ต้นทาง | ☐ |
| 2.7 | ปุ่ม "Allow once" → push ผ่าน, terminal รับข้อความ success | ☐ |
| 2.8 | ปิด popup → ใน plain SSH session (`git push origin feat-b`) ล้มเหลวบ่อกว่าไม่มี credential | ☐ |
| 2.9 | GitHub token ไม่เขียนลงไฟล์ใดๆ ใน sandbox → (ก) ค้นหาค่า token จริงที่ได้จาก `git credential fill` บน Windows โดยส่งผ่าน stdin (token ไม่ลง disk/argv/history ของ sandbox) — ใน Git Bash บน Windows: `printf 'protocol=https\nhost=github.com\n\n' \| git credential fill \| sed -n 's/^password=//p' \| ssh <alias> 'grep -rlF -f - ~/ 2>/dev/null'` ต้องไม่พิมพ์ชื่อไฟล์ใดๆ (ข) ใน sandbox: `grep -rlE "gho_\|ghp_\|github_pat_" ~/ 2>/dev/null` ต้องว่าง | ☐ |

### 3. Protected Branch Blocking

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 3.1 | ใน terminal from app: `git checkout main` (หรือ default branch) | ☐ |
| 3.2 | ทำการเปลี่ยนแปลง + commit | ☐ |
| 3.3 | `git push origin main` → Preflight ของ bridge ปฏิเสธ (403) | ☐ |
| 3.4 | Terminal แสดง error ว่า push ถูกปฏิเสธ (protected branch) | ☐ |
| 3.5 | Plain SSH session: `git push origin main` ล้มเหลวเหตุเดียวกัน (ไม่มี token) | ☐ |

### 4. No-Git Host — Install Message and Reload

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 4.1 | เพิ่ม host ที่ไม่มี git ติดตั้ง (หรือเครื่องสมมติ, หรือแก้ไข PATH ชั่วคราว) | ☐ |
| 4.2 | กด Connect → Preflight บอก "git not found" + แสดงคำสั่งติดตั้ง | ☐ |
| 4.3 | Host button สถานะแดง (error) | ☐ |
| 4.4 | ติดตั้ง git บน sandbox: `apt install git` (หรือ `dnf install git`) | ☐ |
| 4.5 | ในแอป → กด Reload (Preflight อีกครั้ง) | ☐ |
| 4.6 | git detect สำเร็จ → Host เข้าสถานะ connected | ☐ |
| 4.7 | workspace ของ host นั้นสามารถใช้งาน (Clone, Sync) ได้ | ☐ |

### 5. Disconnect Closes Terminals

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 5.1 | Host เข้าสถานะ connected มี terminal 2 tab เปิด | ☐ |
| 5.2 | กด Disconnect | ☐ |
| 5.3 | ทั้ง 2 terminal tab ปิด (หรือแสดง "disconnected" message) | ☐ |
| 5.4 | Host สถานะเป็น disconnected | ☐ |

### 6. Two Workspaces Same Branch Name

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 6.1 | สร้าง workspace ที่ 2 ของ repo เดียวกัน บนเครื่อง host อื่น (หรือ path อื่น) | ☐ |
| 6.2 | Clone เสร็จ; workspace 2 สร้าง branch ชื่อเดียวกับ workspace 1 (`feat-a`) | ☐ |
| 6.3 | Sync ทั้ง 2 workspace → refs ใน mirror แยกกันอย่างถูกต้อง (`ws-<id1>/feat-a`, `ws-<id2>/feat-a`) | ☐ |
| 6.4 | หน้า Review แสดงชื่อ workspace ต้นทาง (เพื่อไม่เสับสนว่า push ของเครื่องไหน) | ☐ |

### 7. Rebuild Mirror

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 7.1 | Settings → ปุ่ม Rebuild Mirror ต่อ repo | ☐ |
| 7.2 | ลบ mirror ตัวเดิมและสร้างใหม่ | ☐ |
| 7.3 | Mirror rebuild สำเร็จ; workspace ยังสามารถ Sync ได้ | ☐ |

### 8. Add Existing Repo

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 8.1 | ใน sandbox มี repo ที่ clone มาเองอยู่แล้ว (origin ชี้ไป GitHub) พร้อม branch ที่ยังไม่ push และไฟล์ที่ยังไม่ commit; จด `git rev-parse HEAD`, `git status --porcelain` และ `cat .git/config` ไว้ | ☐ |
| 8.2 | Host connected → เปิด Switcher → กด "＋ Add existing repo…" → ใส่ path (เช่น `~/work/my-app`) → Check → ต้องเห็น "จะผูก workspace นี้กับ github.com/<owner>/<name>" (ยังไม่มีการ fetch/เพิ่มอะไร) → ตรวจว่าเป็น repo ที่ตั้งใจ แล้วกด Confirm & Add | ☐ |
| 8.2a | Check repo ที่ยังไม่เคยใช้ใน remodeck → เห็นคำเตือน "repo นี้ยังไม่เคยใช้ใน remodeck"; Check repo ที่ตั้ง Always allow push ไว้ → เห็นคำเตือน "repo นี้ตั้ง Always allow push ไว้"; กด Back หรือแก้ path/host → กลับไปขั้น Check | ☐ |
| 8.2b | หลัง Check แล้ว ใน sandbox รัน `git remote set-url origin https://github.com/other/repo.git` → กด Confirm & Add → error "origin ของ repo เปลี่ยนไปจากที่ยืนยัน (ตอนนี้ชี้ไป other/repo) — กรุณาตรวจสอบใหม่" ไม่มี workspace/repo/mirror ถูกเพิ่ม | ☐ |
| 8.3 | Workspace ใหม่ถูกเลือกอัตโนมัติ; branch ที่มีเฉพาะใน sandbox แสดงในรายการ branch และ review ได้ | ☐ |
| 8.4 | ใน sandbox: `git rev-parse HEAD`, `git status --porcelain` และ `.git/config` เหมือนที่จดไว้ทุกไบต์ (ไม่มี checkout, ไม่เปลี่ยน origin) | ☐ |
| 8.5 | เพิ่ม path เดิมซ้ำ → ข้อความ "มี workspace นี้อยู่แล้ว" | ☐ |
| 8.6 | path ที่ไม่มี / ไม่ใช่ git repo / bare repo / subdirectory ของ repo / repo ที่ไม่มี origin / origin ที่ไม่ใช่ GitHub → แสดงข้อความ error ภาษาไทยที่ตรงกรณี และไม่มี workspace เพิ่ม | ☐ |
| 8.7 | origin แบบ `git@github.com:o/r.git` หรือ `ssh://git@github.com/o/r.git` ก็เพิ่มได้ และ `git fetch`/`git push` ใน Open Terminal ของแอปผ่าน bridge (popup อนุมัติ push ปรากฏ) | ☐ |

### 9. Host Context

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| 9.1 | เพิ่ม host ที่ไม่มี git แล้ว Connect → โมดูล Git แสดงข้อความว่าไม่พบ git บน host นั้น (ไม่ error ค้าง) | ☐ |
| 9.2 | เปิด terminal หลายแท็บบน host A แล้วสลับไป host B และกลับมา → terminal ของ host A ยังอยู่และไม่ถูกปิด | ☐ |
| 9.3 | Host settings → ติ๊ก Protected host → Save → เห็นแถบสีแดงบางๆ ด้านบนหน้าต่าง และ badge protected (ไอคอนกุญแจ) ข้างชื่อ host ใน HostSelector (ปุ่มและรายการ); สลับไป host ปกติแล้วแถบหาย | ☐ |
| 9.4 | ปิดแล้วเปิดแอปใหม่ → host และ workspace ที่เลือกไว้ถูกคืนค่า (รวมสถานะ protected) | ☐ |

## Automated Results

### npx vitest run
```
Test Files  26 passed (26)
Tests  168 passed (168)
```

✓ All tests passing

### npm run typecheck
```
✓ Passed - No TypeScript errors
```

### npm run build
```
✓ Passed
Main: 54.33 kB
Preload: 3.00 kB
Renderer: 1,088.53 kB + 13.18 kB CSS
```

---

**วันที่ทดสอบ:** [แจ้งวันที่เมื่อเริ่มทดสอบ]  
**ผลลัพธ์รวม:** [ระบุจำนวนข้อที่ pass / total]  
**ความเห็น:** 


### npm run test:e2e (Docker)

`tests/e2e/sandbox.e2e.test.ts` starts 3 real Linux sandboxes (Debian + sshd + git, `tests/e2e/sandbox/Dockerfile`), drives the API from `createApp` the way the renderer does, and uses a local `git http-backend` in place of GitHub. 19/19 passed, 3 runs in a row.

Covered automatically: cases 1 (except opening the PR on GitHub and merging), 2, 3, 4, 5 and 6 above. It also checks:
- Clone refuses a path that is not empty.
- Tags created by the AI never reach GitHub.
- A history rewrite is flagged.
- Worktrees are listed.
- The GitHub token never enters the sandbox.
- A session not opened by the app has no route to GitHub.

Still manual:
- Windows OpenSSH (`C:/Windows/System32/OpenSSH/ssh.exe`). The test uses Git for Windows' ssh so it can use a throwaway `~/.ssh/config`.
- How the Electron UI renders (xterm, the popup, the buttons).
- Real GitHub (credential manager, opening the PR) and case 7.


### UI redesign (manual)

ตรวจบน Electron จริง หลังเปลี่ยนเป็น workspace แบบสามช่อง:
- สีธีมสว่าง/มืดตาม OS (รวมถึง terminal) — สลับธีม OS แล้วหน้าจอและ terminal เปลี่ยนตาม
- ลากแถบแบ่งช่อง (divider) ปรับขนาด แล้วปิดและเปิดแอปใหม่ ขนาดที่ปรับไว้ยังคงเดิม
- เมื่อ AI commit ใน terminal โดยไม่กดปุ่ม Sync จุด ● ปรากฏที่ branch ภายในไม่กี่วินาที (light sync หลัง terminal นิ่ง 3 วินาที)
- ปุ่ม Sync เปลี่ยนเป็นสีเหลืองเมื่อ host หลุดการเชื่อมต่อ


### Containers (manual)

| ลำดับ | ขั้นตอน | ผล |
|---|---|---|
| C.1 | host ที่ไม่มี docker → แท็บ Containers แสดงข้อความว่าไม่พบ docker | ☐ |
| C.2 | user ที่ไม่อยู่ใน group docker → แสดงข้อความอธิบายสิทธิ์ที่ขาด | ☐ |
| C.3 | start container จาก shell บน sandbox → รายการอัปเดตเองภายในไม่กี่วินาที | ☐ |
| C.4 | Remove บน host ที่เป็น protected → ต้องพิมพ์ชื่อ host ให้ตรงก่อนปุ่ม Remove จะกดได้ | ☐ |
| C.5 | กด Logs ที่ container → แท็บ terminal ใหม่ของ host นั้นเปิดและแสดง log สด; กด Shell ที่ container ที่หยุดอยู่ → ปุ่มกดไม่ได้ | ☐ |
| C.6 | กด Shell ที่ container ที่รันอยู่ → ได้ shell ใน container (ลอง `ls`, `exit`) | ☐ |
| C.7 | compose Up / Pull / Restart บน host ปกติ → รันทันทีใน terminal; Down → มี dialog ให้กดยืนยัน | ☐ |
| C.8 | compose Up / Down บน host ที่เป็น protected → Up ต้องกดยืนยัน, Down ต้องพิมพ์ชื่อ host ให้ตรงก่อน | ☐ |
| C.9 | เมื่อคำสั่งใน terminal จบ → มีบรรทัดแสดง exit code; compose project ที่ไม่มี path → tooltip แสดงข้อความ "ไม่พบ path ของ compose project" | ☐ |
| C.10 | เปิดหน้า Containers → container ที่รันอยู่แสดง CPU / RAM และตัวเลขอัปเดตทุก ~5 วินาที; สลับไปหน้าอื่นแล้ว CPU / RAM หยุดอัปเดต (และกลับมาอัปเดตเมื่อเปิดหน้านี้อีก) | ☐ |
| C.11 | กดชื่อ container → แผงรายละเอียดเปิดด้านขวา (Overview / Env / JSON); กดชื่อเดิมอีกครั้ง หรือกดปุ่มปิด → แผงปิด; เมื่อความกว้างน้อยกว่า 720px แผงย้ายลงใต้รายการ | ☐ |
| C.12 | แท็บ Env → ทุกค่าแสดง `••••••`; กดปุ่มรูปตาของแถวใดแถวหนึ่ง → เฉพาะแถวนั้นแสดงค่า (ไม่มีปุ่มแสดงทั้งหมด); เปลี่ยนไปเลือก container อื่น → ค่าที่เปิดไว้กลับเป็นซ่อน | ☐ |
| C.13 | แท็บ JSON → เห็น inspect ดิบแบบอ่านอย่างเดียว และ `Env` แสดงเป็น `<hidden: N vars>` ไม่มีค่า env จริง | ☐ |
| C.14 | รายการ container ยาวเกินหนึ่งหน้าจอ → เลื่อนลงล่าง แล้วกดชื่อ container → แผงรายละเอียดมองเห็นได้ทันที (ไม่ตกอยู่นอกจอ) ทั้งแบบกว้างและแบบ <720px | ☐ |
