# O_Compare 0.4.1 — Build validation

วันที่: 21 ตุลาคม 2026 (Asia/Bangkok)

- ปรับเวอร์ชันแอปใน `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` และ `src-tauri/tauri.conf.json` เป็น 0.4.1 ตรงกัน ไม่เปลี่ยนเวอร์ชัน dependencies
- รวมการแก้ UI/accessibility จาก `VALIDATION-AUDIT-FIXES-2026-10-21.md` และอัปเดตชื่อไฟล์ส่งมอบใน README
- TypeScript typecheck, Vite production build, Rust release build และ NSIS bundling ผ่าน; PE ProductVersion/FileVersion ของ Portable และ Setup เป็น 0.4.1
- Native C++ tests: `native failures: 0`
- เปิด Portable จริงกับ sample SQL สองฝั่ง ได้ title `O_Compare v0.4.1`, แสดง 5 difference sections และโหลด toolbar bitmap 128 px ยืนยัน sample hashes ก่อน/หลังตรงกัน
- ตรวจ SHA-256 ของไฟล์ใน `release/` ตรงกับ build outputs และ `release/SHA256SUMS.txt`

| ไฟล์ | Bytes | SHA-256 |
| --- | ---: | --- |
| `release/O_Compare-0.4.1-portable.exe` | 14,228,992 | `280fa70b40b41ee583512c301a47a573d122d58e5f85bb9bb3597390106fded3` |
| `release/O_Compare-0.4.1-x64-setup.exe` | 5,805,838 | `9c883e95f096a1f830a54616a8d96a952240f37f7b9dec6f7d2c5ebbe21f9cb8` |

## Packaging recovery

`npm run build:win` สร้าง executable, Setup, Portable และ checksum สำเร็จ แต่จบด้วย exit 1 ในขั้นคัดลอก Explorer integration เพราะ Windows ล็อก `release/explorer-integration/resources/explorer/OCompare.Explorer.dll`

จึงคัดลอกชุดเสริมใหม่ครบไปที่ `release/explorer-integration-0.4.1/` พร้อมตรวจ hash เทียบต้นทาง โดยไม่รีสตาร์ต Explorer หรือถอน registration เดิม ไม่ถือโฟลเดอร์ `release/explorer-integration/` เดิมว่าอัปเดตครบจากรอบนี้

Explorer MSIX เป็น 0.4.1.0 และ unsigned ตามการตั้งค่าปัจจุบัน การลงทะเบียน production ยังคงต้องใช้ package ที่ Windows เชื่อถือ

## Evidence and limits

หลักฐาน: `docs/evidence/release-0.4.1/verification.json`, `build.log` และ `release/SHA256SUMS.txt`

ใช้ Windows SDK 10.0.26100.0 และ MSVC 14.51.36231 โดยกำหนด `LIB` เฉพาะ process ที่ build เช่นเดียวกับรอบก่อน Vite ยังเตือนขนาด Monaco bundle เกิน 500 kB

รอบนี้ตรวจ manifest versions, native tests, build, checksums และ Portable startup ไม่ได้รัน `npm test` ทั้งชุดซ้ำหลังเปลี่ยนเลขเวอร์ชัน (ผลชุดเต็มของโค้ด UI เดียวกันอยู่ในรายงาน audit fixes) และยังไม่ได้ติดตั้ง/ถอน Setup 0.4.1 หรือทดสอบ Explorer registration ใหม่
