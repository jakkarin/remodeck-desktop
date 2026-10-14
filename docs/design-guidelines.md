# Remodeck design guidelines — Neutral

แนวทางที่เลือก: desktop UI โทน neutral บน shadcn/ui และ Tailwind v4 โดยคง layout เดิม
(rail ด้านซ้าย, pane Branches / Changes / Diff และ terminal ด้านล่าง) รวมถึงการลากปรับขนาดและค่าที่บันทึกไว้เดิม
หน้าจอทั้งหมดใช้ component และ token ชุดเดียวกันแล้ว

## Source of truth

- `src/renderer/src/assets/tokens.css`: ค่า token ดิบของ light/dark (สี ระยะห่าง มุมโค้ง ฟอนต์ และ duration)
- `src/renderer/src/assets/main.css`: `@theme inline` ผูก token เข้ากับ Tailwind utility (`bg-ground`, `bg-selected`, `rounded-md` ฯลฯ)
  และกำหนด reduced motion ระดับ global
- `src/renderer/src/components/ui/*.tsx`: component ของ shadcn ที่ใช้ในโปรเจกต์ (แก้ไขได้ตามต้องการ)
- `src/renderer/src/assets/legacy.css`: เหลือเฉพาะ base style ของ element ดิบ (button/input ที่ยังไม่มี `data-slot`), diff, error และ spinner
- `src/renderer/src/motion.ts`: ค่า duration และ spring ของ animation ทั้งหมดในหน้าจอ
- `src/renderer/src/theme.ts`: mapping token ให้ xterm

ใช้ semantic tokens แทนการใส่สี hex ใน component ธีมตามระบบด้วย `prefers-color-scheme`
และ terminal เปลี่ยนสีตามระบบด้วยโดยไม่ต้องเปิดใหม่ ผู้ใช้เลือกบังคับ light/dark ได้ใน Settings > General
(เก็บใน config ของ remodeck) โดยตั้ง `data-theme` บน `<html>`; ค่า System จะไม่มี attribute นี้

## Surfaces and color

ค่าด้านล่างอ้างอิงจาก `tokens.css` (ค่าเดียวกับ light/dark ที่ประกาศไว้ใน `:root` และ `:root[data-theme='dark']`)

| Token                             | Dark                                 | Light                 | การใช้งาน                               |
| --------------------------------- | ------------------------------------ | --------------------- | --------------------------------------- |
| `--ground`                        | `#111113`                            | `#f4f4f5`             | พื้นหลังรอบ card (ช่องว่างระหว่าง pane) |
| `--bg`                            | `#1c1c1f`                            | `#ffffff`             | surface ของ pane, dialog และ popover    |
| `--bg-inset`                      | `#18181b`                            | `#fafafa`             | พื้น diff และ terminal                  |
| `--bg-subtle`                     | `#222226`                            | `#fafafa`             | หัว pane, แถบด้านบน                     |
| `--bg-control`                    | `#1c1c1f`                            | `#ffffff`             | พื้นของ control และเมนู                 |
| `--bg-hover`                      | `#2a2a2e`                            | `#f4f4f5`             | hover และ tab ที่ยังไม่ถูกเลือก         |
| `--selected-bg` / `--selected-fg` | `rgb(138 180 248 / 14%)` / `#f0f0f0` | `#e8eef7` / `#18181b` | รายการที่เลือก (selection pill)         |
| `--fg`                            | `#ececee`                            | `#18181b`             | ข้อความหลัก                             |
| `--fg-muted`                      | `#a0a0a0`                            | `#63636b`             | metadata และข้อความรอง                  |
| `--border` / `--border-strong`    | `#2e2e33` / `#505050`                | `#e4e4e7` / `#bdbdbd` | เส้นแบ่งพื้นผิว / เส้นขอบ control       |
| `--accent`                        | `#8ab4f8`                            | `#245fa8`             | keyboard focus ring และสถานะใหม่        |
| `--primary-bg` / `--primary-fg`   | `#dfdfdf` / `#202020`                | `#282828` / `#ffffff` | primary action                          |
| `--success` / `--success-bg`      | `#61ce91` / `#17301f`                | `#1f7a45` / `#e6f4ea` | สถานะสำเร็จ                             |
| `--danger` / `--danger-bg`        | `#f08080` / `#362222`                | `#b42318` / `#fce8e8` | ข้อผิดพลาดและ action อันตราย            |
| `--attention` / `--attention-bg`  | `#e2bd75` / `#332b1e`                | `#8a5a00` / `#fdf3dc` | คำเตือน                                 |
| `--diff-add-bg` / `--diff-del-bg` | `#193526` / `#3c2222`                | `#e3f2e8` / `#fae5e5` | บรรทัด diff เพิ่ม/ลบ                    |
| `--terminal-selection`            | `#3d4b60`                            | `#cbd5e4`             | การเลือกข้อความใน terminal              |

