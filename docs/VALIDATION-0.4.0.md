# O_Compare 0.4.0 — ผลตรวจการเพิ่มฟีเจอร์

ทดสอบ implementation และ build วันที่ 20 ตุลาคม 2026; ตรวจ checksum และ Portable startup ซ้ำวันที่ 21 ตุลาคม 2026 (Asia/Bangkok)

## ฟีเจอร์ที่ส่งมอบ

- Files หลายแท็บ ใช้ document model ร่วมตาม path เก็บ Undo/Redo และตำแหน่งแต่ละคู่ มี Save/Discard/Cancel และป้องกันผล read/save ที่กลับมาหลังสลับแท็บ
- สำรอง bytes ก่อน Save/Copy ทับ พร้อม History, เปิดเทียบ snapshot แบบอ่านอย่างเดียว และ Restore ที่สำรองสภาพปัจจุบันก่อน จำกัด 20 รุ่นต่อไฟล์ รวม 1,000,000,000 bytes
- ล็อกประวัติด้วย OS file lock ครอบคลุมหลาย process พร้อมกู้ pending catalog, ลอง retention ที่ล้มเหลวใหม่ และเก็บกวาด orphan snapshot ที่ระบุได้ว่าโปรแกรมสร้าง
- Folders Watch ตรวจโฟลเดอร์ย่อย แจ้งผลล้าสมัยและบล็อก Copy/preview จน Refresh ไม่เริ่มสแกนอัตโนมัติจากเหตุการณ์ไฟล์เปลี่ยน
- Regex engine เดียวกันใน Files/Folders ละเว้นเฉพาะข้อความที่ตรง รักษาบรรทัดและข้อความต้นฉบับ พร้อมการแปลงตำแหน่ง UTF-16 สำหรับ Monaco

## ผลตรวจ

| การตรวจ | ผล |
| --- | --- |
| `npm test` | ผ่านทั้ง Rust, editor, tabs, Regex, folder workspace, controls, integration และ theme |
| Rust integration tests | 62 ผ่าน ไม่มี fail/skip |
| Monaco เดิม | 7 scenarios ผ่าน รวม Copy, Undo/Redo, Minor, filter, Wrap และ Swap |
| Tabs | model sharing, view/undo, shortcuts, Cancel/Discard และ delayed read/save กับ Rust จริงผ่าน |
| Regex | core mapping และ Edge + Rust + worker/provider ผ่าน รวมภาษาไทย/emoji และ invalid Apply |
| Folder workspace เดิม | 10 scenarios ผ่านกับข้อมูลจริงกว่า 10,000 รายการ |
| Controls | 6 กลุ่มผ่าน รวมปุ่มข้างเคียง หน้าจอเล็ก และ browser DPR 1.5 |
| ฟีเจอร์รวม | 6 scenarios ผ่าน: Regex → Copy/Undo → Save → History/Restore, snapshot read-only, Folder Regex/Minor, Watch/Refresh, stale preview และ Copy backup |
| Theme | Light/Dark, persistence, edit/undo, dialogs, keyboard และ blocked storage ผ่าน |
| `npm run typecheck` | ผ่าน รวมการรันอีกครั้งภายใน Windows build |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | ผ่าน |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | ผ่าน |
| `npm run build:win` | สร้าง Setup และ Portable 0.4.0 สำเร็จ |
| Portable startup | เปิด executable จริงกับ sample path สองฝั่ง ได้ title `O_Compare v0.4.0`; sample hashes ไม่เปลี่ยน |

ระหว่างพัฒนาพบ Windows ส่ง directory `Modify(Any)` จากการสแกนแบบอ่านอย่างเดียว เพิ่ม regression ที่ยืนยัน fail ก่อนแก้และผ่านหลังกรองเหตุการณ์ directory modify ที่ไม่ใช่ create/remove/rename โดยยังรับ file changes และ rescan errors

Monaco 0.57.0 ตรวจ option `diffAlgorithm` เป็น string จึงแยก compatibility adapter ผ่าน diff provider service override และติดตั้งก่อน initialize theme ซึ่งเป็นจุด initialize Monaco services เช่นกัน ชุดทดสอบรวมตรวจเส้นทางจริงนี้

## ไฟล์ส่งมอบและ SHA-256

| ไฟล์ | SHA-256 |
| --- | --- |
| `release/O_Compare-0.4.0-portable.exe` | `ebc73a32817822a5a3a380cfef5d4e5b0050c472e302494d90f65dbeae85e961` |
| `release/O_Compare-0.4.0-x64-setup.exe` | `3115c933089e7775b59d43fc8fdf13a564370d6695db8e229a45b2aa49ee9a72` |

ตรวจ hash ตรงกับ `release/SHA256SUMS.txt` ทั้งสองไฟล์ และเก็บไฟล์รุ่น 0.3.5 เดิมไว้

## หลักฐานและขอบเขตการยืนยัน

- `docs/evidence/features-light.png`, `features-dark.png` — ตรวจภาพ UI และ controls ข้างเคียงแล้ว
- `docs/evidence/portable-smoke-0.4.0.json` — หลักฐาน executable startup และ sample hashes
- Browser tests ใช้ Edge headless และ Rust filesystem services จริง โดยจำลองเฉพาะ native dialog answers; startup smoke ยืนยันว่า WebView frontend โหลดและเรียก native set-title สำเร็จ
- ยังไม่ได้ติดตั้ง/ถอน Setup รุ่นนี้ หรือทดสอบทุก interaction ของฟีเจอร์ใหม่ผ่าน native Tauri UI บนเครื่องที่ติดตั้ง ไม่ถือ browser DPR เป็นหลักฐาน Windows system DPI
- Explorer sparse package build เป็น unsigned ตามการตั้งค่าปัจจุบัน จึงยังใช้ข้อกำหนดการลงทะเบียนเดิมใน `packaging/windows/README.md`
- Vite แจ้งขนาด bundle เกิน 500 kB; build สำเร็จ ไม่มีการเปลี่ยน Monaco version หรือเพิ่มระบบ auto-update
- ไม่มี draft recovery เมื่อเปิดแอปใหม่, ไม่มี folder tabs, auto-sync/delete หรือ multi-file rollback ตามขอบเขตที่ตกลง
