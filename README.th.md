# remodeck

**Git และ Docker บนเซิร์ฟเวอร์ของคุณ ผ่าน SSH**

[English](README.md) | ภาษาไทย

แอป desktop (Windows, Electron + TypeScript) สำหรับจัดการ Git repository และ Docker บนเครื่องนี้
และ Linux host ระยะไกลผ่าน SSH ในโหมด **Git Bridge** ซึ่งเป็นค่าเริ่มต้น credential ของ GitHub จะอยู่บนเครื่อง
Windows ของคุณ และ host ระยะไกลไม่ต้องเชื่อมต่อ GitHub โดยตรง ส่วนโหมด **Git access on this host**
เป็นตัวเลือกที่ติดตั้ง token แบบจำกัด scope ไว้บน host ระยะไกล ดูรายละเอียดในหัวข้อขอบเขตความปลอดภัยด้านล่าง

ทำได้ทั้ง Clone / Sync / Review diff / Push / เปิด PR และเปิด terminal ที่ push/pull ผ่าน Git Bridge
พร้อม popup ให้อนุมัติ

**สถานะ:** อยู่ในช่วงพัฒนาเริ่มต้น รองรับการพัฒนาและแพ็กเกจบน Windows x64 เท่านั้น
script แพ็กเกจของ macOS/Linux ยังเป็นแบบทดลองและไม่ได้ตรวจใน CI ของ Windows
ควรลองกับ repository และ host ที่ทิ้งได้ก่อนนำไปใช้กับงานสำคัญ

## เริ่มต้น

สำหรับ repository บนเครื่องนี้ ให้ติดตั้ง Node.js 24 และบน Windows ให้ติดตั้ง Git for Windows ด้วย
(Linux และ macOS ใช้ bash ของระบบ) แล้วรัน:

```bash
git clone https://github.com/jakkarin/remodeck-desktop.git
cd remodeck-desktop
npm ci
npm run install:electron
npm run dev
```

เลือก **This computer** เพื่อเพิ่ม repository ที่มีอยู่แล้วหรือ clone ใหม่ ถ้าเป็น repository บน host ระยะไกล
ให้ตั้ง SSH alias ก่อน แล้วเพิ่ม host นั้นใน remodeck งานที่เกี่ยวกับ GitHub ใช้ login ของ Git Credential Manager
บน Windows

## สิ่งที่ต้องมี

- **Windows x64** ที่ติดตั้ง **Git for Windows** (รวม Git Bash) และ **Node.js 24 / npm 11**
  (`.node-version` ระบุ Node major ที่ใช้ใน CI) บน Linux และ macOS (แบบทดลอง) ใช้ `bash` และ `git`
  แทน Git for Windows
- สำหรับ host ระยะไกล: ตั้ง SSH alias ใน `~/.ssh/config` ให้ `ssh <alias>` ใช้ได้จาก Windows (โหลด key ไว้ใน ssh-agent)
- ติดตั้ง `git` บน Windows และบน host ระยะไกลทุกเครื่อง
- login GitHub บน Windows ผ่าน Git Credential Manager:
  ```
  git credential-manager github login
  ```
- ไม่บังคับ: Docker Desktop แบบ Linux containers สำหรับจัดการ container บนเครื่องและรัน test ที่ใช้ Docker
  และ Docker Engine บน host ระยะไกลสำหรับ container บน host นั้น หน้า Builds ต้องใช้ Docker Buildx ที่รองรับ history ด้วย

## รัน

```bash
npm ci          # ใช้ lockfile ที่ commit ไว้
npm run install:electron # ดาวน์โหลด Electron runtime (หรือใช้ตัวที่ติดตั้งไว้แล้ว)

npm run dev      # เปิดแอป (dev build)
npm run lint     # ESLint (warning เรื่อง format ที่มีอยู่เป็นแค่คำแนะนำ)
npm run typecheck
npm test         # unit + integration tests (Vitest)
npm run build    # typecheck และ build application bundles
npm run build:win # สร้าง Windows installer แบบไม่ sign ไว้ใน dist/ ไม่ publish
```

ดู [การตั้งค่าสำหรับพัฒนาและการแก้ปัญหา](docs/development.md) สำหรับการตั้ง Git Bash และ Docker tests
CI ตรวจ lint, types, tests, dependency audit และ Windows installer
Docker end-to-end tests รันแยกบน Windows ที่รองรับและมี Docker Engine ทำงานอยู่

