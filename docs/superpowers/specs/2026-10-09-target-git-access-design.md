# Git access on target hosts

วันที่: 2026-10-09 · สถานะ: draft รอผู้ใช้ review · ขอบเขตรอบนี้: โหมด **Installed**, provider **GitHub (`github.com`)** เท่านั้น

## เป้าหมาย

ให้ AI agent ที่รัน**บน target host** (Codex, Claude Code หรือ agent อื่น ไม่ใช่เฉพาะ terminal ของ remodeck)
`git push` และ `gh pr create` ได้เอง โดย remodeck เป็นผู้เก็บ token และกดติดตั้งลง target ให้

- token ผูกกับ **scope** = host + path prefix เช่น `github.com/org-a` (ทั้ง org) หรือ `github.com/org-a/payments` (override เฉพาะ repo)
- repo คนละ org บน target เดียวกันใช้พร้อมกันได้ โดยไม่ต้องสลับ account
- โครงสร้างข้อมูล, ไฟล์บน target และ credential helper ไม่ผูกกับ GitHub เพื่อให้เพิ่ม GitLab, self-hosted หรือเจ้าอื่นได้ทีหลัง
  โดยเพิ่มแค่ provider adapter
- ถอนออกได้ด้วยปุ่มเดียว และ target ไม่เหลือ token

**เกณฑ์สำเร็จ:** บน target ที่มี clone ของ `org-a/x`, `org-a/payments` และ `org-b/y` agent รัน `git push` และ `gh pr create`
ได้ทุก repo โดย `org-a/payments` ใช้ token ที่ override ไว้, `org-a/x` ใช้ token ของ `org-a` และ `org-b/y` ใช้ token ของ `org-b`
หลังกด Remove แล้ว `~/.config/remodeck/git-access/` ไม่มีอยู่ ไม่มี wrapper ของเรา และ `~/.gitconfig` ไม่มีบรรทัดที่เราเพิ่ม

## การตัดสินใจหลัก

| เรื่อง | ตัดสินใจ | เหตุผล |
| --- | --- | --- |
| เก็บ token บน host (Windows) | Electron `safeStorage` (DPAPI) ไม่มี master password | key ผูกกับ Windows user; master password ช่วยแค่กรณี malware user เดียวกันตอนแอปล็อก แต่แลกกับ friction ทุกครั้งที่เปิดแอป |
| token บน target | plaintext ไฟล์ `0600` ใน dir `0700` | git/CLI ต้องได้ plaintext; เข้ารหัสบน target ไม่ช่วยเพราะ key ต้องอยู่เครื่องเดียวกัน |
| ผูก token กับอะไร | scope = `host/path-prefix` เลือกด้วย **longest-prefix match** | รองรับ override ราย repo และ nested group ของ GitLab ด้วยกฎเดียว |
| เลือก token | credential helper ของเราตัวเดียว (generic) | git ใช้ helper โดยตรง; CLI wrapper เรียก helper ตัวเดียวกัน (แหล่ง token เดียว) |
| ความต่างระหว่าง provider | `ProviderAdapter` (username ของ git, CLI wrapper, การตรวจ token, รูปแบบ path) | ส่วนที่ต่างกันจริงมีแค่นี้ ส่วนที่เหลือใช้ร่วมกัน |
| เปิดใช้ | opt-in ต่อ host | ขัดกับหลักเดิม "token ไม่เข้า sandbox" จึงต้องเป็นการเลือกของผู้ใช้ทีละ host |
| ติดตั้ง CLI (`gh`) | ไม่ติดตั้งให้ | คงหลัก "แอปไม่ติดตั้งแพ็กเกจบน sandbox"; ตรวจแล้วแจ้งถ้าไม่มี |
| ติดตั้งลง target เมื่อไร | เฉพาะตอนผู้ใช้กด Install / Update host | ไม่แตะ target อัตโนมัติตอน connect |
| GitHub App | ยังไม่ทำ แต่ออกแบบ `CredentialSource` ให้เพิ่มได้ | token อายุ 1 ชม.ดีกว่า แต่ต้องมี refresh ซึ่งต้องใช้ persistent channel |

## นอกขอบเขตรอบนี้

