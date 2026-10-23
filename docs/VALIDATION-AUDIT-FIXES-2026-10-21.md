# O_Compare — ผลแก้ Impeccable audit

วันที่ตรวจ: 21 ตุลาคม 2026 (Asia/Bangkok)

แก้ครบ A01–A08 จาก `AUDIT-2026-10-21.md` โดยรักษาชื่อ ข้อความบนปุ่ม รูปแบบหน้าจอ และสัญญาอ่าน/เขียนไฟล์เดิม เพิ่ม regression 9 กลุ่มสำหรับ 8 ประเด็น ไม่เพิ่ม dependencies หรือเปลี่ยน backend

## ผลตรวจซ้ำ

| มิติ | ก่อน | หลัง | เหตุผล |
| --- | ---: | ---: | --- |
| Accessibility | 2 | 3 | labels, live message, 7-column grid และ keyboard resize/tabs ผ่านขอบเขตที่ตรวจ |
| Performance | 3 | 3 | ลดภาพ toolbar; ยังไม่มี cold-start/frame/memory benchmark |
| Theming | 2 | 3 | แก้สี syntax บน diff และสีแถวที่เลือกทั้งสองธีม |
| Responsive | 2 | 3 | ที่ 640/900 CSS px ปุ่มครบและ document ไม่ล้นขอบ |
| Implementation Integrity | 3 | 4 | semantics สอดคล้องข้อมูลจริงและรักษาระบบ UI เดิม |
| **รวม** | **12/20** | **16/20** | **Good ตาม rubric และขอบเขตที่ตรวจ** |

คะแนนไม่ใช่การรับรอง WCAG ทั้งแอป ผลด้านการเข้าถึงยังต้องแยกจากการทดสอบกับโปรแกรมอ่านหน้าจอจริง

## สิ่งที่แก้

| ประเด็น | การแก้และหลักฐาน |
| --- | --- |
| A01 Contrast | ปรับสี comment/number และ SQL-specific tokens รวมเลขบรรทัด Dark; ตรวจทั้ง changed-line และ changed-character backgrounds นอกจากนี้พบและแก้ selected-row contrast ของ Folders Light เพิ่ม โดยปรับ token ของ Different/Minor/Right only/Skipped ให้เข้มขึ้นเล็กน้อย |
| A02 Labels | ตั้งชื่อ path, language, Open และ Save แยก Left/Right โดยไม่เปลี่ยนข้อความที่แสดงบนปุ่ม |
| A03 Status | ให้ `#st-msg` เป็น polite/atomic status region โดยไม่รวม cursor position ซึ่งเปลี่ยนบ่อย |
| A04 Compact Files | กลุ่มคำสั่ง wrap ได้; ย่อส่วนหัวแต่ละฝั่งได้; metadata ขึ้นแถวใหม่เมื่อจำเป็น; ตัดข้อความ status ยาวแทนการดัน document ออกนอกจอ |
| A05 Treegrid | 7 headers ตรงกับ 7 gridcells ต่อแถว มี colindex, header row index และ sort state; คง virtualization, selection และการจัดแนวสองฝั่ง |
| A06 Resize | resize คอลัมน์ทั้ง 6 จุดผ่าน Left/Right keys ใช้ clamp ร่วมกับ pointer; divider/log มี orientation และ current value; ยกเลิก gesture/lost capture/blur ล้าง drag state |
| A07 Tabs | Left/Right/Home/End สลับและคง focus ที่แท็บ เชื่อม tab กับ editor panel; Ctrl+Tab เดิมยังใช้ได้ |
| A08 Logo | เพิ่ม `assets/O_compare_toolbar.png` ขนาด 128×128 จากการย่อภาพเดิมและใช้เฉพาะ toolbar; master และ installer icons คงเดิม |

ภาพ toolbar ลดจาก **825,557 → 15,773 bytes (98.09%)** และยังแสดง 32×32 CSS px ไม่อ้างว่าเวลาเปิดแอปเร็วขึ้น เพราะไม่ได้วัด startup timing

## Regression และ build

