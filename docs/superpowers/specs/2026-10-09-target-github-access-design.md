# GitHub access on target hosts

วันที่: 2026-10-09 · สถานะ: draft รอผู้ใช้ review · ขอบเขตรอบนี้: โหมด **Installed** เท่านั้น

## เป้าหมาย

ให้ AI agent ที่รัน**บน target host** (Codex, Claude Code หรือ agent อื่น ไม่ใช่เฉพาะ terminal ของ remodeck)
`git push` และ `gh pr create` ได้เอง โดย remodeck เป็นผู้เก็บ PAT และกดติดตั้งลง target ให้

- ใช้ PAT แยกต่อ owner (org หรือ user) เพราะ fine-grained PAT ผูกได้กับ resource owner เดียว
- repo คนละ org บน target เดียวกันใช้พร้อมกันได้ โดยไม่ต้องสลับ account
- ถอนออกได้ด้วยปุ่มเดียว และ target ไม่เหลือ token

**เกณฑ์สำเร็จ:** บน target ที่มี clone ของ `org-a/x` และ `org-b/y` agent รัน `git push` และ `gh pr create`
ได้ในทั้งสอง repo โดยแต่ละ repo ใช้ token ของ org ตัวเอง หลังกด Remove แล้ว
`~/.config/remodeck/` ไม่มีอยู่ ไม่มี wrapper `gh` ของเรา และ `~/.gitconfig` ไม่มีบรรทัดที่เราเพิ่ม

## การตัดสินใจหลัก

| เรื่อง | ตัดสินใจ | เหตุผล |
| --- | --- | --- |
| เก็บ PAT บน host (Windows) | Electron `safeStorage` (DPAPI) ไม่มี master password | key ผูกกับ Windows user; master password ช่วยแค่กรณี malware user เดียวกันตอนแอปล็อก แต่แลกกับ friction ทุกครั้งที่เปิดแอป |
| token บน target | plaintext ไฟล์ `0600` ใน dir `0700` | git/gh ต้องได้ plaintext; เข้ารหัสบน target ไม่ช่วยเพราะ key ต้องอยู่เครื่องเดียวกัน |
| เลือก token | credential helper ของเราเลือกจาก owner ใน path ของ URL | git ใช้ helper โดยตรง; `gh` ใช้ผ่าน wrapper ที่เรียก helper ตัวเดียวกัน (แหล่ง token เดียว) |
| เปิดใช้ | opt-in ต่อ host | ขัดกับหลักเดิม "token ไม่เข้า sandbox" จึงต้องเป็นการเลือกของผู้ใช้ทีละ host |
| ติดตั้ง `gh` | ไม่ติดตั้งให้ | คงหลัก "แอปไม่ติดตั้งแพ็กเกจบน sandbox"; ตรวจแล้วแจ้งถ้าไม่มี |
| GitHub App | ยังไม่ทำ แต่ออกแบบ `CredentialSource` ให้เพิ่มได้ | token อายุ 1 ชม.ดีกว่า แต่ต้องมี refresh ซึ่งต้องใช้ persistent channel |

## นอกขอบเขตรอบนี้

- โหมด **On-demand** (helper ถาม remodeck ผ่าน persistent SSH tunnel, token ไม่ลงดิสก์ target)
- GitHub App / installation tokens
- ให้ Git Bridge ใช้ token ต่อ org (bridge ยังใช้ `getGitHubCredential` เดิม)
- ตั้ง `user.name`/`user.email` ต่อ org บน target
- GitHub Enterprise Server (รองรับเฉพาะ `github.com`)
- แก้ shell rc (`.bashrc`, `.profile`) ของ target

## ภาพรวม