ใช้สีเขียว/แดงสำหรับสถานะและ diff เพิ่ม/ลบ สีเหลืองสำหรับคำเตือน อย่าใช้สีสถานะ
เป็นพื้นของรายการที่เลือก ปุ่ม Push ใช้ primary neutral; ผลลัพธ์ Pushed ใช้ success
diff มีเครื่องหมาย `+`/`-` และแถบสีริมบรรทัดประกอบกัน จึงไม่สื่อความหมายด้วยสีเพียงอย่างเดียว
terminal selection ใช้ `--terminal-selection` เพื่อให้เห็นการเลือกข้อความชัดเจนกว่าสีเลือกแถว

## Typography, spacing, shape

**ฟอนต์** (bundle มากับแอป ไม่โหลดจาก network):

- UI: Geist Variable (`--font-ui`, fallback Segoe UI / system-ui)
- Code ใน UI: Geist Mono Variable (`--font-code`, Tailwind `font-mono`)
- Terminal (xterm): Cascadia Code (`--font-terminal`) ไม่เปลี่ยนเป็น Geist Mono เพราะ xterm วัดขนาดฟอนต์ตอนเปิด
  และเลือกใช้ตัวอักษรที่คงที่ตามที่ตั้งไว้

**ขนาดตัวอักษร**: Tailwind utility `text-xs` / `text-sm` / `text-base` ใช้ 12 / 13 / 14px (ประกาศใน `@theme inline`)
ส่วน `var(--text-*)` จาก `tokens.css` ยังเป็น 11 / 12 / 13px และใช้เฉพาะใน `legacy.css` และ xterm
ใน component ใหม่ให้ใช้ utility ของ Tailwind เท่านั้น

**Spacing**: `--space-1` ถึง `--space-5` = 4, 8, 12, 16, 24px (ใช้ Tailwind spacing ตามปกติได้ เช่น `gap-2`, `p-3`)

**มุมโค้ง**:

- `tokens.css`: `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px
- Tailwind (`@theme inline`): `rounded-sm` 4px, `rounded-md` 6px, `rounded-lg` 8px, `rounded-xl` 11px, `rounded-2xl` 14px
- แนวทาง: badge ใช้ `rounded-sm`; control และแถว `rounded-md`/`rounded-lg`; dialog และ popover ใช้ค่าที่ shadcn กำหนด

**ขนาดอื่น**: ไอคอนใช้ Lucide 14–16px; ปุ่มไอคอน 30 × 30px; แถวข้อมูลสูงอย่างน้อย 30–32px; หัว pane สูงอย่างน้อย 40px;
title bar 46px; rail 52px
ใช้เส้นขอบ 1px; shadow เฉพาะ dialog และ popover (`--shadow-popover`, `--shadow-dialog`) ไม่ใส่ shadow ในแต่ละ pane

## Motion

ค่าทั้งหมดอยู่ใน `motion.ts` (`DURATION`, `TRANSITIONS`, `transitionFor`) และ CSS duration ของ `tokens.css` (`--duration-fast` 120ms)
ห้ามใส่ค่า duration ตัวเลขใหม่ใน component

| Name   | Value                                     | Used for                                   |
| ------ | ----------------------------------------- | ------------------------------------------ |
| fast   | 120 ms ease-out                           | Hover, press, focus ring, tab underline    |
| enter  | 180 ms, spring stiffness 520 / damping 40 | Dialog, popover, menu, toast in            |
| exit   | 120 ms ease-in                            | Everything that leaves                     |
| layout | 220 ms, spring stiffness 400 / damping 36 | List reorder, selection pill, panel resize |

- Dialog: opacity 0→1, scale .96→1, y 6→0 (`dialogMotion`); backdrop แค่ fade
- Selection pill เลื่อนระหว่างแถวใน branch list, file list และ rail
- Toast เข้าจากขวา x 16→0; toast เก่ากว่า scale .94; error toast อยู่จนกว่าจะกดปิด
- หลัง Sync แถวไฟล์ใหม่ค่อย ๆ ขยายเข้า และแถวที่ถูกลบยุบออก
- เปลี่ยน module ใช้ crossfade 120 ms ไม่มี slide; terminal dock ยังคง mount และไม่เคลื่อนที่
- Pulse เฉพาะตอน connecting และ restarting

**Never animate**: diff lines, terminal output, การ scroll, list ที่มากกว่า 100 แถว และทุกอย่างระหว่างลากปรับขนาด pane

**Reduced motion**: เมื่อระบบตั้ง reduced motion (`prefers-reduced-motion`) transform เปลี่ยนเป็น 0 ms และ opacity fade ยังคง 80 ms
(กำหนดทั้งใน `motion.ts` และ `main.css` ที่ cap animation/transition duration ทุกตัวไว้ที่ 80 ms)
spring เป็น interruptible จึงหยุดกลางคันได้เมื่อผู้ใช้ทำ action ใหม่

## Shadcn components

Component ทั้งหมดอยู่ใน `src/renderer/src/components/ui/` เป็นโค้ดของโปรเจกต์เอง แก้ไขได้โดยตรง

**เพิ่ม component ใหม่**

```powershell
npx shadcn@latest add <name>
npx prettier --write src/renderer/src/components/ui/<name>.tsx
```

หลังเพิ่มให้แทน overlay แบบ `bg-black/NN` ด้วย `bg-(--backdrop)` เสมอ
library ใหม่ของ renderer ให้ใส่ใน `devDependencies` ตามแนวทางของโปรเจกต์

**ใช้งานใน component**

```tsx
import { cn } from 'cn'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { GitBranch, Settings } from 'lucide-react'

