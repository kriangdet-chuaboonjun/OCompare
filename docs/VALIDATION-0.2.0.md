# Folder Comparison — ผลตรวจรุ่น 0.2.0

วันที่ 19 ตุลาคม 2026, Windows x64

## ฟังก์ชันที่เพิ่ม

- โหมด Files / Folders ในหน้าต่างเดิม โดยสลับโหมดแล้วไม่ล้าง Monaco models/undo history
- เปรียบเทียบ recursive รวมโฟลเดอร์ว่าง/ไฟล์ซ่อนและ binary จาก bytes จริง อ่านครั้งละ 64 KiB
- Tree table สองฝั่งจัดแถวและเลื่อนร่วมกัน พับ/ขยาย พร้อมกรอง Identical / Different / Left only / Right only / Error / Skipped
- สีแยกสถานะร่วมกับข้อความและสัญลักษณ์ ไม่ใช้สีอย่างเดียว
- Progress, Cancel, Refresh และ Swap; Cancel/error เก็บผลที่สำเร็จครั้งก่อน และผล request เก่าไม่ทับงานใหม่
- เปิดคู่ไฟล์ข้อความด้วยดับเบิลคลิก/Enter โดยตรวจ unsaved edits และเตรียมไฟล์ทั้งสองให้ครบก่อนเปลี่ยน models
- Tree renderer วาดเฉพาะแถวใน viewport และเลื่อน parent กลับมาให้เห็นเมื่อใช้ ArrowLeft จากรายการที่อยู่ไกลในต้นไม้
- ไม่มี copy/move/delete/sync โฟลเดอร์ หรือ recursive directory watcher ในรุ่นนี้

## หลักฐานอัตโนมัติ

| การตรวจ | ผล |
|---|---|
| TypeScript typecheck | ผ่าน |
| Frontend production build | ผ่าน; warning ขนาด Monaco chunk ตามเดิม |
| Rust formatting / Clippy `-D warnings` | ผ่าน |
| Rust integration tests | 21 tests ผ่าน: fileio 5, folder comparison 11, watchers 5 |
| Monaco regression | 7 สถานการณ์ผ่าน |
| Folder filter/tree logic | ancestor retention, collapse, empty folders, empty filters, type conflict ผ่าน |
| Folder UI | 8 สถานการณ์ผ่านใน Edge headless ทั้ง 1400×900 และ 1000×700 โดยไม่มี page errors |
| Final installer | ติดตั้ง/เปิด/ถอนรุ่น 0.2.0 ผ่าน exit code 0 และลบไฟล์ทดสอบแล้ว |
| Release checksums | SHA-256 ของ installer และ portable ตรงกับ SHA256SUMS.txt |

รายละเอียดอยู่ใน `evidence/tests-0.2.0.log` และ `evidence/folder-ui-tests.json`

ชุด folder tests ตรวจไฟล์ขนาดเท่ากันแต่เนื้อหาต่าง, ไฟล์ว่าง, binary, difference ท้ายไฟล์ที่ยาวกว่า 64 KiB, วันแก้ไขต่างแต่เนื้อหาเท่ากัน, nested/empty directories, ไทย/ช่องว่าง, file-directory conflict, Windows case pairing, ไฟล์เปลี่ยนระหว่างตรวจ, invalid roots, cancel/new job, junction loop และไฟล์ที่ถูกล็อกให้อ่านไม่ได้พร้อมตรวจว่ารายการอื่นยังทำต่อได้

UI harness ใช้หน้าจอแอปจริงและ Rust scanner/fileio ผ่าน CLI transport บน localhost โดยอ่านเขียนเฉพาะ isolated temporary fixtures ไม่ได้จำลองผลเปรียบเทียบไฟล์ คำตอบ native dialogs ใน browser เป็น test doubles; native IPC ตรวจแยกใน executable จริง มี fixture กว่า 400 ไฟล์และตรวจว่า DOM วาดแถวจริงน้อยกว่า 100 แถวใน viewport

Browser plugin/skill ไม่อยู่ในรายการ session จึงใช้ Playwright + Edge headless สำหรับ browser tests

## Native Windows ที่ตรวจจริง

เปิด release executable จริงโดยไม่มี dev server หรือ Node.js เป็น runtime ของแอป แล้วตรวจด้วย Windows UI Automation:

