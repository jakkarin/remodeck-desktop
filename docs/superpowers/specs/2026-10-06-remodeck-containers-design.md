# remodeck — Host context + Containers module

วันที่: 2026-10-06
สถานะ: Draft (รอ review)
ต่อจาก: `2026-10-05-ux-redesign-design.md` (Git Bridge, push approval, Mirror และหลัก zero footprint ไม่เปลี่ยน)

## 1. เป้าหมาย

### สิ่งที่ผู้ใช้บอก
- อยากได้ตัวจัดการ Docker แบบ Docker Desktop แต่ทำงานผ่าน SSH alias เดิมแบบเดียวกับฝั่ง git
- รวมอยู่ในแอปเดียวกัน (แอปเปลี่ยนชื่อเป็น remodeck แล้ว): "Git & Docker on your servers, over SSH."
- กลัวกดคำสั่งอันตรายผิด host เช่น ลบ compose ของอีกเครื่อง

### สิ่งที่ตกลงกันแล้ว
- **Host เป็นบริบทหลักของทั้งแอป**: เลือก host ที่ `HostSelector` บน topbar จุดเดียว ทุกโมดูลทำงานกับ host นี้
- **แถบ icon ซ้ายสุด** (activity bar): Git, Containers, Settings (ล่างสุด) — icon แสดงปกติเสมอ
- **ตรวจความสามารถตอนเข้าโมดูล** ไม่ใช่ตอน connect; ไม่มีเครื่องมือ → icon + ข้อความ + คำสั่งแก้ + ปุ่ม "ตรวจอีกครั้ง"
- **Host 2 ระดับ**: ปกติ / protected
- **ขอบเขต Containers ครบ A–F**: containers, logs + exec, compose actions, stats, images/volumes/networks, inspect
- **Docker เท่านั้น** ไม่ทำ interface กลางเผื่อ Podman (ถ้าต้องการภายหลังค่อยออกแบบแยก)
- **Transport**: Docker Engine API ผ่าน `ssh <host> docker system dial-stdio`; compose / logs / exec รันเป็น CLI ใน terminal tab
- **ไม่รองรับ `sudo docker`**: user ต้องอยู่ในกลุ่ม `docker`, ใช้ rootless Docker หรือ ssh เป็น root

### เกณฑ์สำเร็จ
- server ที่มีแต่ docker (ไม่มี git) connect และใช้โมดูล Containers ได้
- สถานะ container ในแอปเปลี่ยนตามจริงภายใน ~2 วินาที โดยไม่ต้องกด refresh
- จากรายการ container ถึง "เห็น log ที่ follow อยู่" หรือ "อยู่ใน shell ของ container" ด้วยคลิกเดียว
- ไม่มีทางสั่งคำสั่งอันตรายบน host protected โดยไม่ได้พิมพ์ชื่อ host
- ไม่ติดตั้งหรือเขียนอะไรบน server

### ไม่อยู่ในขอบเขต
Podman, `sudo docker`, Docker contexts / TCP+TLS daemon, Swarm / Kubernetes, build image จากแอป, แก้ไฟล์ compose, ส่ง/รับไฟล์เข้า container, registry login

## 2. โครงหลักของแอป

### 2.1 ข้อมูล
```ts
type Host = { id: string; sshHost: string; label: string; protected: boolean } // protected ใหม่, default false

type GitCapability = { version: string; remoteHttp: boolean; forward: boolean }
type DockerCapability =
  | { state: 'ok'; version: string; apiVersion: string }
  | { state: 'missing' | 'no-permission' | 'no-daemon' | 'too-old'; detail: string }
```
- Store เดิมอ่าน host ที่ไม่มี `protected` เป็น `false`
- `HostStatus` เลิกถือ `gitVersion`; connect = ssh เข้าได้เท่านั้น (`ssh <host> true` + ข้อความ error เดิม)
- ผลตรวจ git / docker เก็บในหน่วยความจำฝั่ง main ต่อ host ล้างเมื่อ disconnect / reconnect / กด "ตรวจอีกครั้ง"

