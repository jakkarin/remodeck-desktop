# Containers — Compose list

วันที่: 2026-10-08 · สถานะ: ผู้ใช้เลือกแนวออกแบบ **Compose list**

## ข้อตกลง

ใช้ Compose list สำหรับหน้า Containers แทนแนว table/grid ในร่างก่อนหน้า คง layout หลักของแอป: TopBar, ActivityBar, พื้นที่ Containers และ terminal ด้านล่าง

แบบที่เลือกคือ variant `Compose list` ในภาพร่าง `remodeck-table-redesign.html` การเลือกนี้รับรองทิศทางหน้าตาของ Containers; ไม่ใช่การเลือกตารางแบบอื่น และไม่ขยายขอบเขตไป redesign Git หรือ Push log

## โครงข้อมูลและหน้าตา

- แต่ละ Compose project เป็น section ของตัวเอง ชื่อ project อยู่เหนือกล่อง; Standalone แยกอีก section
- กล่องมีกรอบบาง มุมมนประมาณ 16px และพื้น neutral ตาม light/dark theme
- ภายในใช้ semantic list (`ul` / `li`) ไม่ใช้ table หรือหัวคอลัมน์
- แต่ละรายการ: ชื่อ container และ status badge อยู่บรรทัดหลัก; image, published ports และ status detail อยู่บรรทัดรอง
- คำสั่ง Start/Stop/Restart/Remove อยู่ด้านขวาในพื้นที่แยกจากข้อความ รักษาตำแหน่ง Remove ให้คงที่
- เส้นแบ่งแนวนอนเว้นจากขอบกล่องประมาณ 16px; ไม่มีเส้นแบ่งคอลัมน์
- **ไม่มีการเปลี่ยนพื้นแถวเมื่อ hover** แถวยังมีพื้นเดียวกับกล่อง
- ปุ่มยังมี keyboard focus ที่มองเห็นได้และ accessible name; การเอา hover ออกไม่ลบ focus indication
- ข้อมูลรองขึ้นบรรทัดได้เมื่อยาว; จอแคบจัด actions ต่อด้านล่างโดยไม่ทำให้ข้อความชนกัน

## Interaction ที่คงเดิม

Filter ชื่อ/image, Show stopped, group collapse ที่มีอยู่, live updates, busy ต่อ container, error/retry และ danger policy คงเดิม

ชื่อ project ใช้ control สำหรับ collapse ตาม behavior ปัจจุบัน โดยแยกจากกรอบรายการ; ไม่มีการสั่งคำสั่งเมื่อคลิกพื้นแถว กลุ่มที่ยุบยังมีชื่อให้เปิดกลับได้

Filter ที่ไม่มีรายการในกลุ่มอาจซ่อนกล่องกลุ่มนั้นตามผลกรอง แต่ต้องไม่ทำให้ no matches กลายเป็น no containers; แยก empty/loading/error และ stale data ให้ถูกสาเหตุ

ใช้ `name`, `image`, `ports`, `state`, `status` ที่มีอยู่จริง ไม่เพิ่ม health/uptime ที่ backend ไม่ส่ง Preserve actions ที่ policy รองรับ โดยไม่เปลี่ยนการอนุมัติคำสั่ง

Terminal session, portal ownership, resize/collapse และ layout preferences ไม่เปลี่ยนจากงาน visual นี้

## Component composition ที่เสนอ

| Component     | หน้าที่                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| GroupPanel    | title/collapse control + rounded list surface; รับ children ไม่อ่าน IPC      |
| ItemRow       | content slot + trailing actions; spacing/เส้นแบ่ง/การ wrap; ไม่มี hover fill |
| ItemContent   | primary title/status + secondary metadata                                    |
| RowActions    | พื้นที่สำหรับปุ่มที่มีขนาดและตำแหน่งสม่ำเสมอ                                 |
| ContainerItem | map domain fields และ action callbacks ลงใน patterns ข้างต้น                 |

ใช้ tokens, Button/IconButton และ Badge เดิม ต่อยอดเฉพาะ pattern ที่ใช้จริง; logic และ hooks ของ Containers คงอยู่ใน domain layer

## การตรวจรับเมื่อ implement

ตรวจหลาย Compose projects และ Standalone; ชื่อ/image/ports ยาว; running/restarting/paused/stopped; busy/error; filter และ collapse; light/dark และ keyboard focus

ต้องไม่มี table DOM หรือ hover fill ในรายการ Containers, ไม่มีข้อมูลชน actions และไม่มี regression ของ policy/terminal เมื่อเปลี่ยนหน้า

นำแบบนี้ไป implement ในหน้า Containers แล้วบน branch `codex/containers-compose-list` โดยแยก `GroupPanel`, `ItemRow` และ `ContainerItem` สำหรับ composition ใช้ tokens เดิม และไม่มีการ publish

Renderer tests 253 เคส, typecheck และ build ผ่าน ตรวจไฟล์ที่แก้ด้วย ESLint ผ่าน; full suite ยังมี failures ฝั่ง shell/path บน Windows และ repository-wide lint มี errors ในไฟล์เดิม ดูผลตรวจใน implementation plan การตรวจภาพใน Electron กับข้อมูล host จริงยังไม่ได้ทำ