- ก่อนแก้ tests ของ A01–A08 fail ตามพฤติกรรมจริง ดู `evidence/audit-fixes-2026-10-21/regression-red.log`
- เพิ่มการตรวจ selected rows หลังพบปัญหาระหว่าง native QA; เห็น Different 4.17:1 และ Right only 4.33:1 fail ก่อนแก้ ดู `selected-row-red.log`
- ชุด selected-row ใช้ไฟล์จริงให้เกิด Identical/Different/Minor/Left only/Right only/Skipped รวม junction จริง และผ่านทั้ง Light/Dark หลังแก้
- `npm test` รอบสุดท้ายผ่าน: Rust 62 tests, Monaco 7 scenarios, tabs, Regex, folder workspace 10 scenarios ที่มีไฟล์จริงกว่า 10,000 รายการ, controls 6 กลุ่ม, ฟีเจอร์รวม 6 scenarios, theme และ accessibility 9 กลุ่ม
- `npm run tauri -- build --no-bundle` รอบสุดท้ายผ่าน รวม typecheck และ Vite production build; executable อยู่ที่ `src-tauri/target/release/o-compare-rust.exe`
- Build ครั้งแรกติด LNK1181 เพราะ linker หา `dbghelp.lib` ไม่พบ ทั้งที่ SDK มีไฟล์ จึงกำหนด `LIB` เฉพาะ shell ที่ build ให้ชี้ Windows SDK 10.0.26100.0 และ MSVC 14.51.36231 ที่มีอยู่ ไม่แก้ configuration ถาวรหรือ dependency เพื่อกลบปัญหา
- Vite ยังเตือน bundle เกิน 500 kB ของ Monaco; ไม่มี build failure ในรอบสุดท้าย
- ตรวจ diff เฉพาะไฟล์ที่แก้แล้ว ไม่มี trailing whitespace

## Native QA และ detector

ตรวจ executable รอบสุดท้ายผ่าน WebView2/CDP บน loopback ที่ baseline 1400×900 CSS px และ viewport emulation 900×650/640×480 พร้อมภาพ DPR 2

- Files และ Folders ทุกขนาดที่ตรวจ: ไม่มีปุ่ม toolbar หลุดขอบ document width ตรงกับ viewport
- เปิด/ปิด Rules, History และ Filters ด้วย Escape ได้; ตรวจ controls ข้างเคียง, สถานะ selected/disabled, path fields และ metadata จากภาพจริง
- Native keyboard resize ครบ 6 จุด ปรับเพิ่มและลดคืนค่าได้จริง; grid มี 7 headers และ 7 cells ต่อแถว
- Synthetic touch ที่ pane divider เปลี่ยน 50 → 52.5%; แตะนิ้วที่สองแล้วไม่กระโดด; กลับ 50% และ cancel แล้วล้าง handler; ลากด้วยเมาส์รอบถัดไปได้และคืน 50% สำเร็จ
- JavaScript และ CSS ที่ native app โหลด **ตรงกับ `dist/assets` แบบ byte-for-byte**; ดู hashes ใน `native-interactions.json`
- ทั้ง Files/Folders และ Light/Dark **ไม่มี low-contrast finding** ในสถานะรอบสุดท้าย
- คำเตือนที่เหลือ: active tab border 1 node ต่อ Files theme เป็น false positive ตามบริบทเดิม; tiny-text 11px 5 nodes ต่อ Folders theme เป็นข้อมูลประกอบของ compact desktop UI ไม่ยกระดับเป็น WCAG failure จากขนาดเพียงอย่างเดียว
- คืนหน้า Files, theme เดิม และ viewport ก่อนปิดเฉพาะหน้าต่างที่เปิดเพื่อตรวจ

หลักฐานรวมอยู่ใน `evidence/audit-fixes-2026-10-21/` โดย `verification.json` สรุป detector, layout, native interactions และ executable checksum; `test-suite.log` และ `native-build.log` เป็นผลรอบสุดท้าย

## Executable ที่ตรวจ

`src-tauri/target/release/o-compare-rust.exe` — 14,229,504 bytes

SHA-256: `1bb29802b38824e1e26db7d0fe6786a6d6cbd9fb0b13d0de3c22ee122781a4b5`

รอบนี้ build ตัวแอปสำหรับตรวจ ไม่ได้เพิ่มเวอร์ชัน สร้าง Setup ใหม่ หรือติดตั้งทับแอปเดิม ไฟล์เดิมใน `release/` ไม่ใช่ artifact ของการแก้รอบนี้

## ข้อจำกัดที่ยังมี

ยังไม่ได้ทดสอบ NVDA/Narrator, forced-colors, text zoom 200%, จอสัมผัสจริง, ทุกภาษา syntax, cold startup หรือ installer/Explorer integration รอบใหม่ ไม่ถือ viewport/DPR emulation เป็นการยืนยัน Windows DPI หรืออุปกรณ์จริงทั้งหมด
