# นโยบายความเป็นส่วนตัว

[English](PRIVACY.md)

ปรับปรุงล่าสุด: 2026-10-19

remodeck เป็นแอปเดสก์ท็อปที่ทำงานบนเครื่องของคุณ โปรเจกต์นี้ไม่มีเซิร์ฟเวอร์ และไม่เก็บ ไม่รับ
หรือขายข้อมูลของคุณ แอปไม่มี analytics, telemetry, การส่งรายงาน crash, โฆษณา หรือการตรวจหาอัปเดตอัตโนมัติ

## ข้อมูลที่เก็บบนเครื่องของคุณ

remodeck เก็บข้อมูลไว้ในโฟลเดอร์ `remodeck` ภายใต้โฟลเดอร์ข้อมูลแอปของผู้ใช้
(`%APPDATA%\remodeck` บน Windows, `~/Library/Application Support/remodeck` บน macOS และ
`~/.config/remodeck` บน Linux):

- **การตั้งค่า** (`config.json`): โฮสต์ path บนโฮสต์ ข้อมูล repository และกฎการอนุมัติ
- **Push log** (`push-log.jsonl`): บันทึกการอนุมัติ push และการ push ที่ทำผ่าน remodeck
- **Token secrets** (`secrets.json`): GitHub token ที่คุณเพิ่มในหน้า Settings เข้ารหัสด้วย Electron
  `safeStorage` การเข้ารหัสนี้ไม่ได้ป้องกันโปรแกรมอื่นที่รันด้วยบัญชีผู้ใช้เดียวกับคุณ
- **Repository mirrors** ที่ Git Bridge ใช้

ข้อมูลเหล่านี้อยู่บนเครื่องของคุณจนกว่าคุณจะลบ การถอนการติดตั้งแอปอาจไม่ลบโฟลเดอร์นี้
หากต้องการลบข้อมูลทั้งหมดให้ลบโฟลเดอร์เอง และอย่าแนบโฟลเดอร์นี้ใน issue เพราะอาจมีข้อมูลส่วนตัว

## การเชื่อมต่อที่แอปทำ

remodeck เชื่อมต่อเฉพาะบริการที่คุณใช้ผ่านแอป:

- **GitHub** (`github.com`, `api.github.com`): เพื่อแสดงรายการ repository ตรวจสิทธิ์ของ token
  และทำงาน Git โดยใช้ credential ของคุณเองจาก Git Credential Manager หรือ token ที่คุณเพิ่ม
  ข้อมูลส่วนนี้อยู่ภายใต้ [privacy statement ของ GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
- **โฮสต์ SSH ที่คุณตั้งค่า**: remodeck รัน terminal คำสั่ง Git และ Docker บนโฮสต์นั้นด้วยบัญชีที่คุณเลือก
- **ลิงก์ที่คุณเปิด**: บางคำสั่ง เช่น การเปรียบเทียบ branch จะเปิดหน้าเว็บในเบราว์เซอร์ของคุณ

หากคุณเปิด **Git access on this host** token ที่เลือกจะถูกคัดลอกไปเก็บบนโฮสต์ Linux นั้นเป็นไฟล์ข้อความธรรมดา
ดูความเสี่ยงและวิธีลบได้ใน [SECURITY.md](SECURITY.md)

## การรายงานปัญหา

Issue และ pull request บน GitHub เป็นสาธารณะ อย่าใส่ token, private key, ชื่อโฮสต์ หรือข้อมูลแอปที่ไม่ต้องการเปิดเผย
ปัญหาด้านความปลอดภัยให้รายงานแบบส่วนตัวตามที่อธิบายใน [SECURITY.md](SECURITY.md)

## การเปลี่ยนแปลง

การเปลี่ยนแปลงนโยบายนี้จะทำในไฟล์นี้และบันทึกไว้ในประวัติของ repository
สอบถามได้ที่ [GitHub issues](https://github.com/jakkarin/remodeck-desktop/issues)
