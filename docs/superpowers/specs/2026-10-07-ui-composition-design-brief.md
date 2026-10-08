# Remodeck — UI organization & reusable composition

วันที่: 2026-10-07 · สถานะ: **ร่างเก่า ยกเลิกข้อเสนอเปลี่ยน layout** · Stack: Electron / React / TypeScript

> ผู้ใช้ชี้แจงให้คง layout เดิมและปรับเฉพาะ visual design กับ alignment ภายในส่วนเดิม ให้ใช้ [UI polish design brief](2026-10-07-ui-polish-design-brief.md) เป็นข้อกำหนดล่าสุด เอกสารด้านล่างเก็บเป็นประวัติร่างเท่านั้น ไม่ใช้ sidebar, shell refactor หรือ approval flow ใหม่ไป implement

## 1. เป้าหมายและขอบเขต

คำขอ: จัด UI ทุกส่วนให้เป็นระเบียบ และออกแบบ React component ที่ประกอบซ้ำได้ ผู้ใช้ยืนยันว่า compose หมายถึง React composition

ทิศทางล่าสุดจากผู้ใช้: **อยากได้แนว Codex** เลือก Codex-inspired Workspace เป็นฐานของร่างนี้: sidebar แบบมีข้อความ, surface เรียบ, ลดกรอบ/เส้นแบ่ง, ใช้ whitespace และ typography จัดกลุ่ม เป็นการตีความสไตล์เพื่อ Remodeck ไม่ใช่การอ้างว่าคัดลอก UI ของ Codex รุ่นปัจจุบันตรงทุกจุด

ผลที่ต้องการ: เมื่อเปลี่ยน module ผู้ใช้ยังเข้าใจ context เดิม; อ่านข้อมูลหลักก่อน metadata; action อยู่ในตำแหน่งคงที่; หน้าจอใหม่ใช้ pattern กลางได้โดยไม่คัดลอก layout, dialog และ state handling

สมมติฐานสำหรับร่าง: desktop สำหรับผู้ใช้ทางเทคนิค เน้นความหนาแน่นพอดีและ review งาน Git/จัดการ container ผ่าน SSH คงสไตล์ neutral, light/dark/system, Lucide และ semantics ของงานเดิม ไม่เพิ่มระบบ commit/staging, container logs/stats หรือ backend API ในงานนี้

หลักฐาน: ตรวจจาก source code และเอกสารเดิม ไม่ได้ตรวจภาพแอปที่รันจริง ขนาดและ breakpoint ด้านล่างเป็นข้อเสนอที่ต้องตรวจใน Electron อีกครั้ง ภาพร่างใช้ข้อมูลตัวอย่าง

เอกสารนี้ต่อยอด `docs/design-guidelines.md` และ spec UX วันที่ 2026-10-05 ไม่แทนกฎ authorization, bridge, protected host/repository หรือ timeout เดิม

## 2. สิ่งที่พบในโค้ด

| จุด                             | หลักฐาน                                                                                                     | ผลต่อการออกแบบ                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| มีพื้นฐาน design system แล้ว    | `assets/tokens.css`, `components/ui/index.tsx`: Button, IconButton, TextInput, Badge, PaneHeader            | ต่อเติม pattern กลาง ไม่สร้างชุดปุ่มหรือ token ใหม่ซ้อนของเดิม                 |
| Shell กับ terminal มีความผูกพัน | `App.tsx` ใช้ portal เพื่อรักษา xterm ให้ mounted; Git ใช้ SplitLayout แต่ Containers ใช้ flex + readLayout | ให้ dock มีเจ้าของเดียวใน shell และต้องรักษา session                           |
| Lists ใช้ interaction ต่างกัน   | BranchPane มี listbox/ลูกศร; CommitList/FileList คลิก li; WorkspaceSwitcher คลิก span                       | ทำ selection/focus contract กลาง และใช้ native button สำหรับ action/navigation |
| Switcher มี logic ซ้ำ           | HostSelector/WorkspaceSwitcher ทำ outside-click, Escape และ nested menu เอง                                 | ใช้ Popover/Menu กลาง แต่คง domain row แยกกัน                                  |
| Container columns ไม่ตรงแน่นอน  | ContainersView ใช้ flex ต่อแถว ไม่ได้แชร์ column grid/header                                                | จัดเป็น table ที่มีหัวคอลัมน์และกลุ่ม Compose                                  |
| Dialog มีหลาย shell             | `.dialog`/`.modal`, header/footer และ Escape แยกทำ                                                          | ใช้ Dialog กลาง; approval และ danger ใช้ domain content แยก                    |
| States กระจายอยู่หลายที่        | GitModule/ContainersModule/EmptyState/ErrorBanner/WorkspaceScreen                                           | แยก full-page gate, pane state และ inline feedback                             |
| Changes รวมหลายงาน              | pane-scroll มี commits + files; PushBar ติดท้าย pane                                                        | แบ่ง header/sections/scroll/footer ให้ชัดและไม่เสียพื้นที่ action              |