### 2.2 การตรวจตอนเข้าโมดูล
- **Git**: ใช้ `PREFLIGHT_SCRIPT` + `checkRemoteForward` เดิม ย้ายจาก connect มาเรียกครั้งแรกที่เข้าโมดูล Git หรือเปิด workspace บน host นั้น; ไม่มี git → empty state, warning เรื่อง HTTP / forward แสดงแบบเดิม
- **Docker**: ดู §3.1
- IPC: `hosts.probe(hostId, 'git' | 'docker', { force?: boolean })`

### 2.3 สถานะใน renderer
- `activeHostId` (จำใน localStorage `remodeck.activeHost`), `activeModule: 'git' | 'containers'` (จำเช่นกัน)
- `activeWorkspaceId` ต้องเป็น workspace ของ `activeHostId` เสมอ; เปลี่ยน host → เลือก workspace ล่าสุดที่ใช้บน host นั้น (จำ map hostId → workspaceId) หรือไม่เลือกถ้าไม่มี
- ไม่มี host เลย → EmptyState เดิม (เพิ่ม host)

### 2.4 Layout
```
┌──────────────────────────────────────────────────────────┐ ← แถบแดง 3px ถ้า host protected
│ [● prod-01 🔒 ▾]  (Git: workspace ▾ · Sync)        ⚙     │ topbar
├────┬─────────────────────────────────────────────────────┤
│ ⎇  │                                                     │
│ ▣  │   เนื้อหาของโมดูลที่เลือก                              │
│    │                                                     │
│ ⚙  ├─────────────────────────────────────────────────────┤
│    │   TerminalTabs (เฉพาะ tab ของ host ที่เลือก)           │
└────┴─────────────────────────────────────────────────────┘
```
- **HostSelector** (ซ้ายสุดของ topbar): ชื่อ host, จุดสถานะ, ป้าย protected; dropdown มีรายการ host + connect / disconnect / settings / remove / add host (ย้ายส่วนจัดการ host ออกจาก `WorkspaceSwitcher`)
- **WorkspaceSwitcher**: แสดงเฉพาะในโมดูล Git และเฉพาะ workspace ของ host ที่เลือก (clone / add existing ยังอยู่ที่นี่) ปุ่ม Sync แสดงเฉพาะโมดูล Git
- **Activity bar**: ไอคอน lucide `GitBranch`, `Container`, `Settings`; ปุ่มที่เลือกอยู่ใช้พื้น accent
- **Host protected**: แถบแดง 3px บนสุดของหน้าต่าง + ป้าย "protected" ใน HostSelector; ตั้งค่าได้ใน Host settings

### 2.5 ConfirmDanger
คอมโพเนนต์ใช้ร่วม: หัวเป็นชื่อ host ตัวใหญ่ + สรุปการกระทำ (เช่น "compose down · myapp — หยุดและลบ 3 container") ปุ่มยืนยันสีแดง
- โหมด `click`: กดยืนยันได้ทันที
- โหมด `type`: ช่องให้พิมพ์ชื่อ host (`label`) ต้องตรงทุกตัวอักษรก่อนปุ่มยืนยันจะทำงาน

## 3. Docker ฝั่ง main (`src/main/docker/`)

### 3.1 `dockerProbe.ts`
รันผ่าน `SshTarget.exec` สคริปต์เดียว:
```sh
command -v docker >/dev/null 2>&1 || { echo "probe=missing"; exit 0; }
out=$(docker version --format '{{json .}}' 2>&1); echo "probe-exit=$?"; printf '%s\n' "$out"
docker system dial-stdio --help >/dev/null 2>&1 && echo "dialstdio=1" || echo "dialstdio=0"
```
`parseDockerProbe(stdout)` → `DockerCapability`:
- ไม่มี binary → `missing`
- stderr มี `permission denied` + `docker.sock` → `no-permission` (detail แนะนำ `sudo usermod -aG docker $USER` แล้ว reconnect)
- `Cannot connect to the Docker daemon` → `no-daemon`
- `dialstdio=0` → `too-old` (ต้อง Docker ≥ 18.09)
- อื่น ๆ อ่าน `Server.Version`, `Server.ApiVersion` จาก JSON → `ok`

