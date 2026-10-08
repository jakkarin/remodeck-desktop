# Remodeck — Original layout, Codex-inspired UI polish

> **แบบที่เลือกสำหรับ Containers:** ผู้ใช้เลือก [Compose list](2026-10-08-containers-compose-list-design.md) วันที่ 2026-10-08 ให้ใช้ semantic lists ในกล่องแยกตาม Compose project และไม่มี hover fill ข้อตกลงนี้แทนข้อเสนอ table/grid ของ Containers ด้านล่าง ส่วน Git/Push log ยังคงเป็นร่าง

วันที่ร่าง: 2026-10-07 · ปรับล่าสุด: 2026-10-08 · สถานะ: ร่างสำหรับ review · React / Electron

## 1. ขอบเขตที่ผู้ใช้ยืนยัน

**คง layout เดิม ใช้แนว Codex เฉพาะ visual design และจัดระเบียบภายในส่วนที่มีอยู่** เอกสารนี้แทนข้อเสนอ sidebar/navigation และ shell redesign ใน `2026-10-07-ui-composition-design-brief.md`

คง TopBar ที่มี Host / Workspace / Sync, ActivityBar แบบ icon rail, Git ที่เรียง Branches / Changes / Diff, terminal ด้านล่าง, Containers ในพื้นที่ module เดิม และ Settings แบบ dialog เดิม

เปลี่ยนได้: สีพื้น/ข้อความ/เส้นแบ่ง, typography, ขนาดปุ่ม/input, radius, spacing, alignment, ความสูงแถว, การจัด label/helper/error, column grid ของรายการ container และหน้าตา selected/hover/focus/disabled/busy

คง behavior: branch/commit/file selection, คลิก commit ซ้ำเพื่อดูทุก changes, sync, push/Open PR, container actions, approval choices/timeout, confirmation policy, settings autosave และ terminal session/persistence

ไม่ทำในรอบนี้: sidebar ใหม่, ย้าย host/workspace picker, เปลี่ยนจำนวนหรือตำแหน่ง pane, เพิ่ม collapse pane/breakpoint ใหม่, ย้าย terminal ownership, เปลี่ยน scope approval เป็น radio flow, เพิ่ม data/API หรือย้าย actions ไป menu ใหม่

React reuse หมายถึง component สำหรับ controls/patterns ที่ใช้ใน layout เดิม ไม่ใช่รื้อ shell งานรอบนี้เป็น design brief และภาพร่าง ยังไม่แก้ product code

### เป้าหมายล่าสุด: ตารางและการจัดวางข้อมูล

ผู้ใช้ระบุว่าจุดที่ไม่เป็นระเบียบคือ **ตารางและการจัดวางข้อมูล** ดังนั้นให้ตัดสินแบบจากการอ่านและ alignment ก่อนสีหรือความเหมือน Codex ภาพร่างในแชตก่อนหน้านี้ไม่ใช่แบบที่อนุมัติ ส่วนนี้เป็นข้อกำหนดหลักสำหรับร่างถัดไป

หลักฐานจากโค้ดที่ตรวจวันที่ 2026-10-08:

- Containers ใช้ `.container-row { display: flex }` แต่ละแถวเป็นอิสระ; name มีเพียง min-width ขณะที่ image/ports แบ่งพื้นที่ด้วย flex และ status ไม่มีความกว้างร่วม ทำให้แนวข้อมูลต่างกันตามเนื้อหา
- Commits ใช้แถว flex ที่มี SHA, subject และ author/date พร้อมกัน; metadata จำกัด max-width 30% จึงต้องแย่งพื้นที่กับ subject ใน pane แคบ
- Files รวม additions/deletions ใน span เดียวและไม่ได้กำหนดช่องตัวเลขร่วม ทำให้ตัวเลขที่ยาวต่างกันไม่มีแนวเทียบกันชัด
- Push log มี semantic table อยู่แล้ว ต้องปรับ column budget, wrapping และแนวบนของข้อความหลายบรรทัด ไม่จำเป็นต้องเปลี่ยนเป็น list/card