```
Windows (remodeck)                                  Target (Linux, over SSH)
┌──────────────────────────────┐                    ┌──────────────────────────────────────┐
│ TokenStore                   │   ssh bash -s      │ ~/.config/remodeck/github/            │
│  config.json: metadata       │ ─────────────────▶ │   tokens/<owner>      (0600)          │
│  secrets.json: DPAPI blobs   │  script on stdin   │   git-credential-remodeck             │
│ TargetAccessService          │  (token inside     │   gitconfig  (included from ~/.gitconfig)
│  install / update / remove   │   stdin only)      │ ~/.local/bin/gh   (wrapper, marked)   │
│  / status                    │                    └──────────────────────────────────────┘
└──────────────────────────────┘
                         git push ──▶ credential helper ──▶ tokens/<owner>
                         gh ...  ──▶ wrapper ──▶ helper ──▶ GH_TOKEN ──▶ real gh
```

## Host side

### ข้อมูล

`Config` (ใน `config.json`, ไม่มีความลับ) เพิ่ม:

```ts
export type GitHubToken = {
  id: string
  owner: string          // org หรือ user login ที่ token นี้ใช้ เทียบแบบ case-insensitive
  login: string          // account เจ้าของ token จาก GET /user
  label: string
  expiresAt: string | null   // จาก header github-authentication-token-expiration; null = ไม่หมดอายุ
  updatedAt: string
}

export type HostGitHubAccess = {
  tokenIds: string[]     // token ที่ติดตั้งบน host นี้
  installedAt: string
  installed: Record<string, string>  // tokenId -> updatedAt ของ token ตอนติดตั้ง ใช้ตรวจว่า stale
}

Config.githubTokens: GitHubToken[]
Host.githubAccess?: HostGitHubAccess
```

ความลับเก็บใน `secrets.json` คนละไฟล์ใน data dir เดียวกัน: `{ [tokenId]: base64(safeStorage.encryptString(pat)) }`
เขียนแบบ atomic (tmp + rename) เหมือน `config.json`

- `owner` ไม่ซ้ำกัน: หนึ่ง owner มีได้หนึ่ง token การเพิ่ม token ให้ owner ที่มีอยู่แล้วคือการ rotate
- ถ้า `safeStorage.isEncryptionAvailable()` เป็น false จะปฏิเสธการเพิ่ม token และแสดงเหตุผล ไม่มี fallback เป็น plaintext
- ถอดรหัสเฉพาะตอนจะติดตั้ง ไม่ส่ง PAT ข้าม IPC ไป renderer เลย (renderer ส่ง PAT มาได้ทางเดียวตอนเพิ่ม/rotate)

### CredentialSource

```ts
interface CredentialSource {
  readonly owner: string
  /** Secret to install on a target, plus when it stops working. */
  resolve(): Promise<{ token: string; expiresAt: string | null }>
}
```

รอบนี้มี `PatSource` ตัวเดียว (อ่านจาก `secrets.json`) ส่วน GitHub App ในอนาคตจะเป็น `AppInstallationSource`
ที่สร้าง token ใหม่ทุกครั้งที่เรียก `resolve()` โดยไม่ต้องแก้ `TargetAccessService`

### ตรวจ token ตอนเพิ่ม

1. `GET https://api.github.com/user` ด้วย PAT ได้ 200 → เก็บ `login` และ `expiresAt` จาก header
2. `GET /orgs/{owner}` ถ้าได้ 404 ให้ลอง `GET /users/{owner}` ถ้ายังไม่เจอก็ปฏิเสธ (กันพิมพ์ owner ผิด)
3. ได้ 401 → ปฏิเสธ "token invalid or expired"

ไม่ตรวจ permission ละเอียด (fine-grained PAT ไม่มี API ให้อ่าน) ส่วน UI จะบอกสิทธิ์ที่แนะนำให้ตั้งแทน

## Target side

ทุกไฟล์อยู่ใต้ `~/.config/remodeck/github/` (`0700`) ยกเว้น wrapper กับ 1 บรรทัดใน `~/.gitconfig`

### `tokens/<owner>`