## 3. ทางเลือก

| แนวทาง                                   | ข้อดี                                                          | ข้อแลกเปลี่ยน                                                        |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Neutral Workbench — ร่างแรก              | คง workflow 3 pane; ทำ shell/pattern กลาง; migrate ทีละหน้าได้ | ต้องกำหนด contract และย้าย CSS ของ pattern ให้ชัด                    |
| ปรับ CSS อย่างเดียว                      | เห็นผลเร็วและเปลี่ยนโค้ดน้อย                                   | dialog, state และ interaction ยังซ้ำ; หน้าใหม่มีโอกาสไม่สอดคล้อง     |
| **Codex-inspired Workspace — เลือกแล้ว** | host/workspace จำนวนมากเห็นง่าย                                | ใช้พื้นที่ diff เพิ่ม; ต้องมี sidebar collapse และตรวจ narrow layout |

ผู้ใช้เลือกทิศทาง **Codex-inspired Workspace** หลังดูร่างแรก จึงเปลี่ยนจาก icon rail เป็น sidebar มี label และ workspace navigation ซึ่งกินพื้นที่เพิ่ม แต่ยุบได้ คง workflow review Git และ terminal เดิม โดยให้ Diff เป็น surface หลัก ไม่วาง pane ที่มีน้ำหนักเท่ากันทุกช่อง

### ทิศทางภาพที่ใช้แทนข้อเสนอ Neutral เดิม

- Sidebar 208px พื้นต่างจาก canvas เล็กน้อย: ชื่อแอป → Git / Containers → Workspaces เฉพาะ Git → Host context → Settings ไม่ใช้สีสดเป็น navigation
- Header บาง มีชื่อ workspace/module และ action ตาม context; Host picker อยู่ท้าย sidebar ไม่แสดงซ้ำใน header; ใน Containers ซ่อน Workspaces
- Main canvas เรียบ; pane header ไม่ต้องมีพื้นทึบหรือเส้นใต้ทุก section; คงเส้นบางเฉพาะ resize boundary/table/terminal ที่ช่วยใช้งานจริง
- Selected row เป็นพื้นเทาบาง มุม 8px และมี inset ซ้าย/ขวา; count เป็นข้อความรอง ไม่มีกรอบ badge ทุกตัว
- ปุ่ม primary สีดำ/ขาว มุมมน 10px; secondary ใช้พื้นโปร่งและกรอบเฉพาะที่จำเป็น; input พื้น neutral บาง; label/helper ใช้ hierarchy ชัด
- UI 13px, heading 15px medium; content padding 20–24px; แถว 36–40px สำหรับ branch/file และ 48px สำหรับ commit/container ไม่ขยายจน review ไฟล์ได้น้อย
- Dialog ใช้ title เรียบ, body มีช่องไฟ 16px, actions อยู่ขวาล่าง; Settings ใช้ list ของ policy rows แทน card ซ้อน; terminal ไม่มีสีตกแต่งเพิ่ม
- Surface palette เสนอ Light: canvas #ffffff, sidebar #f7f7f5, selected #ececea; Dark: canvas #202020, sidebar #181818, selected #303030 ตัวเลขเหล่านี้เป็น design targets ไม่ใช่ token ของ Codex ที่ตรวจยืนยันแล้ว

## 4. Shell และ visual rules

ลำดับ context: **Host → Module → Workspace (เฉพาะ Git) → Branch → Commit/File** อย่าแสดง Workspace ใน Containers จนทำให้เข้าใจผิดว่า container ถูกกรองตาม repo