1. Files แสดง sample SQL สองฝั่งได้; สลับเข้า Folders และเห็น controls ครบ
2. ปุ่ม Browse เปิด native Select Folder dialog ได้
3. กรอก roots `samples/folders/left` และ `samples/folders/right` ผ่านช่อง path ของแอป
4. กด Compare ผ่าน Tauri IPC ได้ `5 files · 1 folders | Identical 2 · Different 1 · Left only 1 · Right only 1 · Errors 0 · Skipped 0`
5. เห็นสีและ tree alignment ของทั้งสองฝั่ง รวม nested directory
6. ดับเบิลคลิก `changed.sql` เปิด Monaco สอง path ได้จริง แสดง 47/49 bytes และ 1 difference section
7. ปิดหน้าต่างทดสอบที่ไม่มี unsaved edits ได้

หลักฐาน: `evidence/native-folder-checks-0.2.0.json`, `evidence/folders-native-0.2.0.jpg`, `evidence/folder-open-native-0.2.0.jpg`

ภาพจาก headless: `evidence/folders-0.2.0-desktop.png`, `evidence/folders-0.2.0-compact.png`

## Build และการติดตั้ง

ไฟล์ส่งมอบ:

- `release/O_Compare-Rust-0.2.0-x64-setup.exe`
- `release/O_Compare-Rust-0.2.0-portable.exe`
- `release/SHA256SUMS.txt`

ใช้ชื่อ/app ID เดิมของ Rust จึงอัปเดตรุ่น Rust ได้ และยังแยกจาก Electron ใช้ WebView2 runtime ของเครื่อง ไม่มีการเพิ่มเวอร์ชันอัตโนมัติใน build command หลักฐาน build อยู่ใน `evidence/build-win-0.2.0.log`

ผลติดตั้ง/เปิด/ถอนการติดตั้งรุ่นสุดท้ายบันทึกใน `evidence/install-test.json` ซึ่งสคริปต์อ่าน version ปัจจุบันจาก package.json และจะปฏิเสธหากพบการติดตั้งของผู้ใช้อยู่ก่อน

รุ่นสุดท้าย: portable 12,536,832 bytes, installer 5,747,201 bytes ผลทดสอบติดตั้งและถอน exit code 0 ทั้งคู่ เปิดแอปแล้วได้ชื่อหน้าต่าง `left.sql <--> right.sql - O_Compare Rust v0.2.0` และ WebView2 process จริง

## ข้อจำกัดที่ยังต้องระบุ

- Native directory picker เปิดได้ แต่การเลือก path ภายใน modal ยังไม่ยืนยันครบ เพราะเครื่องมือควบคุมพบ cached-element/geometry errors การกรอก path แล้วเปรียบเทียบจริงผ่านแล้ว
- Native Windows DPI 150% ไม่ได้เปลี่ยน/ทดสอบโดยตรง; ตรวจ responsive viewports แบบ headless แล้ว ไม่ถือว่าแทน native DPI proof
- Native unsaved confirmation ทุกรูปแบบและ Cancel ระหว่างสแกนต้นไม้ใหญ่มากยังไม่ได้ตรวจด้วยมือ; core cancellation และ UI guard ผ่าน automated tests แล้ว
- Metadata ก่อน/หลังอ่านช่วยตรวจการเปลี่ยนไฟล์ แต่การสแกนไม่ได้ใช้ filesystem snapshot จึงไม่รับประกัน snapshot consistency เมื่อโปรแกรมภายนอกแก้หลายไฟล์พร้อมกัน
- Windows reparse points รวม cloud placeholders บางชนิดแสดง Skipped; ไม่มีการติดตาม link ออกนอก root
- Error/Skipped ไม่ถูกสรุปเป็น Identical; รายละเอียดดูจาก tooltip ของ row
- ไม่มี code signing หรือ auto-update

## รันตรวจซ้ำ

```powershell
npm ci
npm run typecheck
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run build:win
./scripts/test-install.ps1
```

โปรเจกต์ Electron ต้นฉบับไม่ได้ถูกแก้ไข โดยตรวจเทียบ SHA-256 กับ manifest 22 ไฟล์ที่เก็บไว้ตั้งแต่เริ่มย้าย