#### กฎการจัดข้อมูลร่วมกัน

1. ชื่อรายการเป็นข้อมูลหลัก; path/image/SHA/author/date เป็นข้อมูลรอง; สถานะและคำสั่งมีช่องเฉพาะ ไม่ไหลตามความยาวชื่อ
2. Header และทุก row ใช้ column definition เดียวกัน ห้ามคำนวณคอลัมน์แยกต่อแถว
3. ข้อความชิดซ้าย, ตัวเลขชิดขวาและใช้ tabular numerals, action ชิดขวาในพื้นที่สงวน
4. แต่ละ cell ใช้ padding แนวนอน 12px; header 36px; row เริ่ม 44–48px และขยายเฉพาะข้อมูลที่กำหนดให้ wrap ไม่บังคับตัดข้อความสำคัญเพื่อให้สูงเท่ากัน
5. ไม่มีข้อมูลใช้ `—`; ค่าจริงที่เป็นศูนย์ใช้ `0`; loading/failed ไม่แสดง `—` แทนค่าที่ไม่ทราบ
6. ชื่อ/path ที่ตัดต้องดูค่าเต็มได้ด้วย hover และ keyboard focus; error/detail ที่ผู้ใช้ต้องอ่านให้ wrap ไม่ตัดทิ้ง
7. ไม่ใส่ badge หรือ icon ให้ metadata ทุกชิ้น ใช้สีรองกับช่องไฟเป็นหลัก; selected row ไม่ทำ font/padding เปลี่ยน

#### Containers: ตาราง 4 คอลัมน์ในพื้นที่เดิม

```text
Container                     Ports             State                Actions
───────────────────────────────────────────────────────────────────────────
remodeck-api                  3000 → 3000        Running              □ ↻ 🗑
node:22                                         Up 2 hours
remodeck-db                   5432 → 5432        Running              □ ↻ 🗑
postgres:16                                     Up 2 hours
```

- Container cell: name บรรทัดแรก, image บรรทัดรอง; ไม่ต้องแยก Image เป็นคอลัมน์ที่แย่งพื้นที่กับชื่อ
- State cell: `state` เป็น label หลัก, `status` เป็นรายละเอียดรอง เช่น Up 2 hours; ไม่เพิ่ม health/uptime ที่ API ไม่ส่ง
- Column budget เสนอ: Container `minmax(200px, 1fr)` / Ports `180px` / State `140px` / Actions `104px`; ใช้เป็นชุดร่วมของ table ไม่ใช่ inline widths ต่อ row
- Name กับ image ตัดได้พร้อม full-value tooltip; Ports wrap รายการภายในช่องเดิม; actions ไม่ wrap
- Compose และ Standalone ใช้ grid เดียวกันทั้ง view; group title spans ทุกคอลัมน์และคง collapse เดิม
- Reserve สามตำแหน่ง action; stopped row มี Start และ Remove โดยเว้นช่อง Restart ไว้เพื่อให้ Remove ไม่กระโดดตำแหน่ง
- Busy อยู่ใน action region เดิม ไม่เพิ่ม spinner column; เมื่อพื้นที่ไม่พอ scroll เฉพาะ table ไม่บีบช่องจนข้อความชน
- ไม่เปลี่ยนตัวกรอง, ordering, grouping หรือ policy ของคำสั่ง

#### Git: ใช้รายการที่จัดแนว ไม่ทำทุก pane เป็นตาราง

| ส่วน     | บรรทัดหลัก                                                      | บรรทัดรอง / ช่องท้าย                                                                            |
| -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Branch   | ชื่อ branch                                                     | ahead/behind อยู่ช่องท้ายเดียวกัน; merged/rewritten ใช้ metadata line เมื่อมี เพื่อไม่เบียดชื่อ |
| Worktree | basename                                                        | branch/path เป็น metadata; dirty count และ terminal action อยู่ช่องท้าย                         |
| Commit   | subject                                                         | SHA · author · date บรรทัดรอง; ไม่แยก 4 คอลัมน์ใน pane 320px                                    |
| File     | status 24px / filename ยืดได้ / additions 44px / deletions 44px | directory อยู่ใต้ filename; เลข +/− ชิดขวาในช่องของตัวเอง                                       |