```text
┌ Sidebar: Remodeck ┬ Workspace / Module title                  │ Sync ┐
│ Git              │ Branches    │ Changes       │ Diff               │
│ Containers       │             │               │                    │
│ Workspaces [Git] │             │               │                    │
│ owner/repo       ├──────────── shared TerminalDock ──────────────────┤
│ Host · status    │ tabs · new · collapse │ terminal session          │
│ Settings         │                                                 │
└──────────────────┴─────────────────────────────────────────────────┘
```

| Token/ขนาดเสนอ           | ค่า                                                          | กฎ                                                               |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Spacing                  | 4 / 8 / 12 / 16 / 24 / 32px                                  | ใช้ scale เดิม; เพิ่ม 32 เฉพาะ section ใหญ่                      |
| ContextBar / AppSidebar  | 56–64px / 208px (collapsed 56px)                             | title/action อยู่บน; navigation/workspace/host อยู่ซ้าย          |
| Pane header / subsection | 40px / 32px                                                  | ชื่อซ้าย, count ข้างชื่อ, actions ขวา                            |
| Button/input             | 32px; icon button 30–32px                                    | dialog input ใช้ 36px ได้เป็น size variant                       |
| Rows                     | branch/file 36px; commit/container 48px                      | metadata 2 บรรทัดใน row ที่ต้องใช้                               |
| Typography               | UI 13px; secondary 12px; title 15px; code 12px               | ใช้ Segoe UI/system และ Cascadia/Consolas เดิม                   |
| Radius                   | badge 6; control 9; overlay 14px                             | pane ไม่ต้องโค้งหรือมี shadow                                    |
| Color                    | semantic tokens เดิม ปรับ surface ตาม Codex-inspired palette | primary neutral; accent = focus; status = success/warning/danger |
| Border                   | 1px เฉพาะ boundary ที่ใช้งานจริง                             | header/subsection ใช้ whitespace; shadow เฉพาะ overlay           |

Selected กับ focus แยกกัน: selected เป็นพื้น neutral; keyboard focus มี outline ชัด สีสถานะต้องมีข้อความ/ไอคอนหรือ +/− กำกับ ใช้ tooltip เป็นข้อมูลเสริม ไม่เป็นคำอธิบายเดียวของปุ่มที่ disabled

## 5. แบบรายจุด

### 5.1 ContextBar / AppSidebar

- Host trigger ใน sidebar footer: ชื่อ + connection status; protected ใช้ Lock + badge ที่เห็นได้ในทุก module
- Workspace: owner/repo ใน sidebar เป็น navigation หลัก; title/path อยู่ใน header ของพื้นที่ทำงาน; workspace picker ที่มีอยู่ใช้ pattern เดียวกันเมื่อ sidebar ยุบ ไม่แสดง selector ซ้ำ
- แยกปุ่ม `Sync` จากข้อความ `Updated 24s ago`; ระหว่างทำใช้ `Syncing…` และไม่ให้กดซ้ำ error อยู่ใน contextual alert ที่ไม่ดัน picker ออกจากแนว
- Sidebar: Git/Containers เป็น icon + text พร้อม selected row; Workspaces แสดงเฉพาะ Git; Host picker และ Settings อยู่ท้าย nav ชื่อยังเข้าถึงได้เมื่อยุบ

### 5.2 Host picker / Workspace picker / overflow menu

- Popover 360px เปิดใกล้ trigger ใน sidebar หรือ compact header สูงตามเนื้อหาจนถึง max-height; scroll เฉพาะรายการ, footer อยู่คงที่ จำกัดความกว้างให้พอดีหน้าต่าง
- Host row: ชื่อ / SSH alias; status text และ protected badge; Connect/Retry ข้างแถว; Settings/Disconnect/Remove อยู่ใน menu
- Workspace row: owner/repo / sandbox path, check สำหรับรายการ active; footer มี Clone repo / Add existing
- เปลี่ยน clickable span เป็น native button; เมนูไม่ซ้อนปุ่มในปุ่ม; selection กับ overflow action เป็น sibling
- Escape ปิดชั้นบนสุดและคืน focus; outside-click ปิด; keyboard เข้าถึงทุกแถวและ menu; host ที่ลบไม่ได้แสดงเหตุผลว่าให้เอา workspace ออกก่อน

### 5.3 Git: Branches & Worktrees

