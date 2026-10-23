# ผลตรวจ O_Compare Rust 0.1.5

วันที่ 19 ตุลาคม 2026 — Windows x64

## สถานะการส่งมอบ

สร้าง source ของ Tauri + Rust + Monaco และไฟล์ release สำเร็จ รุ่นนี้ติดตั้งแยกจาก Electron ด้วย app ID `th.co.fusionsoft.ocompare.rust` ไม่ได้ติดตั้งค้างไว้หลังจบทดสอบ

| ไฟล์ | ขนาด |
|---|---:|
| `release/O_Compare-Rust-0.1.5-portable.exe` | 12,389,888 bytes / 11.82 MiB |
| `release/O_Compare-Rust-0.1.5-x64-setup.exe` | 5,701,715 bytes / 5.44 MiB |
| portable Electron เดิม | 120,325,875 bytes / 114.75 MiB |

portable ใหม่เล็กลง 89.70% โดยยังพึ่ง WebView2 ของเครื่อง ไม่รวมขนาด runtime ที่ติดตั้งแยก ค่า SHA-256 อยู่ใน `release/SHA256SUMS.txt`

## การตรวจที่ผ่าน

| การตรวจ | ผล / หลักฐาน |
|---|---|
| TypeScript | `npm run typecheck` ผ่าน |
| Frontend production build | `npm run build` ผ่าน; มี warning ขนาด Monaco chunk ที่เกิน 500 kB |
| Rust formatting | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` ผ่าน |
| Rust lint | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` ผ่าน |
| Rust integration tests | 10 tests ผ่าน — `evidence/tests.log` |
| Encoding parity | oracle 10 ไฟล์สร้างโดยรัน `fileio.ts` ของต้นฉบับโดยไม่แก้ไข ตรวจทั้ง text, encoding, BOM, EOL และ byte roundtrip |
| Encoding failure | invalid UTF-8/UTF-16, unknown encoding และตัวอักษรที่ Windows-874 encode ไม่ได้คืน error; กรณี encode ไม่ได้ไฟล์เดิมไม่เปลี่ยน |
| Filesystem | path ภาษาไทย/ช่องว่าง, missing path, directory และ read-only file ผ่าน |
| Watchers | external writes, replace file, own save suppression, external revert กลับเป็น bytes ของ save เก่า, เปลี่ยน/ยกเลิก watcher, สองฝั่งเปิดไฟล์เดียวกัน และชื่อไฟล์ต่างตัวพิมพ์บน Windows ผ่าน |
| Monaco | 7 สถานการณ์ผ่านใน Edge headless 1400×900; ไม่มี page errors — `evidence/editor-tests.json` |
| Native release | เปิด executable จริงพร้อมสอง sample paths และได้ชื่อหน้าต่าง `left.sql <--> right.sql - O_Compare Rust v0.1.5` |
| NSIS | ติดตั้งแบบเงียบรายผู้ใช้, พบ executable, เปิดผ่าน WebView2 และถอนการติดตั้ง exit code 0 — `evidence/install-test.json` |
| Cleanup | โฟลเดอร์ `.test-install` และ uninstall registry ของ O_Compare Rust ถูกลบโดยขั้นตอนทดสอบแล้ว |
| ต้นฉบับ | SHA-256 ของ source/config/assets/samples ทั้ง 22 ไฟล์ตรงกับก่อนเริ่ม — `evidence/source-hashes.json` |

Monaco scenarios ครอบคลุม copy section, selected-line mapping, reverse copy, insert/delete ที่มีฝั่งว่าง, undo/redo และ dirty state, Minor, All/Diffs/Context, Wrap, Swap, Next/Prev และการพิมพ์เพิ่มระหว่างรอผล save

Browser plugin/skill ไม่ได้อยู่ในรายการ session จึงใช้ Playwright กับ Edge headless การทดสอบ editor instantiate Monaco และ DiffView จริง ไม่ได้ mock Tauri API ภาพ `evidence/monaco-headless.png` เป็น editor harness เท่านั้น ไม่ใช่หลักฐานหน้าจอแอป native เต็มหน้า

## การวัดประสิทธิภาพและข้อจำกัด

`scripts/measure-release.ps1` เปิดทั้งสอง release สลับกันสามรอบด้วย sample arguments เดียวกัน เก็บ working set/private memory รวม process tree หลังรอ 2 วินาที โดยไม่ล้าง OS cache

- Tauri วัดเวลาจนชื่อหน้าต่างแสดงสองไฟล์ได้ 836.0, 706.5 และ 704.4 ms (ค่ากลาง 706.5 ms)
- Electron ที่เปิดแบบซ่อนหน้าต่างไม่ให้ชื่อหน้าต่างที่ใช้ยืนยันจุดพร้อมทำงานได้ จึงบันทึก startup time เป็น `null`
- ตัวเลข RAM อยู่ใน `evidence/release-measurements.json` แต่จุดพร้อมทำงานยังไม่เท่ากัน จึงไม่สรุปเปอร์เซ็นต์ประหยัด RAM หรือความเร็วเทียบกัน
- การลองเปิด Electron พร้อมพอร์ต debug เพื่ออ่านจุดพร้อมทำงานถูกระบบตรวจอนุมัติอัตโนมัติปฏิเสธด้วยข้อความ `blocked by policy` จึงหยุดใช้วิธีนั้น

## สิ่งที่ยังไม่ได้ยืนยันครบ

การควบคุมแอปผ่าน Computer Use ถูกหยุดด้วยปุ่ม Escape จึงไม่มีการใช้ Computer Use ต่อในรอบนี้ สิ่งต่อไปนี้ต้องตรวจบน native UI เพิ่มก่อนถือว่าผ่านเกณฑ์ทั้งหมดของแผน:

- ภาพหน้าจอ Electron และ Tauri เต็มหน้าเทียบกันที่หน้าต่าง/scaling เดียวกัน
- ปุ่ม Open/Save As และการยกเลิก dialog จริง รวมถึง close warning ทั้ง Cancel/Discard
- drag/drop จริงจาก Explorer ทั้งไฟล์เดียว/สองไฟล์ ที่ scaling 100% และ 150%
- คีย์ลัดทุกตัวและการคลิกลูกศรลอยบน WebView2 จริง (core copy/navigation ผ่าน headless แล้ว)
- UI auto-reload เมื่อมี/ไม่มี unsaved edits และการ Swap ขณะ watcher ทำงาน (backend watcher ผ่าน integration tests แล้ว)
- การอ่าน encoding กับไฟล์ legacy จริงนอก corpus โดยเฉพาะไฟล์สั้น/กำกวม; chardetng และ jschardet ไม่ได้รับประกันว่าจะเดาตรงกันทุกกรณี

`npm audit` รายงาน low severity 2 รายการใน Monaco/DOMPurify dependency chain โดยยังคง Monaco 0.57.0 ตามแผน ไม่ได้ downgrade หรือใช้ `audit fix --force`

ไม่มี code signing และไม่มีระบบ auto-update ในรุ่นนี้

## รันตรวจซ้ำ

```powershell
npm ci
npm run typecheck
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:win
```

`npm test` ต้องมี cargo ใน PATH และ Edge browser; `test:rust` และ `test:editor` เรียกแยกกันได้

ทดสอบ installer แบบติดตั้งแล้วถอนอัตโนมัติ:

```powershell
./scripts/test-install.ps1
```

สคริปต์จะปฏิเสธหากมี O_Compare Rust ติดตั้งอยู่ก่อน เพื่อไม่แทนการติดตั้งของผู้ใช้