ไฟล์ละ token, `0600` ชื่อไฟล์เป็น owner ตัวพิมพ์เล็ก (owner ที่ผ่าน validation มีแค่ `[a-z0-9-]` จึงใช้เป็นชื่อไฟล์ได้ตรงๆ)

### `git-credential-remodeck` (POSIX sh, `0700`)

- รับเฉพาะ `get` ส่วน `store`/`erase` ให้ exit 0 เงียบๆ (ไม่ให้ git ไปเขียนหรือลบ token ของเรา)
- อ่าน `protocol`, `host`, `path` จาก stdin ถ้าไม่ใช่ `https` + `github.com` หรือไม่มี `path` ให้ exit 0 โดยไม่ตอบอะไร
- owner = ส่วนแรกของ `path` แปลงเป็นตัวพิมพ์เล็ก ถ้ามี `tokens/<owner>` จะตอบ `username=x-access-token` และ `password=<token>`
- ไม่มี token ของ owner นั้น → ไม่ตอบอะไร git จะไปถาม helper ตัวถัดไป
- มีโหมด `--token-for <owner>` ให้ wrapper เรียก พิมพ์แค่ token ออกมา

### `gitconfig` (included)

```ini
[credential "https://github.com"]
    helper = /home/<user>/.config/remodeck/github/git-credential-remodeck
    useHttpPath = true
```

install script แทน `/home/<user>` ด้วย `$HOME` แบบ absolute ตอนเขียนไฟล์ (ไม่พึ่งการขยาย `~` ในค่า `helper`)
ติดตั้งด้วย `git config --global --add include.path "$HOME/.config/remodeck/github/gitconfig"`
ใช้ path absolute ตัวเดียวกันตอน remove ด้วย ไม่แก้ส่วนอื่นของ `~/.gitconfig`

**helper ซ้อนกัน:** ถ้า user มี credential helper ของ github.com อยู่แล้ว และตัวนั้นตอบก่อน
git จะใช้ token ของตัวนั้น ตอนติดตั้งจึงต้องตรวจด้วย `git config --global --get-all credential.https://github.com.helper`
และ `credential.helper` ถ้าเจอให้ status แสดง warning (ไม่แก้ให้)

**`useHttpPath`:** กระทบ helper อื่นของ github.com ด้วย ต้องมี test ยืนยันพฤติกรรมของ `credential-store`
ที่มีรายการไม่ระบุ path และบันทึกผลไว้ใน status/README

### `~/.local/bin/gh` (wrapper, POSIX sh, `0755`)

บรรทัดที่สองมี marker `# remodeck-gh-wrapper v1` ใช้ตรวจว่าเป็นไฟล์ของเรา

ลำดับการทำงาน:
1. หา `gh` ตัวจริงจาก `PATH` โดยข้ามไฟล์ตัวเอง หาไม่เจอก็พิมพ์ error แล้ว exit 127
2. ถ้ามี `GH_TOKEN` หรือ `GITHUB_TOKEN` อยู่แล้ว → `exec` ตัวจริงเลย
3. หา owner ตามลำดับ: argument `-R`/`--repo` (`OWNER/REPO`, `--repo=…`, `HOST/OWNER/REPO`) → env `GH_REPO`
   → `git remote get-url origin` (รองรับ `https://github.com/`, `git@github.com:`, `ssh://git@github.com/`)
4. เรียก `git-credential-remodeck --token-for <owner>` ถ้าได้ token ให้ `export GH_TOKEN`
5. `exec` ตัวจริงพร้อม argument เดิมทั้งหมด

ไม่เจอ owner หรือไม่มี token → ส่งต่อให้ `gh` ตัวจริงโดยไม่แตะ env (ใช้ `gh auth` ของ user ตามปกติ)

**ถ้ามี `~/.local/bin/gh` อยู่แล้วแต่ไม่มี marker:** ไม่ทับ install สำเร็จเฉพาะส่วน git และ status แสดงว่า
"gh wrapper not installed: ~/.local/bin/gh exists"

