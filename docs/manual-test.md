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