- provider อื่นนอกจาก GitHub บน `github.com` (GitLab, GitHub Enterprise Server, Bitbucket, self-hosted) ทำได้ด้วยการเพิ่ม adapter ในรอบถัดไป
- โหมด **On-demand** (helper ถาม remodeck ผ่าน persistent SSH tunnel, token ไม่ลงดิสก์ target)
- GitHub App / installation tokens
- ให้ Git Bridge ใช้ token ตาม scope (bridge ยังใช้ `getGitHubCredential` เดิม)
- ตั้ง `user.name`/`user.email` ตาม scope บน target
- แก้ shell rc (`.bashrc`, `.profile`) ของ target
- ติดตั้ง token ลง target อัตโนมัติเมื่อ token ถูก rotate

## ภาพรวม

```
Windows (remodeck)                                  Target (Linux, over SSH)
┌──────────────────────────────┐                    ┌───────────────────────────────────────────────┐
│ TokenStore                   │   ssh bash -s      │ ~/.config/remodeck/git-access/                 │
│  config.json: metadata       │ ─────────────────▶ │   tokens/github.com/org-a/@token        (0600) │
│  secrets.json: DPAPI blobs   │  script on stdin   │   tokens/github.com/org-a/payments/@token      │
│ ProviderAdapter (github)     │  (token inside     │   tokens/github.com/org-b/@token               │
│ TargetAccessService          │   stdin only)      │   git-credential-remodeck                      │
│  install / update / remove   │                    │   gitconfig   (included from ~/.gitconfig)     │
│  / status                    │                    │ ~/.local/bin/gh   (wrapper, marked)            │
└──────────────────────────────┘                    └───────────────────────────────────────────────┘
          git push ──▶ credential helper ──▶ longest-prefix match ──▶ @token
          gh ...   ──▶ wrapper ──▶ helper --token-for <host/path> ──▶ GH_TOKEN ──▶ real gh
```

## Scope

scope คือ `host/path` เช่น `github.com/org-a/payments`

- `host`: hostname ตัวพิมพ์เล็ก ไม่มี port และ scheme รอบนี้รับเฉพาะ host ที่มี adapter รองรับ (`github.com`)
- `path`: segment ที่คั่นด้วย `/` อย่างน้อย 1 segment แปลงเป็นตัวพิมพ์เล็ก ตัด `.git` และ `/` ท้ายออก
  - ทุก provider: segment ต้องไม่ว่าง, ไม่เป็น `.` หรือ `..` และใช้ได้เฉพาะ `[a-z0-9._-]`
  - adapter กำหนดจำนวน segment ที่รับได้ (GitHub: 1 = owner, 2 = owner/repo)
- scope ไม่ซ้ำกัน การเพิ่ม token ให้ scope ที่มีอยู่แล้วคือการ rotate

**การเลือก token (longest-prefix match):** สำหรับ request `host` + `p1/p2/…/pn` จะหา scope `host/p1/…/pn` ก่อน
แล้วตัด segment ท้ายทีละตัวจนเหลือ `host/p1` ตัวแรกที่เจอคือตัวที่ใช้ ถ้าไม่เจอเลยก็ไม่ตอบอะไร

## Provider adapter

```ts
interface ProviderAdapter {
  readonly id: 'github'                    // future: 'gitlab', 'bitbucket', …
  /** Hosts this adapter accepts by default; self-hosted hosts are added per token later. */
  readonly defaultHosts: readonly string[]
  /** Segment-count and naming rules for a scope path. Returns an error message or null. */
  validatePath(path: string): string | null
  /** Username git sends with the token (GitHub: x-access-token, GitLab: oauth2). */
  readonly gitUsername: string
  /** CLI wrapped on the target, or null when the provider has no CLI to wrap. */
  readonly cli: { command: string; tokenEnv: string; repoFlags: string[]; repoEnv: string | null } | null
  /** Checks the token against the provider API; returns the account login and expiry. */
  validateToken(host: string, path: string, token: string): Promise<{ login: string; expiresAt: string | null }>
}
```

รอบนี้มี `githubAdapter` ตัวเดียว:

| ฟิลด์ | ค่า |
| --- | --- |
| `defaultHosts` | `['github.com']` |
| `validatePath` | 1 หรือ 2 segment |
| `gitUsername` | `x-access-token` |
| `cli` | `{ command: 'gh', tokenEnv: 'GH_TOKEN', repoFlags: ['-R', '--repo'], repoEnv: 'GH_REPO' }` |
| `validateToken` | ดูหัวข้อ "ตรวจ token ตอนเพิ่ม" |