- Header `Branches` + count; row: branch name, ahead/behind badge และ rewritten/new marker ตามข้อมูลที่มี
- Worktrees เป็น section แยกด้านล่าง: basename / path; Open terminal เป็น action ของแต่ละ worktree
- ถ้าชื่อยาวใช้ ellipsis พร้อมเปิดชื่อเต็มเมื่อ focus; selected row ไม่กระโดดเมื่อข้อมูล refresh
- ยังไม่เลือก branch: pane ข้างเคียงมีคำแนะนำ; loading/error/ไม่มี branches ต้องไม่สับสนกัน
- คง branch selection ผ่านลูกศร; secondary action ไม่เปลี่ยน branch โดยอ้อม

### 5.4 Git: Changes / CommitList / FileList / PushBar

- Header `Changes`; subtitle `feature/ui → main` แยกจากชื่อ pane
- Commits เป็น section มี count; subject บรรทัดแรก, SHA · author · date บรรทัดรอง; มีรายการ `All changes` ชัดเจนแทนต้องเดาว่าคลิก commit ซ้ำจะ reset
- Files แยก section มี count; ชื่อไฟล์เด่น, directory รอง; status A/M/D/R และ +/− อยู่แนวท้ายแถว rename แสดง old → new ตามข้อมูลเดิม
- Commit area มี max-height เพื่อให้ files ยังเห็นได้; แต่ละ list มี scroll ของตัวเองเมื่อจำเป็น ไม่ให้ footer scroll หลุด
- PushBar เป็น footer คงที่: Target branch, Push primary, Open PR secondary, feedback ด้านล่าง input
- คง canOpenPR/pushedTarget logic เดิม เปลี่ยน target ต้องไม่แสดง Pushed ของ target เก่า; disconnect/busy/target ว่าง แสดงเหตุผลของ action ที่ใช้ไม่ได้
- rewritten เป็น warning alert ข้าง branch context ไม่ใช้ badge ยาวเป็น paragraph

### 5.5 Git: Diff

- Header ชื่อไฟล์; path เต็ม/rename อยู่ subtitle; body เป็น code surface เดียว
- คง unified diff ก่อน ไม่เพิ่ม side-by-side editor หรือ syntax engine ในรอบนี้
- เพิ่ม/ลบมี +/− และพื้นตาม token เดิม; hunk header แตกต่างจากบรรทัด code แต่ไม่เด่นกว่าชื่อไฟล์
- Empty: เลือกไฟล์เพื่อดู diff; loading: ใน pane; binary: ระบุว่าแสดง text diff ไม่ได้; no text changes: ระบุชัด; error: retry/rebuild เฉพาะ action ที่ domain รองรับ
- ไฟล์ใหญ่คง limit 5,000 lines และ action แสดงทั้งหมด พร้อมข้อความแจ้ง truncation; ตรวจ performance ก่อนเพิ่ม virtualization

### 5.6 Containers

- Module header `Containers` + host context; toolbar มี Filter และ Show stopped ตาม functionality เดิม พร้อม Live/Paused text
- Table: Name | Image | Ports | Status | Actions ใช้ column sizing เดียวทุก row; name เป็นชื่อหลัก, ID ย่อเป็น metadata เสริมจากข้อมูลที่มี
- Compose project เป็น group header มี count และ collapse; Standalone ใช้รูปแบบเดียวกันแต่ไม่บังคับให้ toggle ถ้าไม่มีประโยชน์
- Running/Stopped/Paused/Restarting มี status text คู่ indicator; unknown status แสดง raw value แบบ neutral
- Start/Stop/Restart เห็นใน action cell; Remove อยู่ overflow menu เพื่อลดการกดผิด ไม่มีการเปลี่ยน danger policy
- Busy เฉพาะ row; error ของ action มีชื่อเป้าหมายและยังรักษารายการที่อ่านได้; stream หลุดคงข้อมูลล่าสุดและ badge ว่าหยุดอัปเดตสด
- แยก no containers / all stopped hidden / no filter match; กรณีสุดท้ายมี Clear filter; all stopped มี Show stopped
- ไม่มีข้อมูล logs, stats, health หรือรายละเอียดที่ backend ยังไม่ส่งในภาพร่าง

### 5.7 Shared TerminalDock