คง branch/commit/file selection เดิม สำหรับ binary file ใช้ `—` ใน additions/deletions พร้อมคำอธิบายว่าไม่ใช่ text diff ส่วน rename ต้องดู old → new path ได้ ไม่เพิ่มข้อมูลสมมติ

#### Push log: คงตาราง 6 คอลัมน์

- Time 144px: วันที่และเวลาแยกสองบรรทัดแทน locale string ยาว; full timestamp ดูได้โดย focus/hover
- Repo min 160px: owner/name ดูค่าเต็มได้; Channel 80px; Result 88px; Refs min 180px; Detail ใช้พื้นที่ที่เหลือและ wrap
- Refs กับ Detail เป็นข้อมูลหลายบรรทัดจึงจัด cell ชิดบน; Result badge ไม่ยืดตามข้อความช่องข้างเคียง
- คง Time / Repo / Channel / Refs / Result / Detail และ filter/refresh เดิม; หากพื้นที่ไม่พอมี horizontal scroll ภายใน table region ไม่มีการซ่อนคอลัมน์อัตโนมัติ

#### ส่วนอื่นที่ต้องจัดระเบียบ

- Settings/form: label → control → helper/error เป็นแนวตั้งเดียวกัน; field group ห่าง 16px; ไม่กระจาย label/input หลายแนวใน section เดียว
- Picker: name และ path เป็นกลุ่มข้อความเดียวกัน; status/action มีช่องท้ายแยกจากชื่อ
- Header: title/count กลุ่มซ้าย, controls กลุ่มขวา; alert อยู่ใน region ของข้อมูลที่เกิดปัญหา
- PushBar/dialog footer: action group เรียงคงที่ ปุ่มสูงเท่ากัน ข้อความ error ไม่แทรกกลางกลุ่มปุ่ม

Reuse ที่จำเป็น: `TableFrame`/cell styles สำหรับ semantic tables, `ItemContent` สำหรับ primary/secondary text, `RowActions` สำหรับพื้นที่ action และ `Field` สำหรับ form alignment แต่ domain component เป็นผู้กำหนด columns/semantics ไม่สร้าง universal table ที่มี behavior ใหม่

เกณฑ์ review รอบถัดไป: ดูข้อมูลชื่อยาว/สั้นสลับกัน, ports หลายตัว, status ยาว, binary/rename, commit subject ยาว และ log error หลายบรรทัด ต้องยังเทียบแถวได้โดยไม่ไล่สายตาหาคอลัมน์ ไม่ใช้ความเหมือน Codex เป็นเกณฑ์แทนความอ่านง่าย

## 2. แนวภาพ

Codex-inspired ในที่นี้หมายถึงพื้นเรียบ, สี neutral, ปุ่มขาวดำมุมมน, เส้นแบ่งบาง, selected row นุ่ม และข้อความรองไม่แข่งกับข้อมูลหลัก เป็นการตีความสไตล์ ไม่ใช่การรับรอง token ของ Codex รุ่นปัจจุบัน

ใช้ semantic tokens และ light/dark/system ของโปรเจกต์เดิม ค่อยปรับค่าที่ source of truth `src/renderer/src/assets/tokens.css` ไม่ใส่สี hex ในแต่ละ component

