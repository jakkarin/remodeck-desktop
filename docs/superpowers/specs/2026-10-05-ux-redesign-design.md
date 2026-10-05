# regit-desktop — UX/UI Redesign

วันที่: 2026-10-05
สถานะ: Draft (รอ review)
ต่อจาก: `2026-10-03-regit-desktop-mvp-design.md` (หลักการ zero footprint และพฤติกรรม Mirror / Git Bridge ไม่เปลี่ยน)

## 1. เป้าหมาย

### สิ่งที่ผู้ใช้บอก
- หน้าตาตอนนี้ดิบ / รก: ปุ่มเยอะ ไม่มี icon ลำดับความสำคัญไม่ชัด — อยากให้เรียบร้อยแบบ GitHub Desktop
- Flow ใช้ไม่คล่อง: รีวิว → push ต้องสลับหน้า, ไม่รู้ว่า AI ทำอะไรไปแล้ว
- การใช้งานจริงคือ "ทั้งสองอย่างพอๆ กัน": คุยกับ AI ใน terminal และรีวิว branch/diff สลับกันตลอด → อยากเห็น terminal + branch + diff พร้อมกัน ไม่ต้องสลับหน้า

### สิ่งที่ตกลงกันแล้ว
- Layout **A**: 3 คอลัมน์ (Branches · Changes · Diff) + terminal ด้านล่าง, ไม่มี sidebar
- เลือก workspace ด้วย **dropdown เดียวจัดกลุ่มตาม host** บน top bar
- Style **GitHub Desktop** (palette Primer), สว่าง/มืดตามระบบ, icon Lucide
- **Auto sync**: เบา (fetch จาก sandbox) ทุก 30 วินาที + เมื่อ terminal เงียบ 3 วินาที; เต็ม (แบบเดิม) ทุก 5 นาทีหรือกดปุ่ม

### เกณฑ์สำเร็จ
- จาก "AI เพิ่ง commit" ถึง "เห็น diff ของไฟล์นั้น" ไม่ต้องกด Sync เอง และไม่เปลี่ยนหน้า
- จาก "เลือก branch" ถึง "Push + Open PR" ไม่ต้องเลื่อนหาปุ่ม และไม่เปลี่ยนหน้า
- ทุกสถานะ (ไม่มี host, ไม่มี workspace, หลุด, ยังไม่เลือก branch, error) มีหน้าตาที่ตั้งใจ ไม่ใช่จอว่าง

### ไม่อยู่ในขอบเขต
Stage/commit จากแอป, syntax highlight ใน diff, ปุ่มสลับธีมเอง, keyboard shortcut (ยกเว้น ↑/↓ ในรายการ), WSL2

## 2. โครงหน้าจอ

```
┌ Top bar ──────────────────────────────────────────────────────┐
│ ⧉ acme/widget ▾  sandbox-1 · /home/dev/widget   ⟳ Sync · 12s  ⚙ │
├─ Branches ───┬─ Changes ──────────┬─ Diff ────────────────────┤
│ ⑂ feat-a ↑3 ●│ feat-a → main      │ api.ts                    │
│ ⑂ fix   ↑1   │ Commits (3)        │ + export function get()   │
│ ⑂ main       │  a1b2 add api      │ - // TODO                 │
│ ─ Worktrees ─│ Files (2)          │                           │
│ ▣ wt-x  2✎ ＞_│  api.ts    +40     │                           │
│              │ [target: feat-a  ] │                           │
│              │ [↑ Push] [Open PR] │                           │
├──────────────┴────────────────────┴───────────────────────────┤
│ Terminal  [sandbox-1 ×] [wt-x ×] [+]                     ⌄  ═ │
└───────────────────────────────────────────────────────────────┘
```

### Top bar
- **WorkspaceSwitcher**: ปุ่มแสดง `owner/repo` + บรรทัดรอง `host · sandboxPath`. คลิกแล้วเปิดเมนู:
  - กลุ่มต่อ host: จุดสถานะ (เขียว connected / เทา disconnected / แดง error / กระพริบ connecting) + ปุ่มในบรรทัด: `Connect` (disconnected), `Retry` (error), ไม่มีปุ่ม (connected)
  - เมนู ⋯ ของ host: Disconnect, Remove host (disabled พร้อม tooltip ถ้ายังมี workspace — กฎเดิม)
  - ใต้ host: workspace ของ host นั้น (จางถ้า host ไม่ได้ connect แต่ยังเลือกได้), ข้อความ error/warning ของ host แสดงใต้ชื่อ host
  - ท้ายเมนู: `＋ Clone repo…` (เลือก host ใน CloneDialog ถ้ามี connected มากกว่าหนึ่ง), `＋ Add host…`
