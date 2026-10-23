# Folder Comparison — แบบเสนอสำหรับ O_Compare Rust

สถานะ: ผู้ใช้ยืนยันแบบแล้ว — พัฒนาและ build รุ่น 0.2.0 สำเร็จ ดูผลตรวจและข้อจำกัดใน VALIDATION-0.2.0.md

## เป้าหมาย

เพิ่มการเปรียบเทียบโครงสร้างโฟลเดอร์และโฟลเดอร์ย่อยแบบซ้าย/ขวา พร้อมกรองไฟล์เหมือน ต่าง และมีเฉพาะฝั่งเดียว ใช้งานร่วมกับโหมดเปรียบเทียบข้อความเดิมในโปรเจกต์ Rust ไม่แก้โปรเจกต์ Electron ต้นฉบับ

## ทางเลือกและแบบที่แนะนำ

1. **แนะนำ: โหมด Files / Folders ภายในหน้าต่างเดิม** — ใช้พื้นที่และรูปแบบ toolbar เดิม สลับกลับข้อความเดิมได้โดยไม่ทำ unsaved edits หาย
2. หน้าต่าง Folder Comparison แยก — เห็นทั้งสองโหมดพร้อมกัน แต่ต้องเพิ่มการจัดการหน้าต่างและการเปิดไฟล์ข้ามหน้าต่าง จึงยังไม่เลือกสำหรับรุ่นแรก

## หน้าจอ

- เพิ่มตัวสลับ `Files` และ `Folders` ข้าง logo; เริ่มในโหมด Files เหมือนปัจจุบัน
- Files คง toolbar, Monaco, ข้อความและคีย์ลัดเดิม
- Folders มีช่อง path ซ้าย/ขวา ปุ่มเลือกโฟลเดอร์ และ `Compare`, `Refresh`, `Swap`, `Cancel` ระหว่างสแกน
- แสดง tree table ซ้าย/ขวาในแนวเดียวกัน แต่ละ row มีชื่อ, ขนาดไฟล์ และวันแก้ไข โดยคั่นด้วยสถานะกลาง
- โฟลเดอร์พับ/ขยายร่วมกันสองฝั่ง เลื่อนร่วมกัน และแสดงฝั่งที่ไม่มีรายการเป็นช่องว่างพร้อมขีด
- ตัวกรองแบบเปิด/ปิดหลายค่า: `Identical`, `Different`, `Left only`, `Right only`, `Errors / Skipped`; มี `All` เพื่อคืนทุกสถานะ เริ่มต้นแสดงทั้งหมด
- แสดงจำนวนไฟล์แต่ละสถานะ ไม่นับโฟลเดอร์รวมซ้ำเป็นจำนวนไฟล์; จำนวน error/skipped แยกแสดงเสมอ
- เมื่อกรอง ให้คง ancestor folders ที่จำเป็นเพื่ออ่านโครงสร้าง; ไม่มีผลลัพธ์ให้แสดง empty state ที่ระบุว่ามาจาก filter
- เรียงโฟลเดอร์ก่อนชื่อไฟล์ ใช้ลำดับชื่อสม่ำเสมอ และรักษาตำแหน่งแถวระหว่างสองฝั่ง
- รองรับ keyboard: Up/Down เลือกแถว, Left/Right พับ/ขยาย, Enter เปิดไฟล์ข้อความที่เลือก, Tab เดินระหว่าง controls
- ใช้สีอ่อนพื้นแถวและสีข้อความที่มี contrast อ่านได้ พร้อมข้อความ/สัญลักษณ์ทุกสถานะ ไม่อาศัยสีอย่างเดียว

| สถานะ | สีหลัก | ความหมาย |
|---|---|---|
| Identical | เขียว | ไฟล์ทั้งสองมี bytes เหมือนกัน |
| Different | ส้ม | bytes ต่างกัน หรือ path เดียวกันแต่ชนิดเป็น file/directory ต่างกัน |
| Left only | น้ำเงิน | มีเฉพาะฝั่งซ้าย |
| Right only | ม่วง | มีเฉพาะฝั่งขวา |
| Error | แดง | อ่าน/ตรวจไม่สำเร็จ พร้อมเหตุผล |
| Skipped | เทา | symlink/junction หรือรายการที่ไม่สามารถเปรียบเทียบตามนโยบายได้ |

