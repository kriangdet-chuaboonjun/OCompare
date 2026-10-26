# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ภาพรวม

OCompare เป็นแอปเดสก์ท็อป Windows x64 สำหรับเปรียบเทียบ/แก้ไขไฟล์ข้อความสองฝั่ง (Monaco) และเปรียบเทียบโฟลเดอร์ ใช้ Tauri 2 + Rust (backend) + TypeScript/Vite (renderer ไม่มี framework) โค้ดเดิมเป็น Electron ทั้งหมดเขียนใหม่แล้ว เอกสารในโปรเจกต์ส่วนใหญ่เป็นภาษาไทย ให้ตอบผู้ใช้เป็นภาษาไทย และคงศัพท์เทคนิคเป็นภาษาอังกฤษ

## คำสั่งที่ใช้บ่อย

ต้องใช้ Node 24+ และ Rust toolchain (เป้าหมาย Windows เท่านั้น)

```powershell
npm ci
npm run dev            # แอปเต็ม (tauri dev)
npm run dev:web        # renderer อย่างเดียวที่ http://127.0.0.1:1420 (ไม่มี native IPC)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + vite build
npm test               # ทุกชุดทดสอบ (test:rust, editor, folders, theme, accessibility, updater)
npm run test:rust      # cargo test --manifest-path src-tauri/Cargo.toml
npm run build:win      # build installer ที่ลงลายเซ็น (ดู docs/RELEASING.md)
```

รันทดสอบเดี่ยว:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --test folder_ignore          # ไฟล์ใน src-tauri/tests/
cargo test --manifest-path src-tauri/Cargo.toml --test folders job_           # กรองด้วยชื่อ test
node scripts/test-folder-tabs.mjs                                             # UI test เดี่ยว (Playwright + Edge)
node --disable-warning=ExperimentalWarning scripts/test-folder-model.mjs      # test ที่ import .ts โดยตรง ต้องใช้ flag นี้
```

- UI test (`scripts/test-*.mjs`) ใช้ Playwright กับ `channel: 'msedge'` และ **ต้อง build examples ก่อน**: `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --examples` (`npm run test:folders` ทำให้เอง) แต่ละไฟล์ใช้ port ของตัวเอง (1422–1455) ห้ามรันซ้อนกัน port ซ้ำ
- `npm run` อาจหา `cargo` ไม่เจอใน Git Bash ให้รันขั้นตอนใน script ทีละคำสั่งหรือใช้ PowerShell
- feature `desktop` (default) ดึง tauri เข้ามา; `--no-default-features` คอมไพล์เฉพาะ core library ที่ test/examples ใช้ได้เร็วกว่า
- ไม่มี linter แยก ใช้ `npm run typecheck`
- ห้ามใช้ `git stash`/`reset` กับ working tree: มีงานที่ยังไม่ commit ของผู้ใช้ (เช่น native/, docs/, release scripts) ปะปนอยู่เสมอ

## สถาปัตยกรรม

### สามชั้น

- `src-tauri/src/` — logic ทั้งหมดอยู่ใน library crate `o_compare_rust` ที่ **ไม่ขึ้นกับ Tauri**; เฉพาะ `commands.rs` (และ `run()` ใน `lib.rs`) อยู่หลัง `#[cfg(feature = "desktop")]` และทำหน้าที่เป็น adapter บางๆ (`spawn_blocking` + `emit_to("main", …)`) เหตุผล: integration tests และ `examples/` เรียก core โดยตรง
- `src/shared/` — type ที่ใช้ร่วม (`FolderApi`, `OCompareApi`, installGuard, updater) เป็นสัญญาระหว่าง renderer กับ Rust (JSON เป็น camelCase ฝั่ง Rust ใช้ `serde(rename_all = "camelCase")`)
- `src/renderer/` — UI; `platform.ts` เป็นจุดเดียวที่เรียก `invoke`/`listen` ของ Tauri

### Test harness ที่ใช้ Rust จริง

`scripts/folder-test-server.mjs` เปิด Vite dev server แล้ว **สลับ `./platform` ที่ `main.ts` import ไปเป็น `tests/folder-platform.ts`** ซึ่งส่ง request ผ่าน HTTP ไปยัง `src-tauri/examples/folder-workspace.rs` (JSON-lines บน stdin/stdout) ดังนั้น UI test ใช้ filesystem และ Rust core จริง ไม่ใช่ mock เมื่อเพิ่ม/เปลี่ยน signature ของ API ใน `FolderApi` ต้องแก้ครบสี่ที่: `src/shared/folders.ts`, `platform.ts`, `tests/folder-platform.ts`, `examples/folder-workspace.rs` (+ `commands.rs`, `lib.rs` generate_handler และ `capabilities/main.json` ถ้าเป็น command ใหม่)