### 3.2 `dockerClient.ts`
- `new DockerClient({ connect: () => Duplex, timeoutMs })` — production ใช้ `sshDialStdio(sshPath, sshHost)` ที่ spawn `ssh -o BatchMode=yes -o ConnectTimeout=10 <host> docker system dial-stdio` แล้วรวม stdin/stdout เป็น Duplex (ปิด process เมื่อ socket ถูก destroy)
- ใช้ `http.Agent` ที่ override `createConnection` ด้วย `connect`; keep-alive, `maxSockets: 4`, ปิด socket ว่างหลัง 60 วินาที
- path ไม่ใส่ prefix version (server ใช้ API version ของตัวเอง)
- method: `json<T>(method, path, body?)`, `stream(path)` → async iterator ของ JSON lines (สำหรับ `/events`)
- timeout ต่อ request 15 วินาที (ยกเว้น stream); error ของ Docker (`{ message }` + status) → `DockerError(status, message)`
- ไม่ใช้ dockerode (ไม่อยากได้ `ssh2` / native deps และใช้ endpoint ไม่กี่ตัว)

Endpoint ที่ใช้: `GET /containers/json?all=1`, `GET /containers/{id}/json`, `POST /containers/{id}/start|stop|restart`, `DELETE /containers/{id}?force=0`, `GET /containers/{id}/stats?stream=false&one-shot=true`, `GET /events?filters=…`, `GET /images/json`, `DELETE /images/{id}`, `POST /images/prune`, `GET /volumes`, `DELETE /volumes/{name}`, `POST /volumes/prune`, `GET /networks`, `DELETE /networks/{id}`, `POST /networks/prune`

### 3.3 `containerService.ts`
หนึ่ง instance ต่อ host ที่โมดูล Containers ถูกเปิด (สร้างเมื่อ probe ได้ `ok`)
- `start()`: list containers → emit `containers:changed(hostId, list)`; เปิด `/events` (filter type=container) — ได้ event ของ id ไหนก็ `GET /containers/json?all=1&filters={"id":[id]}` แล้วแทนที่/ลบในรายการ แล้ว emit
- stream ขาด → emit `containers:live(hostId, false)`, ต่อใหม่ด้วย backoff 1 → 2 → 5 → 10 วินาที (ค้างที่ 10), ต่อได้แล้ว list ใหม่ทั้งหมด + `containers:live(hostId, true)`
- **compose grouping** จาก label `com.docker.compose.project`, `com.docker.compose.project.working_dir`, `com.docker.compose.project.config_files`, `com.docker.compose.service`; ไม่มี label → Standalone
- **stats**: renderer เรียก `containers.watchStats(hostId, on)` เมื่อหน้า Containers มองเห็น/ซ่อน; ระหว่าง on ดึง stats ของทุก container ที่ running ทุก 5 วินาที (ใช้ socket ใน pool เดียวกัน) คำนวณ CPU% = Δcontainer / Δsystem × online_cpus × 100, RAM = usage − cache → emit `containers:stats(hostId, map)`; ดึงไม่ได้ → ไม่มีค่าใน map (UI แสดง `—`)
- **inspect**: ส่ง JSON ทั้งก้อนให้ renderer; ค่า env ถูกซ่อนที่ UI (§4.2)
- **images / volumes / networks**: list + remove + prune ผ่าน client ตรง ๆ (ไม่ cache, ดึงใหม่เมื่อเปิดแท็บหรือหลังสั่ง)
- `dispose(hostId)` เมื่อ disconnect / remove host: ปิด events, หยุด stats, ทำลาย agent (ssh ทุกตัวของ host นั้นตาย)