ค่าของ adapter (username, ชื่อ CLI, env) ถูกเขียนลง target ตอน install (ดู `providers.conf`) script บน target
จึงไม่ต้องรู้จัก provider ใดๆ ล่วงหน้า

**ตัวอย่างของรอบถัดไป (ไม่ทำรอบนี้):** GitLab = `gitUsername: 'oauth2'`, `cli: glab` + `GITLAB_TOKEN`, path ยาวได้ไม่จำกัด (nested group),
ตรวจด้วย `GET /api/v4/user`

## Host side

### ข้อมูล

`Config` (ใน `config.json`, ไม่มีความลับ) เพิ่ม:

```ts
export type GitToken = {
  id: string
  provider: 'github'
  host: string           // e.g. github.com
  path: string           // e.g. org-a or org-a/payments (normalized)
  login: string          // account that owns the token
  label: string
  expiresAt: string | null
  updatedAt: string
}

export type HostGitAccess = {
  installedAt: string
  installed: Record<string, string>  // tokenId -> GitToken.updatedAt at install time; used to detect stale tokens
  wrapperVersion: number | null      // null when the wrapper was skipped
}

Config.gitTokens: GitToken[]
Host.gitAccess?: HostGitAccess
```

ความลับเก็บใน `secrets.json` คนละไฟล์ใน data dir เดียวกัน: `{ [tokenId]: base64(safeStorage.encryptString(token)) }`
เขียนแบบ atomic (tmp + rename) เหมือน `config.json`

- ถ้า `safeStorage.isEncryptionAvailable()` เป็น false จะปฏิเสธการเพิ่ม token และแสดงเหตุผล ไม่มี fallback เป็น plaintext
- ถอดรหัสเฉพาะตอนจะติดตั้ง ไม่ส่ง token ข้าม IPC ไป renderer (renderer ส่ง token มาได้ทางเดียวตอนเพิ่มหรือ rotate)

### CredentialSource

```ts
interface CredentialSource {
  readonly tokenId: string
  /** Secret to install on a target, plus when it stops working. */
  resolve(): Promise<{ token: string; expiresAt: string | null }>
}
```

รอบนี้มี `StoredTokenSource` ตัวเดียว (อ่านจาก `secrets.json`) ส่วน GitHub App ในอนาคตจะเป็น `AppInstallationSource`
ที่สร้าง token ใหม่ทุกครั้งที่เรียก `resolve()` โดยไม่ต้องแก้ `TargetAccessService`

### ตรวจ token ตอนเพิ่ม (GitHub)

1. `GET https://api.github.com/user` ได้ 200 → เก็บ `login` และ `expiresAt` จาก header `github-authentication-token-expiration`
   ได้ 401 → ปฏิเสธ "Token is invalid or expired"
2. path 1 segment: `GET /orgs/{owner}` ถ้าได้ 404 ให้ลอง `GET /users/{owner}` ถ้ายังไม่เจอก็ปฏิเสธ (กันพิมพ์ผิด)
3. path 2 segment: `GET /repos/{owner}/{repo}` ด้วย token ต้องได้ 200 ซึ่งพิสูจน์ด้วยว่า token เข้าถึง repo นั้นได้

ไม่ตรวจ permission ละเอียด (fine-grained PAT ไม่มี API ให้อ่าน) ส่วน UI จะบอกสิทธิ์ที่แนะนำแทน

## Target side

ทุกไฟล์อยู่ใต้ `~/.config/remodeck/git-access/` (`0700`) ยกเว้น wrapper กับ 1 บรรทัดใน `~/.gitconfig`

### `tokens/<host>/<path>/@token`

ไฟล์ละ token, `0600` ใช้ชื่อไฟล์ `@token` เพราะ `@` ไม่อยู่ในชุดอักษรที่ path segment ใช้ได้ จึงไม่ชนกับชื่อ repo หรือ group
เช่น scope `github.com/org-a` กับ `github.com/org-a/payments` อยู่ร่วมกันได้

### `providers.conf`

บรรทัดละ host: `<host> <gitUsername>` เช่น `github.com x-access-token` สร้างจาก adapter ตอน install

### `git-credential-remodeck` (POSIX sh, `0700`)

- รับเฉพาะ `get` ส่วน `store`/`erase` ให้ exit 0 เงียบๆ (ไม่ให้ git เขียนหรือลบ token ของเรา)
- อ่าน `protocol`, `host`, `path` จาก stdin ถ้า `protocol` ไม่ใช่ `https`, host ไม่อยู่ใน `providers.conf` หรือไม่มี `path`
  ให้ exit 0 โดยไม่ตอบอะไร