### โหมด Files

`main.ts` เป็นตัวประสานงานใหญ่ `FileTabs` (fileTabs.ts) ถือแท็บ แต่ละแท็บมี `SideState` สองฝั่ง; **ไฟล์ path เดียวกันใช้ Monaco model ตัวเดียวร่วมกันทุกแท็บ** (`documentKey` normalize path) `DiffView` คือ Monaco diff editor ตัวเดียวที่ `attach()` เข้ากับแท็บที่ active Save ผ่าน `WriteService` (Rust) ที่ทำ backup/history และ atomic replace; ไฟล์ถูก watch ผ่าน `watch_file` Regex rules และ normalization ใช้ engine ของ Rust (`comparison_rules.rs`) ทั้ง Files และ Folders ไม่ใช่ JS regex

### โหมด Folders (หลายแท็บ)

- `FolderTabs` (folderTabs.ts) มี `FolderController` + `FolderView` + panel ของตัวเองต่อแท็บ; สลับแท็บเปลี่ยนแค่ `hidden` จึงทำให้ Compare ทำงานเบื้องหลังต่อได้ สถานะ (roots, result, rules, `ignoredFolders`, filter, selection, log, watch) อยู่ใน instance ต่อแท็บ id ใน DOM ต้องไม่ซ้ำ (view ใส่ suffix เอง); ปุ่ม toolbar ของทุกแท็บถูกย้ายไป `#folder-tools` และซ่อนด้วย `hidden` ดังนั้น selector ใน test ต้องกำหนดขอบเขตเป็น `.folder-tab-panel:not([hidden])` หรือ `#folder-tools .folder-toolbar:not([hidden])`
- `FolderTabs` ทำหน้าที่เป็น `FolderGuard` ข้ามแท็บด้วย: Copy ทำได้ทีละงานทั้งแอปและต้องไม่มี Compare ทำงาน แท็บที่กำลัง Copy ปิดไม่ได้ ฝั่ง Rust บังคับกติกาเดียวกันใน `FolderJobs` (`begin` = compare, `begin_copy` = เอกสิทธิ์) งานแยกตาม `requestId` ไม่ยกเลิกกัน
- Watch แยกตาม `tabId` (`FolderWatchService`; generation ไม่ซ้ำข้ามแท็บ renderer กรองด้วย tabId + generation)
- `SessionStorage` (folderSessions.ts) เป็น store เดียวของทุกแท็บ และ serialize การเขียน (read-modify-write บนข้อมูลล่าสุด) เพื่อกันเขียนทับกัน; Rust ตรวจ/เขียนแบบ atomic (`folder_sessions.rs`) และไม่ทับไฟล์ที่เสีย
- Ignore folder: เก็บเป็น relative path (`src/generated`) ใน `FolderCompareOptions.ignoredFolders` Rust ตรวจใน `validate_ignored_folders` (ใช้ซ้ำใน sessions) และ `folder_scan.rs` ข้าม subtree ก่อนอ่านลูก; `CopyService::plan_with_ignored` ใช้ list เดียวกัน การสแกน/ตัดสินสถานะ/คัดลอกอยู่ใน `folder_scan.rs` / `folders.rs` / `folder_copy.rs` (plan → preview → execute พร้อม fingerprint ตรวจว่าไฟล์ไม่เปลี่ยน และ backup ก่อน overwrite)
- เมนูคลิกขวาเป็น component ใน `contextMenu.ts`; `FolderView.openMenu` ประกอบรายการ

### Startup, Explorer, Update

- `startup.rs` แปลง argument (`--compare` หรือสอง path) เป็น Files/Folders; ไม่มี single-instance แต่ละการเปิดคือหน้าต่างใหม่
- `native/` คือ C++ `IExplorerCommand` DLL + sparse MSIX สำหรับเมนู Windows Explorer (ดู `docs/EXPLORER-INTEGRATION.md`) แยกจากแอปหลัก
- Updater: `shared/updater.ts` + `WorkspaceInstallGuard` ต้องหยุดงานโฟลเดอร์และจัดการเอกสารที่ยังไม่บันทึกทุกแท็บก่อนติดตั้ง portable build ไม่ติดตั้งตัวเอง (`is_portable`)

## Release

ต้องซิงก์เวอร์ชันใน `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` และ lock files, และมี section `## [version]` ใน `CHANGELOG.md` ขั้นตอนอยู่ใน `docs/RELEASING.md` และ skill `.agents/skills/release-publish` (installer ใช้ Inno Setup, ลายเซ็น updater ใช้ key นอก repo ห้าม commit หรือสร้าง key ใหม่) งานพัฒนาปกติไม่ต้อง build installer หรือเผยแพร่ release