### 3.4 Terminal tab แบบผูก host
`TerminalService` เพิ่ม `kind`:
```ts
type TabKind =
  | { kind: 'workspace'; workspaceId: string }   // เดิม: มี Git Bridge
  | { kind: 'host'; command: string[] }          // ใหม่: ไม่มี bridge, ไม่มี -R forward
```
- `openHostCommand(hostId, command, label)` spawn `ssh -t <host> <quoted command>` ผ่าน node-pty
- คำสั่งที่ใช้:
  - logs: `docker logs -f --tail 500 <id>` (label `logs · <name>`)
  - shell: `docker exec -it <id> sh -c 'command -v bash >/dev/null && exec bash || exec sh'` (label `sh · <name>`)
  - compose: `docker compose -p <project> --project-directory <dir> -f <file>… <up -d|down|pull|restart>` (label `<action> · <project>`)
- คำสั่งจบ → tab ค้างพร้อมบรรทัด `[remodeck] exited with code N` จนผู้ใช้ปิด
- id ต้องตรง `^[a-f0-9]{12,64}$`, ชื่อ project ตรง `^[a-z0-9][a-z0-9_-]*$`, path ผ่าน `validateSandboxPath` เดิม; ทุก argument ผ่าน shell quote ก่อนต่อเป็นคำสั่ง ssh
- `closeAllForHost` เดิมปิดทั้งสองแบบ

## 4. UI โมดูล Containers (`src/renderer/src/components/containers/`)

### 4.1 โครง
```
[Containers | Images | Volumes | Networks]        🔍 filter    ☐ แสดงตัวที่หยุด
┌──────────────────── รายการ ────────────────────┬──── รายละเอียด ────┐
│ ▾ myapp (compose)    [up] [pull] [restart] [down] │ web-1                │
│   ● web-1  nginx:1.27  8080→80  2.1%  40 MB  3h  │ Overview · Env · JSON │
│   ● db-1   postgres:16          0.4% 210 MB  3h  │                      │
│ ▾ Standalone                                     │                      │
│   ○ redis-test   exited (0) · 2h ago             │                      │
└──────────────────────────────────────────────────┴──────────────────────┘
```
- ใช้ `SplitLayout` เดิม (รายการ | รายละเอียด) + `TerminalTabs` ด้านล่าง
- แถวของ container: ปุ่ม hover = logs, shell, start/stop, restart, ⋯ (remove)
- กลุ่ม compose พับได้ (จำใน localStorage ต่อ host); หัวกลุ่มมีปุ่ม up / pull / restart / down
- สถานะ "หยุดอัปเดตสด" แสดงเป็นป้ายเล็กข้าง filter เมื่อ `containers:live = false`

### 4.2 แผงรายละเอียด (inspect)
- **Overview**: image, created, state / exit code, restart policy, ports, mounts (source → target, rw/ro), networks (ชื่อ + IP), labels
- **Env**: รายการ `KEY = ••••••` กดรูปตาเพื่อแสดงทีละตัว ไม่มีปุ่มแสดงทั้งหมด
- **JSON**: inspect ดิบ แบบอ่านอย่างเดียว (Env ใน JSON ถูกแทนด้วย `"<hidden: N vars>"`)

### 4.3 Images / Volumes / Networks
ตาราง: ชื่อ/tag, ขนาด (ถ้ามี), created, ป้าย "in use" (คำนวณจากรายการ container) ปุ่มลบต่อแถว และปุ่ม prune ที่หัวตาราง

### 4.4 ระดับการยืนยัน
| คำสั่ง | host ปกติ | host protected |
|---|---|---|
| start, logs, shell, inspect | – | – |
| stop, restart, compose up / pull / restart | – | `click` |
| remove container, compose down, image rm/prune, network rm/prune | `click` | `type` |
| volume rm / prune | `type` | `type` |