| รายการ            | ข้อเสนอ                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| สีพื้น            | canvas เรียบ; toolbar/header ต่างจาก canvas เล็กน้อย; ไม่สร้าง card ซ้อนใน pane |
| Primary           | neutral contrast สูง; มี primary เดียวต่อ action group                          |
| Secondary / ghost | secondary มีกรอบบาง; toolbar action ใช้ ghost                                   |
| Danger            | แดงเฉพาะ action อันตรายและ error; ไม่ทำทุกปุ่มเป็นสีสด                          |
| Button / input    | สูง 32px; dialog field 36px; icon button 30–32px; align ในแถวเดียวกัน           |
| Radius            | control 9–10px; selected row 8px; overlay 14px; badge 5–6px                     |
| Typography        | UI 13px; metadata 12px; title 15px medium; code 12px; font เดิม                 |
| Spacing           | 4 / 8 / 12 / 16 / 24px; กำหนด padding ตาม pattern ไม่ปรับเองทุกจุด              |
| Header / rows     | pane header 40px; branch/file 36px; commit/container 44–48px ตาม content        |
| Border            | 1px สำหรับ pane/resize boundary/table; subsection ใช้ช่องไฟแทนเส้นซ้อน          |

ขนาด shell และค่า split ที่บันทึกอยู่คงเดิม ขนาด visual ข้างต้นไม่ใช้ overwrite layout preferences

## 3. ปรับรายจุด

### TopBar และ ActivityBar

- คงตำแหน่ง Host / Workspace / Sync; ปรับความสูงปุ่มและระยะ icon–label ให้เท่ากัน
- ชื่อยาว ellipsis โดยไม่ดัน Sync/error; ข้อมูลเต็มดูผ่าน tooltip ที่เข้าถึงด้วย focus ได้
- status dot/protected badge จัดกลางแนวเดียวกับ label; Sync ใช้ label/elapsed behavior เดิม
- คง icon rail และ Settings ด้านล่าง; selected ใช้ neutral surface, hover/focus แยกกันชัด
- ข้อความ error ใช้พื้นที่ที่มีอยู่และ wrap อย่างเป็นระเบียบ ไม่เพิ่ม toolbar แถวใหม่

### Host / Workspace popover และ menus

- คง trigger และ menu tree; popover padding 8px, row gap 8px, footer แยกด้วยเส้นบาง
- Host row: name เด่น, SSH alias รองถ้าแสดง; status/actions ใช้ alignment เดียวกัน
- Workspace row: owner/repo กับ path อ่านแยกกัน, overflow icon ไม่ถูกเบียดจากชื่อยาว
- Add/Clone/Remove actions อยู่ตำแหน่งเดิม; busy/disabled มีหน้าตาสอดคล้อง controls กลาง
- Accessible buttons และ overlay focus behavior เป็นคุณภาพของ component โดยไม่เปลี่ยน action flow

### Branches และ Worktrees

- คงลำดับ section; branch name ยืดได้, ahead/behind และ marker อยู่ท้ายแถวแนวเดียวกัน
- selected row มี inset 4px และ radius 8px; padding คงที่เพื่อไม่กระโดดระหว่าง selected/hover
- worktree label/path อ่านแยกกัน; terminal icon มี hit area เท่าปุ่มไอคอนอื่น
- ไม่เพิ่ม search/group/collapse หรือเปลี่ยน selection semantics

### Changes, Commits และ Files

- คง Commits → Files → PushBar; ปรับ section heading/count ให้อยู่แนวเดียวกัน
- Commit subject เป็นหลัก, SHA/author/date เป็น metadata; clamp/truncate อย่างชัดเจน
- File status ใช้ความกว้างคงที่; path ยืดได้; +/− ชิดท้ายและใช้ตัวเลขแนวเดียวกัน
- คงการเลือก commit และคลิกซ้ำเพื่อดูทุก changes; ไม่เพิ่ม All changes row ในรอบนี้
- คง scroll container เดิม; ปรับ flex/min-width/overflow เฉพาะที่แก้การชนและไม่ให้ PushBar ถูกเนื้อหาเบียด
- rewritten/error เปลี่ยนเป็น alert visual ที่อ่านง่ายในตำแหน่งเดิม ไม่ย้าย workflow

### PushBar