Checklist ทดสอบ end-to-end ด้วยมือ: [docs/manual-test.md](docs/manual-test.md)

UI tokens และการใช้ component: [Neutral design guidelines](docs/design-guidelines.md)

## เครื่องนี้ (This computer)

host แรกในรายการคือ **This computer** เสมอ และแอปเปิดมาที่ host นี้ทุกครั้ง ใช้จัดการ repo บนเครื่องนี้
โดยไม่ต้องใช้ SSH: Clone, Add existing, Sync, Review, Push และ PR ทำได้เหมือน host อื่น terminal เปิดเป็น bash
ใน repo และ `git push` จาก terminal ยังผ่าน Git Bridge และ popup อนุมัติเหมือนเดิม ส่วน Containers ใช้ Docker บนเครื่องนี้

- บน **Windows** ต้องติดตั้ง **Git for Windows** (ใช้ `bash.exe` ของ Git for Windows และไม่ใช้ bash ของ WSL)
  path เป็นแบบ `D:/projects/app` หรือ `D:\projects\app` ถ้ายังไม่มี Git for Windows ปุ่ม Connect จะบอกวิธีติดตั้ง
- บน **Linux และ macOS** (แบบทดลอง) ใช้ `/bin/bash` หรือ `bash` ตัวแรกใน `PATH` และ path เป็นแบบ
  `~/projects/app` หรือ `/home/me/projects/app` การเทียบ path สนตัวพิมพ์เล็ก/ใหญ่บน Linux แต่ไม่สนบน macOS
- Containers ต้องใช้ Docker Desktop (หรือ Docker engine อื่นบนเครื่อง)
- เครื่องนี้ไม่ใช่ sandbox: โปรแกรมใดก็ตามที่รันบนเครื่องใช้ login ของ Git Credential Manager ได้อยู่แล้ว
  popup อนุมัติครอบคลุมเฉพาะการ push จาก terminal ที่เปิดจาก remodeck ไม่มีตัวเลือก _Git access on this host_
  สำหรับเครื่องนี้ และลบ This computer ออกจากรายการไม่ได้

## Docker builds

ในโมดูล Containers แท็บ **Builds** แสดงประวัติของ Buildx builder ปัจจุบันบน SSH host ที่เลือก ได้แก่ ชื่อ,
build ID, สถานะ, เวลาที่สร้าง และระยะเวลา กด **Refresh** เพื่อโหลดใหม่ host ต้องมี Docker Buildx และ BuildKit
เวอร์ชันที่รองรับ `docker buildx history ls` ถ้าไม่รองรับ จะแสดง error ของคำสั่งพร้อมคำแนะนำให้อัปเกรด

**Prune build cache** จะเปิด terminal tab ที่รัน `docker buildx prune --force` บน host นั้นหลังยืนยัน
(host ที่เปิด protection ต้องพิมพ์ชื่อ host ก่อน) terminal dock จะขยายออกถ้ายุบอยู่ และแสดงความคืบหน้า error
และพื้นที่ที่ได้คืนโดยตรง คำสั่งนี้ลบเฉพาะ cache ที่ไม่ได้ใช้ของ builder ปัจจุบัน ไม่ลบประวัติ build, container
หรือ volume แต่ build ครั้งถัดไปอาจช้าลงระหว่างสร้าง cache ใหม่

ปุ่ม **Prune** ใน Images, Volumes และ Networks ก็เปิด terminal บน host ที่เลือกเช่นกัน และรายการจะรีเฟรช
เมื่อคำสั่งจบ แต่ละคำสั่งใช้ขอบเขต prune ตามค่าเริ่มต้นของ Docker การ prune volume ต้องพิมพ์ชื่อ host ทุกครั้ง
และ host ที่เปิด protection ต้องพิมพ์ชื่อ host สำหรับ images และ networks ด้วย

## ขอบเขตความปลอดภัย

- ในโหมด Git Bridge (ค่าเริ่มต้น) GitHub token อยู่บน Windows เท่านั้น terminal ที่เปิดจากแอปเชื่อมต่อ GitHub ผ่าน
  **Git Bridge** บนเครื่อง (`127.0.0.1` ผ่าน ssh remote forward) ซึ่งใส่ credential ให้บน host
- fetch/pull ผ่าน bridge ไม่ต้องอนุมัติ แต่ทุกการ push ต้องอนุมัติใน popup
  (Allow once / for this session / always for this repo / Deny ถ้าไม่ตอบภายใน 60 วินาที = Deny)