- normalize path ตามกฎของ scope แล้วทำ longest-prefix match ถ้าเจอจะตอบ `username=<gitUsername>` และ `password=<token>`
- ไม่เจอ → ไม่ตอบอะไร git จะไปถาม helper ตัวถัดไป
- โหมด `--token-for <host>/<path>` ให้ wrapper เรียก ใช้ match แบบเดียวกันแล้วพิมพ์แค่ token

### `gitconfig` (included)

มีหนึ่ง section ต่อ host ใน `providers.conf`:

```ini
[credential "https://github.com"]
    helper = /home/<user>/.config/remodeck/git-access/git-credential-remodeck
    useHttpPath = true
```

install script แทน `/home/<user>` ด้วย `$HOME` แบบ absolute ตอนเขียนไฟล์ (ไม่พึ่งการขยาย `~` ในค่า `helper`)
ติดตั้งด้วย `git config --global --add include.path "$HOME/.config/remodeck/git-access/gitconfig"`
และใช้ path absolute เดียวกันตอน remove ไม่แก้ส่วนอื่นของ `~/.gitconfig`

**helper ซ้อนกัน:** ถ้า user มี credential helper ของ host เดียวกันอยู่แล้วและตัวนั้นตอบก่อน git จะใช้ token ของตัวนั้น
ตอน status จึงตรวจด้วย `git config --global --get-all credential.<url>.helper` และ `credential.helper`
ถ้าเจอให้แสดง warning (ไม่แก้ให้)

**`useHttpPath`:** กระทบ helper อื่นของ host นั้นด้วย ต้องมี test ยืนยันพฤติกรรมของ `credential-store`
ที่มีรายการไม่ระบุ path และบันทึกผลไว้ใน status/README

### CLI wrapper (`~/.local/bin/<cli>`, POSIX sh, `0755`)

ติดตั้งหนึ่งไฟล์ต่อ CLI ของ adapter ที่ใช้งาน (รอบนี้มีแค่ `gh`) บรรทัดที่สองมี marker `# remodeck-cli-wrapper <cli> v<N>`
เพื่อตรวจว่าเป็นไฟล์ของเราและเป็นเวอร์ชันไหน

ลำดับการทำงานของ `gh` wrapper:
1. หา `gh` ตัวจริงจาก `PATH` โดยข้ามไฟล์ตัวเอง ถ้าหาไม่เจอให้พิมพ์ error แล้ว exit 127
2. ถ้ามี `GH_TOKEN` หรือ `GITHUB_TOKEN` อยู่แล้ว → `exec` ตัวจริงเลย
3. หา repo ตามลำดับ: argument `-R`/`--repo` (`OWNER/REPO`, `--repo=…`, `HOST/OWNER/REPO`) → env `GH_REPO`
   → `git remote get-url origin` (รองรับ `https://<host>/`, `git@<host>:`, `ssh://git@<host>/`)
4. เรียก `git-credential-remodeck --token-for <host>/<owner>/<repo>` ถ้าได้ token ให้ `export GH_TOKEN`
   (เพราะใช้ match เดียวกับ git, override ราย repo จึงมีผลกับ `gh` ด้วย)
5. `exec` ตัวจริงพร้อม argument เดิมทั้งหมด

ไม่เจอ repo หรือไม่มี token → ส่งต่อให้ `gh` ตัวจริงโดยไม่แตะ env (ใช้ `gh auth` ของ user ตามปกติ)

**ถ้ามี `~/.local/bin/gh` อยู่แล้วแต่ไม่มี marker:** ไม่ทับ install สำเร็จเฉพาะส่วน git และ status แสดง
"gh wrapper not installed: ~/.local/bin/gh already exists"

**PATH:** ไม่แก้ shell rc ตอน status จะตรวจ `command -v gh` ทั้งใน `bash -lc` และ `bash -c`
ถ้าไม่ใช่ wrapper ของเรา จะแสดงวิธีแก้ (เพิ่ม `~/.local/bin` ไว้หน้า `PATH`) ให้ผู้ใช้ทำเอง

**เวอร์ชัน:** แอปรู้เวอร์ชันล่าสุดของ wrapper ถ้า marker บน target เก่ากว่า status จะขึ้น "Update available"
และอัปเดตเมื่อผู้ใช้กด Update host

