# Remodeck design guidelines — Neutral

แนวทางที่เลือก: desktop UI โทน neutral โดยคง layout Branches / Changes / Diff
และ terminal ด้านล่าง รวมถึงการลากปรับขนาดและค่าที่บันทึกไว้เดิม

## Source of truth

- `src/renderer/src/assets/tokens.css`: สี ระยะห่าง มุมโค้ง typography และ motion
- `src/renderer/src/assets/main.css`: สไตล์ component และหน้าจอ
- `src/renderer/src/components/ui/index.tsx`: component กลางสำหรับใช้ซ้ำ
- `src/renderer/src/theme.ts`: mapping token ให้ xterm

ใช้ semantic tokens แทนการใส่สี hex ใน component ธีมตามระบบด้วย `prefers-color-scheme`
และ terminal เปลี่ยนสีตามระบบด้วยโดยไม่ต้องเปิดใหม่ ผู้ใช้เลือกบังคับ light/dark ได้ใน Settings > Appearance
(เก็บใน config ของ remodeck) โดยตั้ง `data-theme` บน `<html>`; ค่า System จะไม่มี attribute นี้

## Surfaces and color

| Token                           | Dark            | Light          | การใช้งาน                             |
| ------------------------------- | --------------- | -------------- | ------------------------------------- |
| `--bg`, `--bg-inset`            | `#181818`       | `#fafafa`      | พื้นหลัก diff และ terminal            |
| `--bg-subtle`                   | `#1e1e1e`       | `#f2f2f2`      | แถบด้านบน หัว pane sidebar และ dialog |
| `--bg-control`                  | `#262626`       | `#ffffff`      | ปุ่ม secondary และพื้นเมนู            |
| `--bg-hover`                    | `#303030`       | `#e8e8e8`      | hover                                 |
| `--selected-bg`                 | `#303030`       | `#e4e4e4`      | รายการที่เลือก ใช้สี neutral          |
| `--fg`                          | `#e4e4e4`       | `#242424`      | ข้อความหลัก                           |
| `--fg-muted`                    | `#a0a0a0`       | `#686868`      | metadata และข้อความรอง                |
| `--border`                      | `#303030`       | `#dedede`      | เส้นแบ่งพื้นผิว                       |
| `--accent`                      | `#8bb8ef`       | `#245fa8`      | keyboard focus และสถานะใหม่           |
| `--primary-bg` / `--primary-fg` | สีอ่อน / สีเข้ม | สีเข้ม / สีขาว | primary action                        |

ใช้สีเขียว/แดงสำหรับสถานะและ diff เพิ่ม/ลบ สีเหลืองสำหรับคำเตือน อย่าใช้สีสถานะ
เป็นพื้นของรายการที่เลือก ปุ่ม Push ใช้ primary neutral; ผลลัพธ์ Pushed ใช้ success
diff มีเครื่องหมาย `+`/`-` และแถบสีริมบรรทัดประกอบกัน จึงไม่สื่อความหมายด้วยสีเพียงอย่างเดียว
terminal selection ใช้ `--terminal-selection` เพื่อให้เห็นการเลือกข้อความชัดเจนกว่าสีเลือกแถว

## Typography, spacing, shape

- UI: `--font-ui` (Segoe UI / system), 13px, line-height 1.5
- Metadata: 11–12px; หัว dialog: 15px / semibold
- Code: `--font-code` (Cascadia Code / Consolas / monospace), 12px; terminal: 13px
- Spacing scale: `--space-1` ถึง `--space-5` = 4, 8, 12, 16, 24px
- มุม badge: `--radius-sm` = 6px; controls/แถว: `--radius-md` = 9px;
  dialog/popover: `--radius-lg` = 14px
- ไอคอนใช้ Lucide 14–16px; ปุ่มไอคอน 30 × 30px
- แถวข้อมูลสูงอย่างน้อย 30–32px; หัว pane สูงอย่างน้อย 40px
- ใช้เส้นขอบ 1px; shadow เฉพาะ dialog และ popover ไม่ใส่ shadow ในแต่ละ pane