- Header 40px: Terminal, tab strip, New terminal, Collapse; tab มีชื่อ/context และ Close เป็น sibling control
- Dock ใช้ resize/collapse/persistence ชุดเดียวทั้ง Git และ Containers ขนาดเริ่มต้นยังใช้ layout เดิมที่ 260px
- ย้ายเจ้าของ dock ไป shell ได้ แต่ portal/session identity ต้องไม่ remount เมื่อเปลี่ยน module/workspace หรือแสดง disconnected gate
- Switching host แสดง tabs ของ host นั้น; tabs ของ host อื่นยัง mounted; ไม่ใช้ key ของ module/workspace กับ xterm
- No tabs แสดง New terminal พร้อมเหตุผลถ้ายังไม่มี connected workspace; exited tab มี Closed text; busy/connection error อยู่ใน terminal region
- แท็บล้นให้ scroll ใน dock; เมื่อยุบเหลือ header และ tabs ตามเดิม ไม่ลบ session

### 5.8 Settings

- Dialog ขนาดใหญ่: navigation 180px + content; header/Close คงที่; content scroll ในตัว; ไม่ให้หลายพื้นที่ scroll จนใช้งานลำบาก
- General: Default protected branches ใน Field พร้อม helper ว่ามีผลเฉพาะ repo ใหม่
- Appearance: System/Light/Dark เป็น segmented radio; Terminal font size เป็น Select; preview เล็กเป็นภาพประกอบใน design เท่านั้นถ้าทำเพิ่มต้องใช้ prefs เดิม
- Repositories: list/detail; repo title อยู่เหนือ policy rows: Enforce rules / Protected branches / Always allow push + Revoke
- Push log: filter + Refresh, table header sticky; Time/Repo/Channel/Refs/Result/Detail; text ยาว wrap, Result เป็น badge; empty และ load error เป็น state ชัดเจน
- คง autosave/blur/Enter semantics ที่มี แต่เพิ่ม Saving/Saved/Error ใกล้ field; อย่าแสดง Save footer ที่ไม่มีผลจริง
- Host settings ยังคงเข้าจาก host menu; ไม่ย้ายไป settings navigation โดยไม่มีเหตุผลด้าน scope

### 5.9 Form dialogs

ใช้ header/body/footer ร่วมกัน: small 440px, medium 560px, large 960px; max-width ตาม viewport; footer ไม่ scroll; validation ติด field และ server error เป็น alert

| Dialog           | Body / flow                                                                                                                    | Footer                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Add host         | SSH alias + helper จาก ssh config; optional Label                                                                              | Cancel / Add host                            |
| Host settings    | SSH host read-only; Label; Protected host + คำอธิบาย                                                                           | Cancel / Save                                |
| Clone            | แสดง Host ที่เลือกแม้มี host เดียว; Repository URL/owner-name + GitHub repo suggestions เป็น list ที่ scroll ได้; Sandbox path | Cancel / Clone; Cloning… เมื่อ busy          |
| Add existing     | ขั้น Path → Check → review owner/repo/host/path; แสดง unknown repo และ always-allow warning เดิม                               | Cancel / Check; จากนั้น Back / Confirm & Add |
| Remove workspace | owner/repo + host/path; อธิบายว่าเอาออกจากแอป; optional local mirror checkbox เฉพาะ workspace สุดท้าย                          | Cancel / Remove workspace                    |
| Remove host      | ชื่อ/alias และผลของการเอาออกจากแอป                                                                                             | Cancel / Remove host                         |

Clone suggestions ไม่แทน typed repo; คงการไม่ overwrite path ที่ผู้ใช้แก้เอง Add existing ต้องตรวจใหม่เมื่อเปลี่ยน host/path และคง security disclosure ของ fetch/push refs เดิม

### 5.10 Push approval / ConfirmDanger