- ปุ่ม ⋯ ของ workspace (ข้าง switcher): Rebuild mirror, Remove workspace
- **Sync**: icon ⟳ + ข้อความ "Sync · 12s" (เวลาตั้งแต่ sync สำเร็จครั้งล่าสุด ชนิดใดก็ได้). หมุนขณะ sync. ถ้า auto sync ล่าสุดล้มเหลว → icon สีเหลือง, tooltip เป็นข้อความ error. กด = sync เต็มทันที
- ⚙ เปิด **SettingsDialog** (ห่อ `SettingsView` เดิม)

### คอลัมน์ Branches
- รายการ branch จาก `BranchInfo`: icon ⑂, ชื่อ, `↑ahead` (และ `↓behind` ถ้า > 0), badge: ● ใหม่, `merged`, `⚠ rewritten`
- หัวข้อย่อย **Worktrees** (เมื่อ connected และมี worktree): path ย่อ, branch หรือ `detached`, `N✎` ถ้า dirty, ปุ่ม ＞_ เปิด terminal ใน path นั้น
- ↑/↓ เลื่อนการเลือก

### คอลัมน์ Changes
- หัว: `branch → base` (base จาก `BranchInfo.base`)
- **Commits**: sha 7 ตัว + subject + author · date. คลิก commit = กรอง Files/Diff เฉพาะ commit นั้น; คลิกซ้ำ = กลับไปดูทั้ง branch
- **Files**: icon สถานะ A/M/D/R, path, `+N −M`. คลิก = แสดงใน Diff. เปลี่ยน branch/commit → เลือกไฟล์แรกอัตโนมัติ
- **PushBar** (ติดล่างคอลัมน์เสมอ): ช่อง target (ค่าเริ่ม = ชื่อ branch), ปุ่ม `↑ Push` (เขียว), ปุ่ม `Open PR` (เงื่อนไขเปิดใช้เหมือน ReviewView เดิม), ข้อความผลลัพธ์ Pushed / error ใต้ปุ่ม. Banner `history rewritten` อยู่เหนือ Commits ถ้า branch rewritten

### คอลัมน์ Diff
- หัว: path ของไฟล์ (rename แสดง `old → new`)
- เนื้อหา: diff ของไฟล์เดียว, สีแบบ GitHub (เขียว add / แดง del / hunk สีจาง), font monospace
- ไฟล์ binary → ข้อความ "Binary file"; diff เกิน 5,000 บรรทัด → แสดง 5,000 บรรทัดแรก + ปุ่ม "แสดงทั้งหมด"

### Terminal
- `TerminalTabs` เดิม + ปุ่ม ⌄ พับ/กาง และขอบบนลากปรับความสูง
- ปุ่ม `+` = เปิด terminal ใหม่ที่ workspace ที่เลือก
- Approval popup เดิมไม่เปลี่ยน

### SplitLayout
CSS grid + pointer events (ไม่เพิ่ม library): ลากเส้นแบ่งคอลัมน์ 2 เส้นและเส้นแบ่ง terminal ได้, มีขนาดขั้นต่ำต่อช่อง, จำขนาดและสถานะพับใน localStorage (`regit.layout`) — อ่าน/เขียนใน try/catch, พังแล้วใช้ค่าเริ่ม

## 3. Theme

- `main.css` เขียนใหม่เป็น design token บน `:root` (palette GitHub Primer): `--bg`, `--bg-subtle`, `--bg-inset`, `--border`, `--fg`, `--fg-muted`, `--accent`, `--success` (ปุ่ม Push), `--danger`, `--attention`, `--diff-add-bg`, `--diff-add-fg`, `--diff-del-bg`, `--diff-del-fg`, `--selected-bg`, `--selected-fg`
- ค่าสว่างเป็นค่าเริ่ม; `@media (prefers-color-scheme: dark)` ใส่ค่ามืด
- Top bar ใช้พื้นเข้ม (`#24292f` / มืด: `#010409`) ทั้งสองโหมดแบบ GitHub Desktop
- xterm อ่าน token ตอนสร้างและเมื่อ `matchMedia('(prefers-color-scheme: dark)')` เปลี่ยน → อัปเดต `terminal.options.theme`
- Icon: `lucide-react` (dependency ใหม่ตัวเดียว)

## 4. สถานะของหน้าจอ