- Target label/input มีช่องไฟ 6–8px; Push/Open PR สูงเท่ากันและวาง baseline เดียวกัน
- Push เป็น primary, Open PR secondary; success/error อยู่ในกลุ่มเดียวกัน ไม่ทำ layout เปลี่ยนกะทันหัน
- คง target, pushedTarget, canOpenPR และ disabled rules; ไม่เพิ่ม confirmation หรือเปลี่ยน action sequence

### Diff

- คง unified diff และตำแหน่ง pane; header path จัดให้ไม่ล้น, code padding สม่ำเสมอ
- สี add/delete นุ่มและยังอ่านชัด; มีเครื่องหมาย +/− เดิม; hunk ใช้ neutral surface
- Binary/empty/error/truncated message ใช้ typography และ inset เดียวกัน
- คง limit 5,000 lines และ Show all; ไม่เพิ่ม editor/view mode/virtualization ในรอบนี้

### Containers

- คง Filter / Show stopped / live indicator และ grouping Compose / Standalone
- เปลี่ยน flex rows ที่ column ไม่ตรงกันเป็น shared column grid/table ใน region เดิม: Container (name/image) | Ports | State (state/status) | Actions ตามข้อกำหนดล่าสุดด้านบน
- หัวคอลัมน์/แถวใช้ padding ชุดเดียวกัน; Name เด่น, Image/Ports รอง; long content ไม่ดัน action cell
- คง Start/Stop/Restart/Remove ที่ท้ายแถว ปุ่มทุกตัว hit area เท่ากัน; Remove ใช้ danger visual โดยไม่ย้ายเข้า overflow
- group header ใช้ weight/ช่องไฟแทนพื้น card; count เป็น metadata, state indicator มีข้อความ
- คง filter, collapse, stream และ danger policy; ไม่เพิ่ม logs/stats/detail screen

### Terminal

- คง owner, portal, mounted session, bottom slot, resize/collapse และ tab behavior ทั้งหมด
- ปรับ tab height/padding, active tab, Close/New/Collapse alignment ให้เป็นชุดเดียวกับ controls
- ห้าม key/remount terminal จากการเปลี่ยน styling; ขนาดที่ผู้ใช้บันทึกไว้คงเดิม
- สี xterm ยังคงมาจาก semantic tokens; ไม่เปลี่ยน terminal font preference ของผู้ใช้

### Settings

- คง dialog/navigation/list-detail และ General / Appearance / Repositories / Push log
- Field label/control/helper/error จัดแนวเดียวกัน; policy rows มีช่องไฟเท่ากัน
- Radio/select/checkbox ใช้หน้าตาชุดเดียวกับ form dialogs; คง autosave/blur/Enter
- Push log ปรับหัวตาราง, column widths, cell padding และ wrap Detail/Refs; Result badge ขนาดเดียวกับ status อื่น
- คง Revoke และ Host settings entry เดิม; ไม่เพิ่ม footer Save ที่ไม่มี behavior จริง

### Form dialogs, approval และ confirmation

- Add host, Host settings, Clone, Add existing, Remove host/workspace ใช้ header/body/footer visual เดียวกัน
- คง fields และขั้นตอนเดิม; ปรับ label/input/error spacing, title hierarchy และ footer button alignment
- Clone suggestions อยู่ใน list เดิม; Add existing คง Check → review → Confirm และคำเตือนเดิม
- Push approval คง **4 actions**: Allow once / Allow for this session / Always allow for this repo / Deny; ปรับการ wrap และ hierarchy ให้เป็นระเบียบ ไม่แปลงเป็น radio + submit
- คง approval queue และ timeout 60s; งาน visual ไม่แก้ authorization policy
- ConfirmDanger คง type/click mode และ target check; host/action summary อ่านชัด, danger button เด่นพอดี
- Remove workspace คง mirror checkbox เฉพาะกรณีเดิม; ไม่เพิ่ม scope การลบ

### Empty, loading, warning และ errors