- กฎตายตัวบน host (มีผลแม้เลือก "always allow" และปิดได้ราย repo ใน Settings):
  ห้ามลบ ref และห้าม push ไปยัง protected branch (ค่าเริ่มต้นคือ `main`, `master`)
- bridge ตรวจจับ force push บน branch ที่ไม่ได้ protect ไม่ได้ popup จะแสดง `old → new` ให้คุณตัดสินใจเอง
- การแยก session เป็น **soft boundary**: ถ้า AI รันเป็น Linux user เดียวกับ terminal ของแอป
  process อื่นของ user นั้นอ่าน environment และใช้ port ที่ forward ไว้ได้ระหว่างที่ terminal เปิดอยู่
  ด่านป้องกันจริงคือ popup อนุมัติและกฎตายตัวบน host ซึ่ง sandbox แตะต้องไม่ได้
- ตัวเลือกราย host ที่ปิดไว้เป็นค่าเริ่มต้น: **Git access on this host** (ใน Host settings) จะเขียน token
  แบบจำกัด scope ของคุณเป็น plain text ไว้บน host นั้น เพื่อให้ agent บน host ใช้ `git` และ `gh` ได้โดยตรง
  process ใดที่รันเป็น user นั้นอ่าน token ได้ terminal ที่เปิดจาก remodeck ยังใช้ Git Bridge และ popup อนุมัติเหมือนเดิม
  แต่กฎของ bridge ไม่มีผลกับ agent ที่ push เองโดยตรง การป้องกันจึงขึ้นกับ scope และวันหมดอายุของ token
  และ ruleset ของ GitHub กด Remove from host เพื่อลบไฟล์ทั้งหมดออก ใน terminal ของ remodeck
  `gh` หา repo จาก URL ของ `origin` ที่ตั้งไว้ ไม่ใช่ URL ที่ Git Bridge เขียนทับ
  ถ้าติ๊กยินยอมตอน install เท่านั้น remodeck จะเพิ่ม `~/.local/bin` ไว้หน้าสุดของ `PATH` ผ่าน block ที่มีเครื่องหมาย
  บนสุดของ `~/.bashrc` (ไม่แก้ไฟล์ที่เป็น symlink) และ Remove from host จะลบ block นั้นด้วย
  ถ้ามี credential helper อื่นอยู่แล้ว (เช่น `gh auth setup-git`) ติ๊กให้ helper ของ remodeck ถูกถามก่อนได้
  helper เดิมยังเป็น fallback สำหรับ repo ที่ไม่มี token ของ remodeck การตั้งค่านี้แก้เฉพาะไฟล์ include ของ remodeck
  และย้ายบรรทัด `include.path` ไปไว้ท้าย global git config ของคุณ
  คนที่ login เข้า host ด้วย Linux user เดียวกันจะใช้ชุดติดตั้งเดียวกัน อ่านและใช้ token ของกันได้
  ถ้าอีกคนกด Install หรือ Update host จาก remodeck ของเขา token บน host จะถูกแทนด้วยชุดที่เขาเลือก
  และ Remove from host ของเขาจะลบทั้งหมด ถ้าต้องการแยก token ให้แต่ละคนใช้ Linux user ของตัวเอง
- ทุกการ push (ทั้งผ่าน bridge และ Review) ถูกบันทึกไว้ใน `push-log.jsonl`
- ในโหมด bridge ค่าเริ่มต้น แอปไม่เขียนอะไรลง working tree หรือ commit ของ repo ใน sandbox แอปจะ
  `git init` ตั้ง `remote origin` และอัปเดต `refs/remotes/origin/*` กับ tags การลบ workspace ในแอป
  ไม่ลบอะไรใน sandbox

อ่าน [SECURITY.md](SECURITY.md) สำหรับ threat model ข้อจำกัดที่ทราบ และการรายงานช่องโหว่

## การมีส่วนร่วมและข้อมูลโปรเจกต์

- [Contributing](CONTRIBUTING.md): การตั้งค่า การตรวจ issue และ pull request เขียนเป็นภาษาอังกฤษหรือไทยก็ได้
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Release checklist](docs/releasing.md)
- [Secret and dependency audit](docs/open-source-readiness.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

โค้ดของโปรเจกต์ใช้ [MIT License](LICENSE) ส่วนโค้ด ฟอนต์ และไอคอนของบุคคลที่สามใช้ license ของแต่ละรายการ
ดูรายละเอียดใน notices ด้านบน