| สถานะ | สิ่งที่แสดง |
|---|---|
| ไม่มี host | กลางจอ: "เพิ่ม sandbox แรก" + ปุ่ม Add host. Top bar มี switcher แบบว่าง ("ยังไม่มี workspace") |
| มี host แต่ไม่มี workspace | กลางจอ: ปุ่ม Clone repo; ถ้าไม่มี host ไหน connected → ปุ่ม Connect ของ host แรกแทน |
| ไม่ได้เลือก workspace (เช่นหลังลบ) | เลือก workspace แรกที่มีอัตโนมัติ, ถ้าไม่มีเลย → สถานะข้างบน |
| Host ของ workspace ไม่ได้ connect | แถบเหลืองใต้ top bar "sandbox-1 ไม่ได้เชื่อมต่อ" + ปุ่ม Connect. Branches/Changes/Diff ยังอ่านจาก mirror ได้. Sync, Push, ＞_, `+` disabled พร้อม tooltip เหตุผล. Worktrees ซ่อน |
| ยังไม่เลือก branch | Changes/Diff: "เลือก branch ทางซ้าย" |
| Branch ไม่มีการเปลี่ยนแปลงเทียบ base | Changes: "ไม่มี commit ใหม่เทียบกับ base" |
| Error | แถบแดงในคอลัมน์ที่เกิด (ไม่ใช่ทั้งหน้า). Error ของ git ใน mirror (`git ` / `fatal:` แบบเดิม) มีปุ่ม Rebuild mirror ในแถบ |

## 5. ฝั่ง main และ IPC

ทุกอย่างอ่านจาก mirror ในเครื่อง ยกเว้น sync — ไม่มีการเขียนใดๆ ใหม่ลง sandbox

### 5.1 Files และ diff ทีละไฟล์
- ใหม่ `workspaces.files(id, branch, commit?) → FileChange[]`
  - `FileChange = { path: string; oldPath?: string; status: 'A' | 'M' | 'D' | 'R'; additions: number | null; deletions: number | null }` (`null` = binary)
  - ไม่มี `commit`: ช่วงเดียวกับ `getDiff` เดิม (base...ref); มี `commit`: `commit^!` (root commit เทียบ empty tree)
  - ใช้ `git diff --numstat -z -M` + `--name-status -z -M` แล้วรวมผล (ตัว parser เป็น pure function ทดสอบแยก)
  - `commit` ต้องเป็น sha ที่อยู่ในช่วง commit ของ branch นั้น (ตรวจกับ `listCommits`) ไม่งั้น reject — กัน renderer ส่ง ref แปลกเข้า git
- ขยาย `workspaces.diff(id, branch, opts?: { commit?: string; file?: string })`
  - ไม่มี opts → ผลเหมือนเดิมทุกไบต์ (คงพฤติกรรมเดิม)
  - `file` ส่งเป็น pathspec หลัง `--` แบบ literal (`:(literal)path`)

### 5.2 Sync แบบเบา
- ใหม่ `SyncService.fetchSandbox(ws) → { rewritten: string[] }`: ใช้ lock เดิม, `fetch --prune --no-tags ws-<id>` อย่างเดียว, ตรวจ rewritten ด้วย logic เดิม
- แยก "ตรวจ rewritten จาก before/after" ออกเป็น helper ที่ `sync()` และ `fetchSandbox()` ใช้ร่วมกัน; `rewrittenBranches()` อัปเดตจากทั้งสองทาง
- ไม่ fetch origin, ไม่ push อะไรเข้า sandbox

### 5.3 AutoSync (`src/main/sync/autoSync.ts`)
- รับ `setActive(workspaceId | null)` จาก renderer ผ่าน IPC ใหม่ `workspaces.setActive`
- ทำงานเฉพาะ workspace ที่ active และ host `connected`
- ตัวจับเวลา: เบาทุก 30 วินาที, เต็มทุก 5 นาที (นับจาก sync เต็มครั้งล่าสุด รวมที่ผู้ใช้กดเอง)
- `terminal-idle(workspaceId)` → เบาทันที (ถ้าไม่มีรอบกำลังวิ่ง)
- ไม่ซ้อนรอบ: ถ้ามีรอบใดวิ่งอยู่ คำขอเบาใหม่ทิ้ง, คำขอเต็มรอคิวหนึ่งรอบ
- Manual sync จาก IPC `workspaces.sync` วิ่งผ่าน AutoSync เพื่อใช้กฎไม่ซ้อนรอบเดียวกัน
- ส่ง event ใหม่ `workspace-synced(id, { kind: 'light' | 'full', at: number, error?: string })` ทุกรอบ (สำเร็จหรือไม่)
- Error ของ auto sync ไม่โยนขึ้น popup — แสดงที่ปุ่ม Sync เท่านั้น. Error ของ manual sync ยังแสดงแถบแดงตามเดิม
- หยุดตัวจับเวลาเมื่อ setActive(null), host disconnect, หรือแอปปิด

### 5.4 Terminal idle
- `TerminalService` เก็บเวลา output ล่าสุดต่อ tab; หลัง output ครั้งใดเงียบ 3 วินาที → emit `idle(workspaceId)` หนึ่งครั้ง (ต่อช่วงเงียบ)
- `app.ts` ต่อ `idle` เข้า AutoSync