## TargetAccessService (main)

ทุกคำสั่งรันผ่าน `SshTarget.exec(script)` ซึ่งส่ง script ทาง stdin ของ `ssh … bash -s`
token จึงอยู่ใน script เท่านั้น ไม่โผล่ใน argv ของ process ไหนทั้งฝั่ง Windows และ target

| คำสั่ง | ทำอะไร |
| --- | --- |
| `status(hostId)` | อ่าน scope ใน `tokens/`, เวอร์ชัน wrapper, CLI resolve ไปที่ไหนใน login/non-login shell, `gh --version`, helper อื่นที่ซ้อน, include ยังอยู่ไหม แล้วเทียบกับ `Host.gitAccess` เพื่อหาว่าอะไร stale, missing หรือ outdated |
| `install(hostId, tokenIds)` | `umask 077`, สร้าง dir, เขียน helper / `providers.conf` / gitconfig / tokens ด้วย heredoc ลง tmp แล้ว `mv`, ลบ `@token` ที่ไม่อยู่ใน set (และ dir ที่ว่าง), เพิ่ม `include.path` ถ้ายังไม่มี, เขียน wrapper ตามกฎด้านบน แล้วบันทึก `Host.gitAccess` |
| `remove(hostId)` | `git config --global --fixed-value --unset-all include.path <path>` (git เก่ากว่า 2.30 ใช้ regex ที่ escape แล้ว), ลบ wrapper เฉพาะที่มี marker, `rm -rf ~/.config/remodeck/git-access` แล้วล้าง `Host.gitAccess` |

script ทุกตัวต้อง idempotent และใช้ `set -eu` ถ้า fail กลางทางให้รายงาน error (ผ่าน redaction) แล้วแนะนำให้กด Update host
ซ้ำหรือ Remove ไม่ต้อง rollback อัตโนมัติ เพราะสถานะที่ค้างครึ่งทางยังปลอดภัย: token ที่ยังไม่ถูกเขียนก็แค่ใช้ไม่ได้

**Rotate / ลบ token:** เมื่อ token ถูก rotate ทุก host ที่ติดตั้ง token นั้นไว้จะขึ้น "Changed since install" และผู้ใช้ต้องกด Update host เอง
ส่วนการลบ token จะขอยืนยัน พร้อมบอกรายชื่อ host ที่ยังติดตั้ง token นั้นอยู่

## UI

ดูภาพร่างที่คุยกันไว้ในแชท จัดวางด้วย component และ tokens ที่มีอยู่ (`ConfirmDanger`, `Button`, `Badge`)

### Settings → Git tokens

- รายการ token เรียงตาม scope โดย override ราย repo อยู่ใต้ scope ของ org แต่ละแถวแสดง scope (monospace), label, login,
  วันหมดอายุ (เหลือไม่เกิน 7 วันขึ้น warning, หมดแล้วขึ้น error) และจำนวน host ที่ติดตั้ง
- ปุ่ม Add token และเมนูต่อแถว: Replace token (rotate), Edit label, Remove
- ฟอร์ม Add: host (select มีแค่ `github.com` ในรอบนี้), path (`org` หรือ `org/repo`), label, token (password input)
  พร้อมคำแนะนำ "fine-grained, เลือกเฉพาะ repo, Contents RW + Pull requests RW, ตั้งวันหมดอายุ" และลิงก์ไปหน้าสร้าง PAT ของ GitHub

### Host settings → Git access on this host

- ปิดไว้เป็นค่าเริ่มต้น ข้อความเตือนแสดงตลอดเมื่อเปิดใช้:
  "Tokens are stored in plain text on this host. Anything running as this user can read them.
  Terminals opened from remodeck keep using the Git Bridge and push approval."
- checkbox เลือก token ต่อ scope พร้อม badge "Changed since install" สำหรับตัวที่ stale
- รายการ status: credential helper, CLI ที่พบและเวอร์ชัน, wrapper active ใน login และ non-login shell, helper ซ้อน, wrapper outdated
- ปุ่ม Remove from host, Check again และ Install / Update host (เป็นปุ่ม primary ตัวเดียว)
- Install ครั้งแรกและ Remove ใช้ `ConfirmDanger`

## ความสัมพันธ์กับ Git Bridge