## กติกาเปรียบเทียบ

- สแกน recursive ทั้งหมด รวมโฟลเดอร์ว่าง ไฟล์ซ่อน และ dotfiles; ไม่ตัด node_modules/.git หรือไฟล์ชนิดใดออกเอง
- จับคู่ด้วย relative path จาก root ของแต่ละฝั่ง ไม่ใช้ชื่อไฟล์อย่างเดียว; บน Windows จับคู่ชื่อแบบไม่สนตัวพิมพ์ แต่คงชื่อจริงไว้แสดงผล
- หากเกิดชื่อชนกันจนจับคู่ไม่ชัดเจน แสดง error แทนการรวมสองรายการเงียบ ๆ
- ไฟล์ขนาดต่างกันถือว่า Different; ขนาดเท่ากันอ่านเป็น chunks 64 KiB แล้วเทียบ bytes จนจบ/พบความต่าง โดยไม่อ่านไฟล์ใหญ่ทั้งก้อนเข้า RAM
- เนื้อหาเท่ากันแต่วันแก้ไขต่างกันยังเป็น Identical; encoding/BOM/EOL ต่างกันจน bytes ต่างถือว่า Different ตามการเปรียบเทียบไฟล์จริง
- รองรับไฟล์ binary ในการเปรียบเทียบโดยไม่ decode เป็นข้อความ
- โฟลเดอร์ที่มีทั้งสองฝั่งสรุปสถานะจาก children: มี error/skipped ให้แสดงความไม่สมบูรณ์, มีความต่าง/รายการขาดฝั่งให้เป็น Different, เหมือนกันทั้งหมดให้เป็น Identical
- โฟลเดอร์มีเฉพาะฝั่งเดียวให้เป็น Left only/Right only รวม children; empty directories ต้องมี row ของตัวเอง
- ไม่เดินตาม symlink/junction ในต้นไม้เพื่อป้องกันวนซ้ำและออกนอก root ที่เลือก โดยแสดงรายการเป็น Skipped และไม่สรุปว่าเหมือนกัน
- Root ไม่ใช่ directory/เข้าถึงไม่ได้ให้แจ้ง error และเก็บผลเปรียบเทียบครั้งก่อน; error เฉพาะรายการให้สแกนรายการอื่นต่อและแสดง error ที่ path นั้น
- ตรวจ metadata ก่อน/หลังอ่าน ถ้าไฟล์เปลี่ยนระหว่างเปรียบเทียบให้แจ้ง Changed during comparison แทนผล Identical ที่ไม่น่าเชื่อถือ

## การเปิดไฟล์และรักษาข้อความเดิม

- สลับ Files/Folders อย่างเดียวไม่ล้าง Monaco models หรือ undo history
- ดับเบิลคลิก/Enter ที่คู่ไฟล์ข้อความเปิดทั้งสองฝั่งด้วย Monaco เดิม; ฝั่งที่ไม่มีไฟล์แสดง buffer ว่างไม่มี path
- ก่อนแทนคู่ไฟล์ ให้ตรวจ unsaved edits ทั้งสองฝั่งและขอ Discard/Cancel ด้วย native confirmation เดิม; ยกเลิกแล้วไม่เปลี่ยนฝั่งใด
- อ่านคู่ไฟล์ให้ครบก่อนเปลี่ยน models; ถ้ามีฝั่งอ่านไม่ได้ให้แสดง error และคงคู่เดิม
- ไฟล์ binary แสดงสถานะ/ขนาดใน Folder Comparison ได้ แต่ไม่ส่งเข้า Monaco; แจ้งว่าเปิด text comparison ไม่ได้
- เปลี่ยนโหมดแล้วชื่อหน้าต่าง/status bar แสดงบริบทของโหมดนั้น ส่วน dirty warning ก่อนปิดยังครอบคลุมไฟล์ที่แก้ค้างอยู่แม้กำลังดู Folders