- Push approval: repo + terminal tab context, ref updates old → new, queued count, เวลาเหลือ; ใช้ metadata ที่ request มีจริง ไม่อนุมาน host ถ้า payload ไม่มี
- Scope ใช้ radio `Once / This session / Always for this repo`; default Once; footer `Deny / Allow push` การเลือก scope อย่างเดียวไม่ส่ง approval
- คง decision values และอายุ 60s จากเวลา request มาถึง ไม่เริ่มนับใหม่ตอน request ขึ้นหัว queue; timeout deny; Escape = deny; outside-click ไม่ปิด; default focus ที่ Deny; request เปลี่ยนต้อง reset scope
- Always แสดงคำอธิบาย persistence และการ revoke ผ่าน Repo settings; ไม่เปลี่ยน fixed rules บน host
- ConfirmDanger: action เป็น title (`Stop container`), host เป็น target block เด่นพร้อม protected badge, container เป็นชื่อรอง; type mode บังคับพิมพ์ host label ตาม policy เดิม ไม่มี blanket confirmation สำหรับ action ที่ policy ให้ทำได้ทันที
- Async error คง dialog เปิดและข้อความที่พิมพ์; busy ป้องกัน double submit; เมื่อ host/target เปลี่ยนยกเลิก pending dialog ตาม behavior เดิม

## 6. Component composition

แยก **primitives → patterns → domain compositions → screens** โดย screen/domain hook เป็นผู้เรียก IPC; UI รับ data/callback และไม่อ่าน AppState โดยตรง

| Layer            | Components                                                                                                           | Contract / reuse                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Primitives เดิม  | Button, IconButton, TextInput, Badge, PaneHeader                                                                     | คง native props/ref; เพิ่ม size/busy เฉพาะที่มีผู้ใช้จริง                                                                   |
| Primitives เพิ่ม | Select, CheckboxField, RadioGroup                                                                                    | Native select/input; label, disabled, invalid, described-by                                                                 |
| Layout           | Stack, Inline, Pane, SectionHeader, ScrollArea                                                                       | ใช้ spacing tokens; Pane มี header/body/footer slots; ไม่เพิ่ม wrapper ถ้า CSS layout เดิมพอ                                |
| Feedback         | StatusBadge, Alert, EmptyState, LoadingState, Field                                                                  | tone + label; Field ผูก label/help/error กับ input ID; Alert รับ actions โดยไม่ตัดสินจาก string                             |
| Overlay          | Dialog, DialogHeader/Body/Footer, Popover, Menu                                                                      | focus trap/return, Escape, layering, labelled-by, dismissal policy                                                          |
| Interaction      | SelectableList, Tabs, GroupHeader                                                                                    | Controlled selection; arrow/Home/End ตาม semantics; tab เป็น focus entry เดียว; ไม่ฝัง interactive action ใน listbox option |
| Shell            | AppShell, ContextBar, AppSidebar, TerminalDock, ResizablePanels                                                      | Layout only; shell/layout controller ถือขนาดและ mounted terminal host                                                       |
| Domain           | HostPicker, WorkspacePicker, BranchRow, CommitRow, FileRow, PushActions, ContainerTable, PolicyField, ApprovalDialog | รับ domain data; action logic อยู่ component/domain hook; reuse pattern แทน universal row                                   |

ไม่ทำ MegaTable/MegaForm ที่ config ทุกอย่าง และไม่ reuse BranchRow เป็น ContainerRow เพราะ semantics ต่างกัน ใช้ ListItem layout helper ได้ แต่ SelectableList คุม selection ของรายการ homogeneous เท่านั้น

ตัวอย่าง API ที่เสนอ (ยังไม่ใช่ code implementation):

```tsx
<Pane header={<PaneHeader actions={actions}>Changes</PaneHeader>}
      footer={<PushActions {...pushState} />}>
  <SectionHeader count={commits.length}>Commits</SectionHeader>
  <CommitList {...commitSelection} />
  <SectionHeader count={files.length}>Files</SectionHeader>
  <FileList {...fileSelection} />
</Pane>

<Dialog open={open} onOpenChange={onOpenChange} size="medium"
        dismissPolicy="escape-and-outside" initialFocusRef={inputRef}>
  <DialogHeader title="Clone repository" description={hostLabel} />
  <DialogBody><Field label="Repository" inputId="clone-repo" error={error}>
    <TextInput id="clone-repo" value={repo} onChange={onRepoChange} />
  </Field></DialogBody>
  <DialogFooter>{actions}</DialogFooter>
</Dialog>
```

Props ข้างต้นเป็นทิศทางสำหรับ review ชื่อจริงต้องตกลงตอน implement; dismiss policy ของ approval เป็น explicit-deny และไม่ใช้ generic open=false เป็นการอนุมัติ