- ใช้ title/body/actions spacing เดียวกันตามขนาด region; pane empty เล็กกว่า full-screen empty
- Error ใกล้ field/action ที่เป็นต้นเหตุ; warning/error ไม่ใช้ badge ยาวแทน paragraph
- คง action ที่รองรับอยู่ ไม่เพิ่ม retry/clear-filter หรือเปลี่ยน state transition ในรอบ styling

## 4. Components สำหรับ reuse

| Component / pattern                   | หน้าที่                                | ขอบเขต                                                             |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Button / IconButton                   | size, variant, icon gap, busy/disabled | ต่อของเดิม ไม่สร้างปุ่มคนละชุด                                     |
| TextInput / Select                    | control height, border, focus/invalid  | Native props/ref; ใช้กับ form/settings                             |
| Field / CheckboxField                 | label/helper/error alignment           | ผูก id/aria-describedby; ไม่ถือ business state                     |
| Badge / StatusBadge                   | label/tone/density                     | ใช้ color พร้อมข้อความ; ไม่ตัดสิน domain status                    |
| PaneHeader / SectionHeader            | title/count/action alignment           | ใช้ใน pane เดิม ไม่ย้าย pane                                       |
| Alert / EmptyState visual             | layout ของ feedback                    | รับ message/actions; ไม่เรียก IPC                                  |
| DialogFrame / PopoverFrame / MenuItem | padding, title/footer, focus style     | คง callers, action flow และ dismissal policy ที่ตกลงเดิม           |
| Row layout / Table cells              | columns, metadata, trailing actions    | แยก BranchRow/FileRow/ContainerRow ตาม domain; ไม่ทำ universal row |

Screens/domain hooks ยังคุม data/IPC; reuse ผ่าน props และ slots แทนการย้าย AppState เข้า UI components ไม่สร้าง AppSidebar/AppShell ใหม่ และไม่ย้าย TerminalDock ownership เพื่อให้ reuse

โครงสร้างเริ่มที่ `components/ui` เดิม; แยกไฟล์เมื่อ component มีผู้ใช้จริงหลายจุด ไม่ reorganize folder ทั้ง repo ในงาน visual polish

## 5. ลำดับและการตรวจรับ

1. ปรับ tokens/controls/Field/feedback ให้เห็นหน้าตาชุดเดียวกัน
2. TopBar, rail, menus และ dialogs โดยคงตำแหน่งเดิม
3. Git rows/header/PushBar/diff; ตรวจ layout และ selection เดิม
4. Containers column alignment และ Settings tables/forms
5. ตรวจทุก state/light/dark/long text และลบ override ที่ซ้ำหลัง migrate

เกณฑ์รับ: layout ก่อน/หลังมี region และลำดับเดิม; resize/preferences/session ไม่เปลี่ยน; ปุ่มสูงเท่ากันในแต่ละกลุ่ม; column/label/footer ไม่ชนกัน; focus/selected/error อ่านชัด; ไม่มีการเปลี่ยน IPC/action semantics เพื่อแต่ง UI

ตรวจ Electron ที่ 1440×900, 1280×800, 1024×768 และ OS scaling 125%/150%; คง responsive behavior เดิมของแอป ไม่เสนอ sidebar/pane collapse ใหม่ ภาพร่างในแชตอาจ stack เมื่อ viewport เล็กเพื่อให้อ่านได้ เป็น presentation ของภาพร่างเท่านั้น

เมื่อ implement: typecheck/lint และ renderer tests เดิม; เพิ่มเฉพาะ interaction regression ที่จำเป็นสำหรับ component ที่ย้ายมาใช้ร่วมกัน; ตรวจ screenshot ด้วยตาสำหรับ alignment/overflow และ terminal ไม่ remount

หลักฐานของร่าง: สำรวจ source และเอกสารเดิม; ใช้ข้อมูลตัวอย่างในภาพร่าง ยังไม่ได้ visual QA ใน Electron จริง