## การทำงานฝั่ง Rust และ interface

- เพิ่ม module folder comparison แยกจาก fileio/watchers เดิม ใช้ std::fs และ background blocking worker
- เพิ่ม `compare_folders(leftPath, rightPath, requestId)` คืน `FolderComparison` และ `cancel_folder_compare(requestId)` ผ่าน capability ของ main เท่านั้น
- `FolderComparison` มี root paths, tree entries และ summary; entry มี relative path, ชนิด, metadata ของแต่ละฝั่งถ้ามี, status และ error รายฝั่งถ้ามี
- ส่ง `folder:progress` ระหว่างสแกนพร้อม requestId และจำนวนตรวจแล้ว แสดงจำนวนรายการแทนเปอร์เซ็นต์ที่ยังไม่ทราบจำนวนรวม
- จำกัดงานที่กำลังทำงานหนึ่งงานต่อหน้าต่าง; เริ่มงานใหม่/เปลี่ยน roots ให้ยกเลิกงานเก่า และตรวจ requestId เพื่อไม่ให้ผลเก่าทับผลใหม่
- Cancel ตรวจเป็นระยะระหว่างเดิน directory/อ่าน chunk; เก็บผลครั้งก่อนและแสดง Canceled ไม่แสดงผลบางส่วนว่าเสร็จแล้ว
- ไม่มี directory watcher recursive ในรุ่นแรก ใช้ Refresh เมื่อข้อมูลบน disk เปลี่ยน
- แยก folder view/controller จาก main.ts และคงโมดูล Monaco ไว้; flatten เฉพาะ rows ที่ขยาย/ผ่าน filter และ render แบบ windowed สำหรับต้นไม้ใหญ่

## ขอบเขตรุ่นแรก

เพิ่มการอ่าน เปรียบเทียบ กรอง และเปิด text diff เท่านั้น ไม่เพิ่ม copy/move/delete/sync โฟลเดอร์ เพราะผู้ใช้ยังไม่ได้ขอฟังก์ชันเขียนข้อมูลเหล่านั้น

ใช้ version 0.2.0 สำหรับฟังก์ชันใหม่ และ build NSIS installer/executable แยกจาก Electron ตามเดิม

## การทดสอบและรับงาน

- Rust tests ใช้ directories/files จริง: identical, same-size-different-content, different-size, timestamp-only difference, left/right-only, nested/empty folders, file-vs-directory และ binary
- ตรวจไทย/ช่องว่าง, case-insensitive pairing บน Windows, permission/missing roots, symlink/junction ที่ทดสอบได้ และไฟล์เปลี่ยนระหว่างอ่าน
- ตรวจ Cancel/เปลี่ยน roots/requestId เก่า; สแกนโฟลเดอร์ใหญ่แล้วยังยกเลิกได้และ UI ไม่ค้าง
- Headless UI tests ตรวจ tree alignment, collapse/expand, ทุก filter, counts/empty state, keyboard และการไม่สูญเสีย unsaved text เมื่อสลับโหมด
- รัน regression tests ของ fileio/watchers/Monaco เดิม พร้อม typecheck, frontend build, fmt, Clippy และ Rust tests
- ตรวจ native directory picker, เปิดคู่ไฟล์, Cancel เมื่อมี unsaved edits, resize/scaling 100%/150% และ build/install/uninstall release
- สร้างผลทดสอบและระบุ native checks ที่ยังทำไม่ได้ตามจริง ไม่ใช้ browser tests แทนหลักฐาน native integration

## ลำดับลงมือหลังอนุมัติแบบ

1. เขียน Rust regression tests ก่อน แล้วพัฒนา traversal/content comparison/status aggregation/cancellation
2. เพิ่ม Tauri commands, shared types, progress และ capability
3. เพิ่ม folder tree UI/filters/mode switching และการเปิดคู่ไฟล์ผ่าน unsaved guard
4. ทดสอบ core + UI + regression, ตรวจ native เท่าที่เครื่องมืออนุญาต และ build 0.2.0

ดำเนินงานในแชตเดิมตามลำดับ ไม่ต้องสร้างแชตใหม่หรือใช้ subagents