**PATH:** ไม่แก้ shell rc ตอน status ตรวจ `command -v gh` ทั้งใน `bash -lc` และ `bash -c`
ถ้าไม่ใช่ wrapper ของเรา ให้แสดงวิธีแก้ (เพิ่ม `~/.local/bin` ไว้หน้า `PATH`) ให้ผู้ใช้ทำเอง

## TargetAccessService (main)

ทุกคำสั่งรันผ่าน `SshTarget.exec(script)` ซึ่งส่ง script ทาง stdin ของ `ssh … bash -s`
token จึงอยู่ใน script เท่านั้น ไม่โผล่ใน argv ของ process ไหนทั้งฝั่ง Windows และ target

| คำสั่ง | ทำอะไร |
| --- | --- |
| `status(hostId)` | อ่าน `tokens/` ว่ามี owner อะไร, wrapper เป็นของเราไหม, `gh` resolve ไปที่ไหน, `gh --version`, helper อื่นที่ซ้อน, include ยังอยู่ไหม แล้วเทียบกับ `Host.githubAccess` เพื่อหาว่าอะไร stale/missing |
| `install(hostId, tokenIds)` | `umask 077`, สร้าง dir, เขียน helper / gitconfig / tokens ด้วย tmp + `mv`, ลบ `tokens/*` ที่ไม่อยู่ใน set, เพิ่ม `include.path` ถ้ายังไม่มี, เขียน wrapper ตามกฎด้านบน แล้วบันทึก `Host.githubAccess` |
| `remove(hostId)` | `git config --global --fixed-value --unset-all include.path <path>` (ถ้า git เก่ากว่า 2.30 ใช้ regex ที่ escape แล้ว), ลบ wrapper เฉพาะที่มี marker, `rm -rf ~/.config/remodeck/github` แล้วล้าง `Host.githubAccess` |

script ทุกตัวต้อง idempotent (รันซ้ำได้ผลเหมือนเดิม) และ `set -eu` ถ้า fail กลางทาง ให้รายงาน error พร้อม stderr
แล้วแนะนำให้กด Install ซ้ำหรือ Remove ไม่ต้องทำ rollback อัตโนมัติ เพราะสถานะครึ่งๆ ที่เหลืออยู่ปลอดภัย:
token ที่ยังไม่ถูกเขียนก็แค่ใช้ไม่ได้

**Update/rotate:** เมื่อ token ถูก rotate หรือลบบน host ทุก host ที่มี token นั้นจะขึ้น stale
ผู้ใช้กด "Update" ต่อ host (รอบนี้ไม่ทำ auto-push) ส่วนการลบ token บน host จะขอยืนยัน และบอกรายชื่อ host ที่ยังมี token นั้นติดตั้งอยู่

## UI

### Settings → GitHub tokens

- รายการ token: owner, login, label, วันหมดอายุ (ใกล้หมดภายใน 7 วันขึ้น warning, หมดแล้วขึ้น error), จำนวน host ที่ติดตั้ง
- ปุ่ม Add / Replace (rotate) / Remove
- ฟอร์ม Add: owner, label, PAT (password input) พร้อมคำแนะนำ "fine-grained, เลือกเฉพาะ repo, Contents RW + Pull requests RW, ตั้งวันหมดอายุ"
  และลิงก์ไปหน้าสร้าง PAT ของ GitHub

### Host settings → GitHub access on this host

- ปิดไว้เป็นค่าเริ่มต้น ตอนเปิดใช้ครั้งแรกจะแสดงข้อความยืนยัน:
  "Tokens will be stored in plain text on this host. Anything running as this user there can read them.
  Terminals opened from remodeck keep using the Git Bridge and push approval."
