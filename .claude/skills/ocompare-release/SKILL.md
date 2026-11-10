---
name: ocompare-release
description: Use when the user asks to commit, push and publish a new OCompare version — "ออกเวอร์ชัน", "release", "commit push release", "ปล่อยเวอร์ชันใหม่", "build installer แล้วขึ้น GitHub Release" — bumping the version, updating CHANGELOG, building the signed Inno Setup installer and publishing the GitHub Release that the in-app updater reads.
---

# OCompare: commit + push + Release

ออกเวอร์ชันใหม่ครบวงจร: bump เวอร์ชัน → CHANGELOG → test/build/sign → commit → push → publish GitHub Release ตอบผู้ใช้เป็นภาษาไทย คงศัพท์เทคนิคเป็นภาษาอังกฤษ

pipeline จริง (build, ลงลายเซ็น, checksum, draft → publish, resume) เป็นของ repo ไม่ใช่ของ skill นี้ — ใช้ `npm run ...` ที่มีอยู่ ห้ามสร้างขั้นตอนเหล่านั้นขึ้นใหม่ อ้างอิงเต็ม: `docs/RELEASING.md` และ `.agents/skills/release-publish/SKILL.md`

## ข้อเท็จจริงของโปรเจกต์ (ห้ามเดา)

| เรื่อง | ค่า |
|---|---|
| Repo | `origin` = `kriangdet-chuaboonjun/OCompare` (**public**, เป็นทั้งโค้ดและที่แจก Release ไม่มี repo แยก) branch `main` |
| เวอร์ชัน 3 จุด + lock | `package.json`, `src-tauri/Cargo.toml` (`[package] version`), `src-tauri/tauri.conf.json` และ lock: `package-lock.json` (2 ตำแหน่ง: บนสุดกับ `packages[""]`), `src-tauri/Cargo.lock` (package `o-compare-rust`) |
| Release notes | section `## [X.Y.Z] - YYYY-MM-DD` ใน `CHANGELOG.md` (ภาษาอังกฤษ เหนือ section เก่า คง `## [Unreleased]` ไว้บนสุด) — ข้อความนี้ถูกฝังใน `latest.json` และหน้า Release |
| Tag | `vX.Y.Z` — publisher สร้างให้เอง ห้ามสร้างเองด้วย `git tag` |
| Commit release | `chore(release): prepare X.Y.Z` |
| Output ที่ `release/` (gitignored) | `OCompare-X.Y.Z-portable.exe`, `OCompare-X.Y.Z-x64-setup.exe`, `.exe.sig`, `latest.json`, `SHA256SUMS.txt` (รวม 5 ไฟล์ที่ publisher อัปโหลด) |
| Updater manifest | `https://github.com/kriangdet-chuaboonjun/OCompare/releases/latest/download/latest.json` |
| ลายเซ็น updater | key อยู่นอก repo `%USERPROFILE%\.config\OCompare\signing\` (password ผูก DPAPI) — **ห้าม commit, พิมพ์, อัปโหลด, สร้าง key ใหม่** (client เดิมเชื่อ public key เดิม) |
| ห้ามแตะ | draft/prerelease (publisher ไม่ออก prerelease), visibility ของ repo, การลบ release/draft, การเขียนทับ asset |

## ขั้นตอน

### 0. ตรวจสถานะก่อนเริ่ม

```powershell
git status -sb
git log --oneline -3
gh auth status
gh release list --repo kriangdet-chuaboonjun/OCompare --limit 3
Select-String -Path package.json,src-tauri/Cargo.toml,src-tauri/tauri.conf.json -Pattern '"?version"?\s*[:=]'
Get-Content CHANGELOG.md -TotalCount 12
Test-Path "$env:USERPROFILE\.config\OCompare\signing"
```

working tree มักมีงานที่ยังไม่ commit ของผู้ใช้ปะปนอยู่ (native/, docs/, scripts ฯลฯ) — **ห้าม `git stash` / `reset` / `checkout --`** และห้ามรวมไฟล์ที่ไม่เกี่ยวกับรุ่นนี้ จากนั้นดูว่าอยู่ขั้นไหน:

| สถานะ | ทำต่อที่ |
|---|---|
| มีไฟล์แก้ค้าง เวอร์ชันใน repo = Release ล่าสุด | ขั้น 1 |
| เวอร์ชันใน repo ใหม่กว่า Release ล่าสุด แต่ยังไม่ commit | ขั้น 2–3 |
| commit แล้วแต่ยังไม่ push (`ahead`) | ขั้น 6 |
| push แล้ว ไม่มี Release ของเวอร์ชันนั้น | ขั้น 7 (ถ้ายังไม่มีไฟล์ใน `release/`) |
| มี draft ค้างของ commit นี้ | `npm run publish:release -- --resume-draft` |
| ไม่มีอะไรเปลี่ยน และเวอร์ชันตรง Release ล่าสุด | หยุด แจ้งผู้ใช้ว่าไม่มีอะไรให้ออก |

ต้องอยู่บน `main`, `gh` login แล้ว และโฟลเดอร์ signing มีอยู่ (เช็กแค่การมีอยู่ ไม่อ่านเนื้อหา) ถ้าไม่มี key ให้หยุดและบอกผู้ใช้ — ห้ามสร้าง key ใหม่

### 1. กำหนดเวอร์ชัน

ใช้เวอร์ชันที่ผู้ใช้ระบุ ถ้าไม่ระบุให้ +1 ที่ patch จากค่าที่มากกว่าระหว่างเวอร์ชันใน repo กับ Release stable ล่าสุด (รวม draft) เช่น 0.4.16 → 0.4.17 แจ้งผู้ใช้ว่าใช้เลขอะไร ห้ามใช้เลขที่เคย publish แล้ว

แก้ครบทุกจุดในตาราง (ใช้ Edit เฉพาะบรรทัด ไม่เขียนทับทั้งไฟล์) แล้วตรวจว่าตรงกันทั้งหมด:

```powershell
Select-String -Path package.json,package-lock.json,src-tauri/Cargo.toml,src-tauri/tauri.conf.json -Pattern '"?version"?\s*[:=]\s*"?X\.Y\.Z' 
```

### 2. เขียน CHANGELOG

อ่านการเปลี่ยนแปลงจริงจาก `git log <tag ล่าสุด>..HEAD --oneline` และ `git diff HEAD --stat` แล้วย้ายประเด็นที่เกี่ยวข้องจาก `## [Unreleased]` (หรือเขียนใหม่) ไปเป็น `## [X.Y.Z] - YYYY-MM-DD` ใช้วันที่ปัจจุบันของผู้ใช้ รูปแบบเดิม:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