### 5.5 อื่นๆ
- `BranchInfo` มี `sha` อยู่แล้ว — ใช้ทำ ● ได้เลย ไม่ต้องแก้ type
- ลบ IPC เดิมไม่มี; `ReviewView` ถูกแทนที่ (ลบไฟล์และ test ของมัน, เคสที่ยังเกี่ยวย้ายไป test ของ ChangesPane)

## 6. ฝั่ง renderer

| Component | หน้าที่ | แทนที่ |
|---|---|---|
| `TopBar` | switcher + ⋯ workspace + Sync + ⚙ | ส่วนบนของ `WorkspaceView`, footer ของ `Sidebar` |
| `WorkspaceSwitcher` | เมนู host/workspace (ใช้ `AddHostDialog`, `CloneDialog`, `RemoveDialogs` เดิม) | `Sidebar` |
| `BranchPane` | branches + worktrees | ตาราง branch ใน `WorkspaceView` |
| `ChangesPane` | `CommitList`, `FileList`, `PushBar` | `ReviewView` |
| `DiffPane` | diff ไฟล์เดียว | `<pre>` ใน `ReviewView` |
| `SplitLayout` | grid ลากปรับขนาด + จำค่า | `.app` / `.content` |
| `SettingsDialog` | ห่อ `SettingsView` | หน้า settings เต็มจอ |
| `EmptyState` | สถานะในตารางข้อ 4 | — |

State ใหม่ใน `state.tsx`: `selectedBranch`, `selectedCommit`, `selectedFile`, `syncInfo[wsId]` (จาก `workspace-synced`). เปลี่ยน workspace → ล้าง selection; branch ที่เลือกหายไปหลัง sync → ล้าง selection.

**● ของใหม่** (`src/renderer/src/seen.ts`, pure function + localStorage `regit.seen`): `lastSeen[wsId][branch] = sha`. แสดง ● เมื่อ sha ปัจจุบัน ≠ ค่าที่เก็บหรือไม่เคยเห็น; เลือก branch → บันทึก sha. เปิดแอปครั้งแรก (ไม่มีข้อมูลเลยของ workspace นั้น) → บันทึกทุก branch โดยไม่ขึ้น ● เพื่อไม่ให้ทุกอย่างเป็น "ใหม่". localStorage พัง → ไม่มี ● เลย (ไม่ error)

เมื่อได้ `workspace-synced` ของ workspace ที่ active → โหลด branches ใหม่; ถ้า branch ที่เลือกเปลี่ยน sha → โหลด commits/files/diff ใหม่ (คงไฟล์ที่เลือกถ้ายังอยู่)

## 7. การทดสอบ

- **Unit (main)**:
  - parser `numstat` + `name-status` (`-z`): add, modify, delete, rename, binary, path มีช่องว่าง/ภาษาไทย
  - `files` / `diff(file, commit)` บน repo จริงใน temp dir ตามแนว `tests/main/git`; `diff()` ไม่มี opts ได้ผลเท่าเดิม; commit นอกช่วงถูก reject
  - `fetchSandbox`: เห็น commit ใหม่, ตรวจ rewritten, ไม่แตะ `refs/remotes/origin/*` ใน mirror, ไม่ push เข้า sandbox
  - `AutoSync` (fake timers): 30s → เบา, 5m → เต็ม, idle → เบา, ไม่ซ้อนรอบ, เต็มรอคิว, หยุดเมื่อ setActive(null)/disconnect, error ส่ง event ไม่ throw
  - `TerminalService` idle: emit หลังเงียบ 3s ครั้งเดียวต่อช่วง
- **Unit (renderer)**: `seen.ts` (ครั้งแรกไม่ขึ้น ●, sha เปลี่ยนขึ้น ●, เลือกแล้วหาย, storage throw)
- **Component (RTL)**: switcher แสดงสถานะ/ปุ่มถูกตาม host state; คลิก branch → commits+files, คลิกไฟล์ → diff, คลิก commit → กรอง; PushBar disabled เมื่อหลุด; empty states ตามข้อ 4; ย้ายเคสที่ยังเกี่ยวจาก `ReviewView.test.tsx`, `Sidebar.test.tsx`, `WorkspaceView.test.tsx`
- **E2E (Docker)**: AI commit ใน sandbox → `fetchSandbox` เห็น branch ใหม่และ backend GitHub ไม่ได้รับ request; `files` + `diff(file)` ตรงกับ commit ใน sandbox
- **Manual** (`docs/manual-test.md`): ธีมสว่าง/มืดตามระบบ (รวม terminal), ลากปรับ layout แล้วปิดเปิดแอปจำค่า, ● ขึ้นเองหลัง AI commit ใน terminal โดยไม่กด Sync