- checkbox เลือก token ต่อ owner, ปุ่ม Install / Update / Remove
- แสดงผลจาก `status`: gh found / version, wrapper active ใน login และ non-login shell, helper ซ้อน, รายการ stale
- ใช้ `ConfirmDanger` ที่มีอยู่แล้วสำหรับ Remove และสำหรับ Install ครั้งแรก

## ความสัมพันธ์กับ Git Bridge

terminal ที่เปิดจาก remodeck ยังตั้ง `url.<bridge>.insteadOf` ผ่าน env เหมือนเดิม git ใน terminal นั้นจึงยังผ่าน
bridge, approval popup และกฎ protected branch ส่วน `gh` ใน terminal นั้นใช้ wrapper (ไม่มี bridge สำหรับ API)
สองทางนี้แยกกัน และไม่ต้องแก้โค้ด bridge ในรอบนี้

## ความปลอดภัย

- PAT ไม่เคยอยู่ใน argv, log, `push-log.jsonl`, error message หรือ IPC ขาออกไป renderer
  error ของ script ต้องผ่าน redaction ที่แทน token ที่รู้จักด้วย `***` ก่อนแสดงผล
- ตอนเปิดใช้ต้องแจ้งว่าการป้องกันจริงบน target มาจาก (1) scope และวันหมดอายุของ PAT และ (2) ruleset/branch
  protection บน GitHub เพราะกฎของ bridge ไม่มีผลกับ agent ที่ push ตรง
- README ส่วน Security boundary แก้ให้ตรงความจริง: ค่าเริ่มต้นยังไม่มี token ใน sandbox, opt-in ต่อ host จะทำให้มี
- ข้อจำกัดที่ยอมรับ: process ใดที่รันเป็น user เดียวกันบน target อ่าน token ได้ จะลดได้ด้วยโหมด on-demand ในรอบหน้า

## Testing

- **Unit (main):** parse owner จาก URL ทุกรูปแบบ; parse `-R`/`--repo`/`GH_REPO`; validate owner; redaction;
  `TokenStore` กับ `safeStorage` แบบ mock (รวมกรณี encryption unavailable); stale detection
- **Integration (`LocalTarget` + bash):** install → helper ตอบ token ถูก owner ผ่าน `git credential fill`
  สำหรับ 2 owner; owner ที่ไม่รู้จักไม่ได้อะไร; wrapper กับ `gh` ปลอม (สคริปต์ที่พิมพ์ `GH_TOKEN` และ argv)
  ทั้งใน repo org-a, org-b, `-R`, `GH_TOKEN` ที่ตั้งไว้แล้ว, นอก repo; ไม่ทับ `~/.local/bin/gh` ที่ไม่มี marker;
  install ซ้ำได้ผลเหมือนเดิม; remove แล้วไม่เหลือไฟล์และไม่มี include; สิทธิ์ไฟล์ `0700`/`0600`
- **พฤติกรรม `useHttpPath`** กับ `credential-store` ที่มีอยู่ก่อน (ดูหัวข้อ gitconfig)
- **Renderer:** ฟอร์ม Add token, สถานะหมดอายุ, Host access panel ทุกสถานะ (not enabled / installed / stale / gh missing / wrapper shadowed)
- **Manual (เพิ่มใน `docs/manual-test.md`):** บน target จริง clone 2 repo คนละ org แล้วให้ Claude Code หรือ Codex push และเปิด PR ทั้งสอง repo
  จากนั้นกด Remove แล้วตรวจว่า push ใช้ไม่ได้

## งานต่อจากนี้ (ไม่อยู่ในรอบนี้)

1. โหมด On-demand: persistent `ssh -R` ต่อ host, helper ถาม remodeck แทนการอ่านไฟล์, log การใช้ token
2. `AppInstallationSource` สำหรับ GitHub App (ต้องใช้ข้อ 1 เพื่อ refresh token อายุ 1 ชม.)
3. ให้ Git Bridge เลือก credential ตาม `repo.owner` จาก `TokenStore`