terminal ที่เปิดจาก remodeck ยังตั้ง `url.<bridge>.insteadOf` ผ่าน env เหมือนเดิม git ใน terminal นั้นจึงยังผ่าน
bridge, approval popup และกฎ protected branch ส่วน `gh` ใน terminal นั้นใช้ wrapper (ไม่มี bridge สำหรับ API)
สองทางนี้แยกกัน และไม่ต้องแก้โค้ด bridge ในรอบนี้

## ความปลอดภัย

- token ไม่เคยอยู่ใน argv, log, `push-log.jsonl`, error message หรือ IPC ขาออกไป renderer
  error ของ script ต้องผ่าน redaction ที่แทน token ที่รู้จักด้วย `***` ก่อนแสดงผล
- ตอนเปิดใช้ต้องแจ้งว่าการป้องกันจริงบน target มาจาก (1) scope และวันหมดอายุของ token และ (2) ruleset/branch
  protection บนฝั่ง provider เพราะกฎของ bridge ไม่มีผลกับ agent ที่ push ตรง
- README ส่วน Security boundary แก้ให้ตรงความจริง: ค่าเริ่มต้นยังไม่มี token ใน sandbox แต่ถ้า opt-in ต่อ host ก็จะมี
- ข้อจำกัดที่ยอมรับ: process ใดที่รันเป็น user เดียวกันบน target อ่าน token ได้ ซึ่งจะลดได้ด้วยโหมด on-demand ในรอบหน้า

## Testing

- **Unit (main):** normalize/validate scope; `githubAdapter.validatePath`; longest-prefix match (ฝั่ง TS ใช้ตอน status/preview);
  parse repo จาก URL ทุกรูปแบบ; parse `-R`/`--repo`/`GH_REPO`; redaction; `TokenStore` กับ `safeStorage` แบบ mock
  (รวมกรณี encryption unavailable และการ rotate scope เดิม); stale/outdated detection
- **Integration (`LocalTarget` + bash):**
  - install แล้ว `git credential fill` ได้ token ถูกตัวสำหรับ `org-a/x` (org), `org-a/payments` (override), `org-b/y`; scope ที่ไม่รู้จักและ host ที่ไม่อยู่ใน `providers.conf` ไม่ได้อะไร
  - `store`/`erase` ไม่เปลี่ยนไฟล์
  - wrapper กับ `gh` ปลอม (สคริปต์ที่พิมพ์ `GH_TOKEN` และ argv) ใน repo ทั้งสาม, `-R`, `--repo=`, `GH_REPO`, `GH_TOKEN` ที่ตั้งไว้แล้ว, นอก repo
  - ไม่ทับ `~/.local/bin/gh` ที่ไม่มี marker; wrapper เวอร์ชันเก่าถูกแทนที่ตอน Update
  - install ซ้ำได้ผลเหมือนเดิม; ถอด token ออกจาก set แล้ว `@token` และ dir ที่ว่างหายไป
  - remove แล้วไม่เหลือไฟล์และไม่มี include; สิทธิ์ไฟล์ `0700`/`0600`
- **พฤติกรรม `useHttpPath`** กับ `credential-store` ที่มีอยู่ก่อน (ดูหัวข้อ gitconfig)
- **Renderer:** ฟอร์ม Add token (validation ของ host/path), การเรียง override ใต้ org, สถานะหมดอายุ,
  Host access panel ทุกสถานะ (not enabled / installed / stale / outdated / gh missing / wrapper shadowed / wrapper skipped)
- **Manual (เพิ่มใน `docs/manual-test.md`):** บน target จริง clone repo ตามเกณฑ์สำเร็จ แล้วให้ Claude Code หรือ Codex push และเปิด PR
  ทุก repo จากนั้นกด Remove แล้วตรวจว่า push ใช้ไม่ได้

## งานต่อจากนี้ (ไม่อยู่ในรอบนี้)

1. Adapter เพิ่ม: GitLab (`glab`, nested group, self-hosted host), GitHub Enterprise Server, Bitbucket (ไม่มี CLI wrapper)
2. โหมด On-demand: persistent `ssh -R` ต่อ host, helper ถาม remodeck แทนการอ่านไฟล์, log การใช้ token
3. `AppInstallationSource` สำหรับ GitHub App (ต้องใช้ข้อ 2 เพื่อ refresh token อายุ 1 ชม.)
4. ให้ Git Bridge เลือก credential ตาม scope จาก `TokenStore`