- <สิ่งที่ผู้ใช้เห็นหรือได้ประโยชน์ ข้อละประเด็น ภาษาอังกฤษ>
```

เขียนเป็นภาษาผู้ใช้ปลายทาง ไม่ใช่ชื่อไฟล์/ฟังก์ชัน ไม่ใส่ path เครื่อง ข้อมูลส่วนตัว หรือความลับ — ข้อความนี้เป็นสาธารณะ section ว่างทำให้ publisher หยุด

### 3. ตรวจคุณภาพ + build (ต้องผ่านทั้งหมด)

ใช้ PowerShell (Git Bash อาจหา `cargo` ไม่เจอ) และห้ามรัน UI test พร้อมกัน เพราะแต่ละไฟล์ใช้ port คงที่:

```powershell
npm ci
npm test
npm audit
npm run build:win
npm run publish:release -- --dry-run
node scripts/test-release-signature.mjs
```

ต้องได้ 5 ไฟล์ใน `release/` ที่ชื่อมีเลขเวอร์ชันตรงกับที่ตั้งใจ (ถ้า Inno Setup ไม่พบ: `winget install JRSoftware.InnoSetup`) test ล้ม / `npm audit` พบช่องโหว่ / dry-run หรือ signature test ไม่ผ่าน → หยุดและรายงานผลจริง แก้ที่ต้นเหตุ ห้ามข้าม และห้ามแก้ไฟล์ใน `release/` หลังตรวจแล้ว ถ้าเปลี่ยนโค้ดหลัง build ต้อง build ใหม่

### 4. ขออนุมัติก่อนส่งออกนอกเครื่อง

push และ Release เป็นการเผยแพร่ (repo + Release เป็น public และ client ทุกเครื่องจะได้รับแจ้งอัปเดต) จึงสรุปให้ผู้ใช้ดูครั้งเดียว: เวอร์ชัน, รายการไฟล์ที่จะ commit, ข้อความ commit, ข้อความ CHANGELOG, ขนาด asset แล้วรอคำตอบว่าให้ไปต่อ ข้ามได้เฉพาะเมื่อผู้ใช้บอกในคำสั่งนี้ชัดเจนว่าให้ทำต่อโดยไม่ต้องถาม การอนุมัติขั้นนี้ไม่ครอบคลุมการลบหรือเขียนทับอะไรทั้งสิ้น

### 5. Commit

stage ตามชื่อไฟล์เท่านั้น ห้าม `git add -A` / `git add .` (กัน `release/`, ไฟล์ของผู้ใช้ที่ไม่เกี่ยว, ข้อมูล signing หลุด):

```powershell
git add CHANGELOG.md package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json <ไฟล์ src/tests ที่แก้และเกี่ยวกับรุ่นนี้>
git status -sb      # ตรวจรายการ staged อีกรอบ
git commit          # ข้อความตามด้านล่าง
```

บรรทัดแรกเป๊ะ ๆ: `chore(release): prepare X.Y.Z` (ถ้ามีงานโค้ดที่ยังไม่ commit ให้แยกเป็น commit `feat:`/`fix:` ก่อน แล้วค่อย commit release) ปิดท้ายด้วยบรรทัด Co-Authored-By ตามที่ระบบกำหนด ห้าม `--no-verify`

publisher **ปฏิเสธ checkout ที่ไม่สะอาด** หรือ HEAD ที่ไม่ตรงกับ `origin/main` — ถ้ามีไฟล์ของผู้ใช้ที่ไม่เกี่ยวค้างอยู่จนทำให้ tree สกปรก ให้บอกผู้ใช้และถามวิธีจัดการ ห้ามทิ้งหรือ commit แทน

### 6. Push

```powershell
git push origin main
git rev-parse HEAD origin/main     # ต้องเป็น hash เดียวกัน
```

ห้าม force push ถ้าถูกปฏิเสธให้ fetch แล้วรายงานความต่าง ห้าม rebase/merge เองโดยไม่ได้รับคำสั่ง

### 7. Publish

```powershell
npm run publish:release
```

publisher ตรวจ checkout/remote/ลายเซ็น/checksum สร้าง draft อัปโหลด 5 ไฟล์ ดาวน์โหลดกลับมาเทียบ byte แล้วจึง publish เป็น latest ถ้าพังกลางทาง ให้คง commit และไฟล์ใน `release/` เดิมไว้ แล้วรัน:

```powershell
npm run publish:release -- --resume-draft
```

ห้ามลบ release/draft, ห้ามเขียนทับ asset ที่สมบูรณ์, ห้ามสร้าง prerelease ด้วยมือ (endpoint release-by-tag ไม่เห็น draft ให้ดูผ่าน list ของ releases)

### 8. ตรวจผลจริงออนไลน์

```powershell
$r = gh api repos/kriangdet-chuaboonjun/OCompare/releases/latest | ConvertFrom-Json
$r.tag_name; $r.draft; $r.prerelease; $r.target_commitish
$r.assets | Select-Object name, size
(Invoke-WebRequest -UseBasicParsing https://github.com/kriangdet-chuaboonjun/OCompare/releases/latest/download/latest.json).Content | ConvertFrom-Json | Select-Object version, notes
git rev-parse HEAD
```

ต้องเห็น: `tag_name` = `vX.Y.Z`, `draft`/`prerelease` = False, tag ชี้ commit ที่ตั้งใจ, มี asset ครบ 5 ไฟล์ (setup, portable, `.sig`, `latest.json`, `SHA256SUMS.txt`), และ `latest.json` สาธารณะ (ดึงโดยไม่ใส่ credential) แสดงเวอร์ชันใหม่กับ URL ของ installer ที่ใช้ tag ของเวอร์ชัน ถ้าข้อใดไม่ตรง → รายงานว่ายังไม่สำเร็จ ห้ามบอกว่าเสร็จ

### 9. รายงานผู้ใช้

บอก: เวอร์ชัน, hash ของ commit ที่ push, ลิงก์ Release, ผลการตรวจในขั้น 8, path ของ installer ในเครื่อง และสิ่งที่ไม่ได้ตรวจ — โดยเฉพาะการอัปเดตจริงจากตัวติดตั้ง/portable ใน Windows Sandbox หรือ VM (รายการใน `docs/RELEASING.md`) ห้ามอ้างว่าทดสอบ installer แล้วจากผล browser test อย่างเดียว

## ข้อผิดพลาดที่พบบ่อย

- แก้เวอร์ชันไม่ครบ (ลืม `Cargo.lock`, `package-lock.json` หรือ `tauri.conf.json`) → publisher/signature test ล้มเพราะเวอร์ชันปนกัน
- ลืมเพิ่ม section `## [X.Y.Z]` ใน CHANGELOG → notes ว่าง publisher หยุด
- `git add -A` ทำให้ไฟล์ที่ไม่เกี่ยว (หรือ `release/`) เข้า commit
- push ไม่ครบก่อน publish → HEAD ไม่ตรง `origin/main` publisher ปฏิเสธ
- build แล้วแก้โค้ดต่อโดยไม่ build ใหม่ → artifact ไม่ตรงกับ commit
- สร้าง tag เอง หรือสร้าง signing key ใหม่ → ทำให้ client เดิมอัปเดตไม่ได้
- รัน UI test หลายตัวพร้อมกัน → port ชนกัน