<Button variant="default" disabled={busy} onClick={push}>Push</Button>
<Button variant="outline" onClick={cancel}>Cancel</Button>
<Button variant="ghost" size="icon" aria-label="Settings" onClick={openSettings}>
  <Settings aria-hidden="true" />
</Button>
<Badge variant="success">Pushed</Badge>
<div className={cn('flex items-center gap-2 rounded-md bg-selected px-2', active && 'text-selected-foreground')}>
  <GitBranch aria-hidden="true" />
  main
</div>
```

- `cn` import จาก `'cn'` (ไม่ใช่ path ของ shadcn ที่ generate มา) ใช้รวม class แบบมีเงื่อนไข
- import ด้วย alias `@renderer/...`
- ไอคอนใช้ `lucide-react` ทุกที่ ใส่ `aria-hidden="true"` เมื่อไม่ได้เป็นชื่อของปุ่ม

**สี: ใช้ token utility เท่านั้น**

- พื้นและข้อความ: `bg-background`, `text-foreground`, `bg-ground`, `bg-muted`, `text-muted-foreground`, `bg-accent` (hover),
  `bg-selected`, `text-selected-foreground`, `bg-primary` / `text-primary-foreground`
- สถานะ: `text-destructive`, `bg-destructive-soft`, `text-success`, `bg-success-soft`, `text-warning`, `bg-warning-soft`
- เส้นและ focus: `border-border`, `ring-ring`
- สี accent เป็นข้อความ: `text-(--accent)`; ค่าดิบอื่นใช้ `var(--token)` ใน class เช่น `bg-(--backdrop)`
- **ห้ามใส่ hex ใน `.tsx`** ถ้า token ที่ต้องการยังไม่มี ให้เพิ่มใน `tokens.css` และ `@theme inline` ก่อน แล้วค่อยใช้ utility

**Legacy**: `legacy.css` ไม่ควรมี rule ใหม่สำหรับ component ที่ migrate แล้ว style ของ component ใหม่ต้องอยู่ที่ component หรือ utility

## Interaction and accessibility

- Hover: เปลี่ยนพื้นผิว/เส้นขอบเล็กน้อย; selected: พื้นเทาและข้อความชัด
- Keyboard focus: ring หรือ outline 2px สี `--accent` พร้อม offset; ต้องมองเห็นบนทุกพื้นผิว
- Disabled: ใช้ native `disabled` และ opacity; อย่าเปลี่ยนเป็นข้อความธรรมดาที่คลิกได้
- ทุก icon-only action ต้องมี accessible name (`aria-label`); ทุก input ต้องมี label หรือ aria-label
- Checkbox/radio ใช้ความกว้าง native ไม่ยืดเต็มพื้นที่เหมือน text input
- เมื่อตัดชื่อไฟล์ยาวในหัว diff ให้มี `title` แสดงชื่อเต็ม
- Reduced motion ปิด transform และ spinner ตาม section Motion
- Theme switching ต้องอัปเดต terminal foreground/background/cursor/selection พร้อม UI

## Review checklist

1. ตรวจ dark/light: title bar, branch/file selection, diff, terminal, workspace menu, settings
2. ตรวจ Add existing repo ทั้ง Check และ Confirm รวม disabled, warning และ error
3. ใช้ Tab ดู focus ปุ่ม/ช่องกรอก; ตรวจชื่อปุ่มไอคอนและ label
4. ลากแยก pane และยุบ/ขยาย terminal; เปิดแอปใหม่เพื่อเช็กค่าขนาดเดิม
5. เช็กชื่อ branch/file ยาวและข้อความไทย; scroll แนวนอนของ diff
6. ตรวจ hardcoded hex ใน `.tsx` (ควรไม่มี) และ duration ที่ไม่มาจาก `motion.ts`
7. รัน `npm run typecheck`, `npx vitest run --project renderer`, `npx electron-vite build` และ `npx eslint .`

ใช้ component และ tokens ชุดนี้กับหน้าที่เพิ่มภายหลังเพื่อคง design เดียวกัน

บน Windows หาก `bash` ใน PATH ชี้ไปที่ WSL ให้เลือก Git Bash ใน session ที่รัน tests
เพื่อให้ sandbox fixtures ใช้ path แบบ Windows ได้:

```powershell
$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
npm test
```