โครงไฟล์เสนอ: `components/ui/{controls,layout,feedback,overlay,selection}/`, `components/shell/`, `components/git/`, `components/containers/`, `components/settings/` barrel เดิม `components/ui` คง import path ได้ระหว่างย้าย ค่อยแยก stylesheet ตาม ownership และให้ tokens.css เป็น source of truth

## 7. States, responsiveness & accessibility

| Region       | State                                      | การแสดง / action                                                         |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| Shell/module | no host / no selected host                 | Add host / Select host ตามสาเหตุจริง                                     |
| Module       | disconnected / connecting / failed         | Host summary + Connect/Connecting…/Retry; คง terminal dock ถ้ามี session |
| Capability   | checking / unavailable / probe error       | LoadingState / คำอธิบาย git หรือ Docker ที่ขาด / ตรวจอีกครั้ง            |
| Workspace    | no workspace                               | Clone primary / Add existing secondary                                   |
| Pane         | nothing selected / loading / empty / error | คำแนะนำเฉพาะ pane; อย่าแสดง empty ระหว่างโหลด                            |
| Action       | idle / pending / success / failure         | busy เฉพาะเป้าหมาย; success ผูก target; error อยู่ใกล้ action            |
| Stream       | current / paused/stale                     | คง last-known data พร้อมข้อความ freshness                                |

Desktop target: 1440×900 และ 1280×800; ตรวจที่ 1024×768 และ OS scale 125%/150% ด้วย Git default columns ใช้ 240/320/rest ตามเดิม diff ควรเหลืออย่างน้อย 360px หากพื้นที่ไม่พอ ให้ยุบ sidebar จาก 208 เป็น 56px ก่อน แล้วใช้ compact picker และ collapsible branches พร้อมรักษา selection ก่อนบีบ text จนอ่านไม่ได้ การเพิ่ม collapsed pane state เป็น layout behavior ที่ต้องตรวจใน implementation ไม่ตั้งเป็น behavior ปัจจุบัน

Containers ที่แคบ: Name+Image เป็น 2 บรรทัด, Status/Actions คงเห็น; Ports ย้ายบรรทัดรอง หรือใช้ table horizontal scroll โดยไม่ทำให้ทั้งแอป scroll แนวนอน Settings navigation เปลี่ยนเป็นแนวนอนเมื่อพื้นที่ไม่พอ Dialog และ log table ไม่ล้น viewport

ทุก interactive row ใช้งานจาก keyboard; overlays focus trap/return และ inert background; separators focusable พร้อม arrow resize และชื่อ; icon-only action มี accessible name; status update ประกาศ aria-live แบบสั้นไม่อ่าน terminal output ทั้งหมด; reduced-motion; ตรวจ contrast บน light/dark และ focus ring บนทุก surface

## 8. ลำดับทำและเกณฑ์ review

1. Foundation: token sizes, Field/Alert/Pane/Dialog/Popover/Menu และตัวอย่างทุก state
2. Shell + shared dock: unify ownership/persistence; ตรวจ session survive ก่อน migrate module
3. Git: panes/lists/push feedback; คง selection/reset และ diff behavior
4. Containers: grouped table/status/action layouts; คง protected host policy
5. Settings + form/approval/danger dialogs; ลบ CSS legacy หลังไม่มีผู้ใช้

เกณฑ์รับแบบ: header/row/form/action alignment เหมือนกันทุกหน้า; action หลักมองเห็นโดยไม่เลื่อน; ชื่อยาวและ error หลายบรรทัดไม่ชน controls; ทุกหน้ามี loading/empty/error ที่ตรงสาเหตุ; theme ทั้งคู่ใช้ tokens เดียวกับ xterm; ไม่มี IPC ใน primitives/patterns

เกณฑ์รับ implementation ภายหลัง: typecheck/lint และ renderer tests ที่มีอยู่; interaction tests สำหรับ focus/selection/dialog dismissal; regression terminal ไม่ remount; approval timeout/queue/scope ไม่เปลี่ยน; screenshot review แต่ละหน้าที่ desktop sizes และ scale ข้างต้น ไม่ต้องเพิ่ม snapshot test ให้ทุก wrapper

สิ่งที่ต้อง review จากร่างนี้: Codex-inspired Workspace และ sidebar navigation, shared dock ownership, row density, approval scope selection และ narrow-window pane collapse งานรอบนี้ส่ง design brief/ภาพร่าง ยังไม่มีการแก้ product code