### 4.5 Empty / error state
- probe ไม่ผ่าน: icon + ข้อความตาม state (`missing` / `no-permission` / `no-daemon` / `too-old`) + คำสั่งแก้ (copy ได้) + ปุ่ม "ตรวจอีกครั้ง"
- host ยังไม่ connect: ข้อความ + ปุ่ม Connect (แบบเดียวกับโมดูล Git)
- ไม่มี container: "ยังไม่มี container บน <host>"

## 5. Error handling
| สถานการณ์ | พฤติกรรม |
|---|---|
| ssh / `dial-stdio` เชื่อมต่อไม่ได้ | แถบ error ในโมดูล "เชื่อมต่อ docker บน <host> ไม่ได้" + stderr + ปุ่ม retry |
| `/events` ขาด | backoff ตาม §3.3, ป้าย "หยุดอัปเดตสด" |
| Docker API 404 | "container/ image นี้ถูกลบไปแล้ว" แล้วดึงรายการใหม่ |
| Docker API 409 | ข้อความจาก Docker แปลเป็นไทยกรณีที่รู้จัก (เช่น ต้อง stop ก่อน remove, image ถูกใช้อยู่) อื่น ๆ แสดงข้อความของ Docker |
| stats ของ container ใดล้ม | ช่องนั้นแสดง `—` |
| compose: ไม่มี label หรือไฟล์ไม่อยู่แล้ว | ปุ่มยังกดได้ ผลจริงอยู่ใน terminal tab; tooltip ที่หัวกลุ่มบอก path ที่คาดไว้ |
| เปลี่ยน host / disconnect | `dispose` ตาม §3.3; terminal tab ทำงานตามกติกาเดิม |

## 6. การทดสอบ
- **Unit (main)**: `parseDockerProbe` ทุก state; shell quoting + validation ของ id / project / path; compose grouping จาก label; คำนวณ CPU% / RAM
- **`DockerClient`**: inject `connect` ที่ต่อเข้า HTTP server จำลองใน test — keep-alive, timeout, `DockerError`, อ่าน JSON lines ของ events
- **`ContainerService`**: client ปลอม — event → refetch เฉพาะตัว, stream ขาด → backoff + list ใหม่, `watchStats` เปิด/ปิด, `dispose`
- **Connection**: connect สำเร็จบน host ที่ไม่มี git; probe git ย้ายไปตอนเข้าโมดูล
- **Renderer**: HostSelector + เปลี่ยน host แล้ว workspace / terminal tab ตาม; activity bar; compose grouping; ConfirmDanger (`type` ต้องตรงทุกตัว); ตาราง §4.4 ทุกช่อง; Env ซ่อนเป็นค่าเริ่มต้น
- **E2E**: sandbox ใน `tests/e2e/sandbox` ติดตั้ง docker CLI และ mount `/var/run/docker.sock` ของเครื่อง test → ทดสอบ probe + list + start/stop + events ผ่าน sshd จริง; ข้ามถ้าเครื่อง test ไม่มี docker
- อัปเดต `docs/manual-test.md` ด้วยรายการตรวจของโมดูล Containers และ host protected

## 7. Phase
1. **โครงหลัก** — `protected`, connect = ssh, probe git ตอนเข้าโมดูล, `activeHostId` / `activeModule`, HostSelector, activity bar, WorkspaceSwitcher กรองตาม host, ConfirmDanger
2. **Containers (A)** — dockerProbe, DockerClient, ContainerService (list + events), รายการจัดกลุ่ม compose, start / stop / restart / remove
3. **Logs, exec, compose (B + C)** — terminal tab แบบ host, ปุ่ม logs / shell, compose actions
4. **Stats + inspect (D + F)** — watchStats, แผงรายละเอียด
5. **Images / Volumes / Networks (E)**

แต่ละ phase ผ่าน typecheck + test และใช้งานได้จริงก่อนเริ่ม phase ถัดไป