## Reusable components

Import จาก `components/ui` โดย component forwarding native props, handlers และ ref ของ React 19
ไปยัง element จริง ไม่ใส่ logic IPC หรือ business state ใน component กลาง

```tsx
import { Button, IconButton, TextInput, Badge, PaneHeader } from './ui'
import { GitBranch, Settings } from 'lucide-react'

<Button variant="primary" disabled={busy} onClick={push}>Push</Button>
<Button onClick={cancel}>Cancel</Button>
<Button variant="ghost" onClick={sync}>Sync</Button>
<Button variant="danger" onClick={remove}>Remove</Button>

<IconButton aria-label="Settings" onClick={openSettings}>
  <Settings size={16} aria-hidden="true" />
</IconButton>

<label htmlFor="target">Target branch</label>
<TextInput id="target" value={target} onChange={e => setTarget(e.target.value)} />

<Badge>merged</Badge>
<Badge tone="warning">rewritten</Badge>
<PaneHeader icon={<GitBranch size={14} />}>Branches</PaneHeader>
```

| Component    | Contract                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `Button`     | variants: secondary (default), primary, ghost, danger; default `type="button"`; ใช้ `type="submit"` เฉพาะ form action |
| `IconButton` | บังคับ `aria-label`; ghost by default; รองรับ disabled และ title                                                      |
| `TextInput`  | native input props, id/label, controlled value และ ref; ใช้ checkbox/radio แบบ native แยกต่างหาก                      |
| `Badge`      | display only; tone: neutral, warning, success, danger                                                                 |
| `PaneHeader` | children เป็นชื่อ pane; optional icon, actions และ title สำหรับชื่อยาว                                                |

หนึ่งกลุ่ม action ควรมี primary action เดียว ใช้ secondary สำหรับ Cancel/Back/Open PR
และ ghost สำหรับ toolbar actions ใช้ danger สำหรับ Remove
`className` ใช้เพิ่ม layout เฉพาะจุด โดยไม่ override สีหรือมุมโค้งของ component

## Interaction and accessibility

- Hover: เปลี่ยนพื้นผิว/เส้นขอบเล็กน้อย; selected: พื้นเทาและข้อความชัด
- Keyboard focus: outline 2px สี `--accent` พร้อม offset 2px; ต้องมองเห็นบนทุกพื้นผิว
- Disabled: ใช้ native `disabled` และ opacity; อย่าเปลี่ยนเป็นข้อความธรรมดาที่คลิกได้
- ทุก icon-only action ต้องมี accessible name; ทุก input ต้องมี label หรือ aria-label
- Checkbox/radio ใช้ความกว้าง native ไม่ยืดเต็มพื้นที่เหมือน text input
- เมื่อตัดชื่อไฟล์ยาวในหัว diff ให้มี `title` แสดงชื่อเต็ม
- Motion สั้น 120ms; ปิด transition และ spinner เมื่อระบบตั้ง reduced motion
- Theme switching ต้องอัปเดต terminal foreground/background/cursor/selection พร้อม UI

## Review checklist

1. ตรวจ dark/light: topbar, branch/file selection, diff, terminal, workspace menu, settings
2. ตรวจ Add existing repo ทั้ง Check และ Confirm รวม disabled, warning และ error
3. ใช้ Tab ดู focus ปุ่ม/ช่องกรอก; ตรวจชื่อปุ่มไอคอนและ label
4. ลากแยก pane และยุบ/ขยาย terminal; เปิดแอปใหม่เพื่อเช็กค่าขนาดเดิม
5. เช็กชื่อ branch/file ยาวและข้อความไทย; scroll แนวนอนของ diff
6. รัน `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`

ใช้ component และ tokens ชุดนี้กับหน้าที่เพิ่มภายหลังเพื่อคง design เดียวกัน

บน Windows หาก `bash` ใน PATH ชี้ไปที่ WSL ให้เลือก Git Bash ใน session ที่รัน tests
เพื่อให้ sandbox fixtures ใช้ path แบบ Windows ได้:

```powershell
$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
npm test
```
