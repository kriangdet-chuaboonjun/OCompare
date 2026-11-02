# Structural Compare (JSON / XML / CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปุ่ม Structural ในโหมด Files เปิดแท็บเปรียบเทียบข้อความ canonical (JSON/XML/CSV) ของสองฝั่งแบบ read-only โดยไม่แตะไฟล์หรือแท็บต้นฉบับ

**Architecture:** Rust library crate เพิ่มโมดูล `structural` (`canonicalize(text, format)`) ซึ่งมี Tauri command เป็น adapter บางๆ Renderer อ่านข้อความจาก model ทั้งสองฝั่ง เรียก canonicalize แล้วสร้าง `FileData` เสมือน path `structural://…` ใส่แท็บใหม่ด้วยรูปแบบเดียวกับ `showHistory().compare` ใน `main.ts` การเป็น read-only ใช้ helper กลางแทนเช็ก `history://` ที่กระจายอยู่

**Tech Stack:** Rust (`serde_json` + `arbitrary_precision`, `quick-xml`, `csv`), Tauri 2, TypeScript/Vite, Monaco, Playwright + Edge (UI test บน harness Rust จริง)

**Spec:** `docs/superpowers/specs/2026-11-02-structural-compare-design.md` (อ่านคู่กับ plan นี้; หัวข้อ "ผู้เขียนตัดสินใจแทน" มีนโยบาย XML/CSV/ขีดจำกัดที่ plan ไม่ทวนซ้ำ)

## Global Constraints

- ขนาดข้อความ input สูงสุด 10 MiB ต่อฝั่ง วัดเป็น UTF-8 bytes ใช้ `comparison_rules::MAX_TEXT_BYTES`; canonical output สูงสุด 64 MiB เกินแล้วเป็น error
- Logic ทั้งหมดอยู่ใน library crate `o_compare_rust` ไม่พึ่ง Tauri; `commands.rs` เป็น adapter (`blocking(...)`)
- API ใหม่ต้องแก้ครบ: `src/shared/…`, `src/renderer/platform.ts`, `tests/folder-platform.ts`, `src-tauri/examples/folder-workspace.rs`, `commands.rs`, `lib.rs` (generate_handler), `build.rs` (รายการ command), `capabilities/main.json`
- path เสมือน: `structural://<format>/<left|right>/<path ต้นฉบับเต็ม>` ลงท้ายด้วยชื่อไฟล์; ฝั่งไม่มีไฟล์ใช้ `structural://<format>/<side>/untitled-<SideState.id>/Untitled`
- ห้ามแตะ model/ไฟล์ต้นฉบับ; ข้อความที่ใช้เทียบคือข้อความปัจจุบันใน editor (รวมที่ยังไม่บันทึก)
- ข้อความบน UI/สถานะเป็นภาษาอังกฤษ เหมือนที่แอปใช้อยู่
- **working tree มีงานที่ยังไม่ commit ของผู้ใช้** ในไฟล์ที่ plan นี้ต้องแตะด้วย (`commands.rs`, `lib.rs`, `build.rs`, `capabilities/main.json`, `folder-workspace.rs`, `platform.ts`, `folders.ts`, `folder-platform.ts`, `diffView.ts`, `main.ts`, `index.html`, `styles.css`, `package.json`) แก้แบบเพิ่มเล็กๆ ห้าม `git stash`/`reset`/`checkout` ทับ **ไม่มี step commit ใน plan นี้**: อย่า commit จนกว่าผู้ใช้สั่ง (ไฟล์ร่วมมี hunk ของผู้ใช้ปนอยู่)
- UI test รันทีละไฟล์ ห้ามซ้อน (port ซ้ำ) และต้อง build examples ก่อน: `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --examples`; ใน Git Bash `npm run` อาจหา `cargo` ไม่เจอ ใช้ PowerShell

## Review Focus

อินพุต/สภาวะที่ spec เงียบแต่มีโอกาสกัดผู้ใช้ (แต่ละข้อมี test ในงานที่ระบุ):

1. ไฟล์ชื่อเดียวกันคนละโฟลเดอร์ (`l/config.json` vs `r/config.json`) ต้องเห็นความต่าง ไม่ใช่ model ตัวเดียวร่วมกัน — Task 5
2. กด Structural ซ้ำหลังแก้ต้นฉบับ ต้องได้ข้อความใหม่ในแท็บเดิม ไม่ใช่ข้อความเก่า — Task 5
3. ฝั่งใดฝั่งหนึ่ง parse ไม่ผ่าน ต้องไม่เกิดแท็บครึ่งๆ กลางๆ และข้อความบอกฝั่ง+บรรทัด:คอลัมน์ — Task 5
4. กด Structural ขณะอยู่ในแท็บ structural/history ต้องไม่ซ้อนแท็บ และบอกวิธีใช้ — Task 5
5. ข้อความไทย/emoji ใน JSON ต้องไม่ถูก escape เป็น `\uXXXX` และเลขใหญ่/duplicate key ต้องไม่เงียบหาย — Task 1

(ข้อที่เป็นของฟอร์แมตเดียวมี test ในงานของฟอร์แมตนั้น: XML mixed content / `xml:space` — Task 6, CSV บรรทัดว่าง — Task 7)

---

### Task 1: JSON canonicalizer (Rust core)

**Files:**
- Create: `src-tauri/src/structural.rs`
- Create: `src-tauri/tests/structural.rs`
- Modify: `src-tauri/src/lib.rs` (เพิ่ม `pub mod structural;` ตามลำดับตัวอักษร), `src-tauri/Cargo.toml` (`serde_json = { version = "1", features = ["arbitrary_precision"] }`)

**Interfaces:**
- Produces:
  - `pub enum Format { Json }` — `#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]`, `#[serde(rename_all = "lowercase")]` (Task 6/7 เพิ่ม `Xml`, `Csv`)
  - `pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;`
  - `pub fn canonicalize(text: &str, format: Format) -> Result<String, String>` — `Err` เป็นข้อความอังกฤษพร้อมใช้แสดง เช่น `JSON parse error at line 3, column 5: …`, `No content`, `Input exceeds 10 MiB`, `Output exceeds 64 MiB`

- [ ] **Step 1: เขียน test (ล้มก่อน)** ใน `src-tauri/tests/structural.rs`: `json_key_order_and_indent_do_not_matter` (`{"b":{"y":2,"x":1},"a":1}` กับ `{ "a": 1,\n "b": {"x":1,"y":2} }` ได้ canonical เท่ากัน และลงท้าย `\n`), `json_value_change_changes_output`, `json_array_order_is_preserved`, `json_keeps_unicode_unescaped` (`{"ชื่อ":"ไทย😀"}` → output มี `ไทย😀` ตรงๆ ไม่มี `\u`), `json_preserves_number_text` (`12345678901234567890123` และ `1.0` คงเดิม และ `1` ≠ `1.0` ใน canonical), `json_duplicate_key_is_error` (error มีคำว่า `duplicate key` และชื่อ key), `json_parse_error_reports_line_and_column` (error ขึ้นต้น `JSON parse error at line 2, column`), `blank_input_is_error` (`""` และ `"  \n"` → `No content`), `oversized_input_is_error` (>10 MiB → `Input exceeds 10 MiB` ก่อน parse), `oversized_output_is_error` (ใช้ input ใต้ 10 MiB ที่ pretty-print แล้วเกิน 64 MiB เช่น array ซ้อนของ `[]` จำนวนมาก — ถ้าสร้างไม่ได้ใน test ให้ทดสอบผ่านฟังก์ชันภายในที่รับ limit เป็นพารามิเตอร์)
- [ ] **Step 2: รัน** `cargo test --manifest-path src-tauri/Cargo.toml --test structural` — คาดว่า compile fail (ยังไม่มีโมดูล)
- [ ] **Step 3: เขียน `canonicalize` (JSON)** — ตรวจ input/blank ก่อน, parse ผ่าน wrapper `Deserialize` ที่เขียนเอง (visitor แบบ map) เพื่อตรวจ duplicate key แล้วคืน `serde_json::Value` (Map เป็น BTreeMap จึงเรียง key เอง ห้ามเปิด `preserve_order`), `serde_json::to_string_pretty` (2 ช่องว่าง) + `\n`, แล้วตรวจ `MAX_OUTPUT_BYTES` แปลง error ของ serde_json เป็น `JSON parse error at line {line()}, column {column()}: {msg}`
- [ ] **Step 4: รัน** คำสั่งเดิม — คาดว่า PASS ทั้งหมด และ `cargo test --manifest-path src-tauri/Cargo.toml --test comparison_rules` ยัง PASS (ยืนยันว่า `arbitrary_precision` ไม่กระทบของเดิม)

### Task 2: Renderer helpers (format detection + virtual path)

**Files:**
- Create: `src/renderer/structural.ts` (ห้าม import `monaco-editor` เพื่อให้ node import ได้)
- Create: `scripts/test-structural-model.mjs`
- Modify: `package.json` (เพิ่ม `node --disable-warning=ExperimentalWarning scripts/test-structural-model.mjs` ต่อท้าย `test:editor`)

**Interfaces:**
- Produces (ใน `src/renderer/structural.ts`):
  - `export type StructuralFormat = 'json'` (Task 6/7 เพิ่ม `'xml' | 'csv'`)
  - `export function detectFormat(left: { path: string | null; text: string }, right: { path: string | null; text: string }): { format: StructuralFormat } | { error: string }` — ตามกติกาใน spec หัวข้อ Renderer: นามสกุลก่อน (`json`), ถ้าฝั่งใดไม่รู้จักให้ sniff เนื้อหาหลัง trim (`{`/`[` → json), ฝั่งที่รู้จักกำหนดให้อีกฝั่ง, ไม่ตรงกัน/ไม่รู้จัก → `{ error }` ข้อความอังกฤษ
  - `export function structuralPath(format: StructuralFormat, side: 'left' | 'right', source: { path: string | null; id: string }): string`
  - `export type VirtualKind = 'History' | 'Structural'`; `export function virtualKind(path: string | null | undefined): VirtualKind | null` (`history://` → History, `structural://` → Structural, อื่นๆ → null); `export const isVirtualPath = (path: string | null | undefined): boolean`

- [ ] **Step 1: เขียน test** `scripts/test-structural-model.mjs` (รูปแบบเดียวกับ `scripts/test-folder-model.mjs`, `node:assert/strict`): `.json`+`.json` → json; Untitled ทั้งสองฝั่งที่ขึ้นต้น `{`/`[` (มีช่องว่างนำหน้า) → json; `a.json` กับ Untitled ที่ไม่ใช่ JSON → ยัง json (ฝั่งที่รู้จักกำหนด; parse error จะแจ้งทีหลัง); `a.json` กับ `b.txt` ที่เนื้อหาไม่ใช่ JSON → error; ไม่รู้จักทั้งคู่ → error; `structuralPath('json','left',{path:'E:\\a\\config.json',id:'document-1'})` = `structural://json/left/E:/a/config.json` (แปลง `\` เป็น `/`); path ว่าง → `structural://json/left/untitled-document-1/Untitled`; ไฟล์ซ้ายและขวาชื่อเดียวกันคนละโฟลเดอร์ได้ path ต่างกัน; `virtualKind` ทั้งสามกรณีรวม `null`/`undefined`
- [ ] **Step 2: รัน** `node --disable-warning=ExperimentalWarning scripts/test-structural-model.mjs` — คาดว่า FAIL (ไม่มีไฟล์)
- [ ] **Step 3: เขียนโมดูลตาม Interfaces** — ใช้ตาราง นามสกุล→format ในโมดูลนี้เอง (อย่า import `language.ts` เพราะดึง monaco)
- [ ] **Step 4: รัน** คำสั่งเดิม — PASS และ `npm run typecheck` ผ่าน

### Task 3: API plumbing end-to-end

**Files:**
- Create: `src/shared/structural.ts`, `scripts/test-structural-compare.mjs` (โครง — Task 5 ต่อ)
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (generate_handler), `src-tauri/build.rs`, `src-tauri/capabilities/main.json`, `src/renderer/platform.ts`, `tests/folder-platform.ts`, `src-tauri/examples/folder-workspace.rs`
- Generated: `src-tauri/permissions/autogenerated/canonicalize_structural.toml` (สร้างเองตอน build; ต้องมีอยู่ในไฟล์ที่ส่งมอบ)

**Interfaces:**
- Consumes: `canonicalize`, `Format` (Task 1)
- Produces:
  - Tauri command `canonicalize_structural(text: String, format: structural::Format) -> Result<String, AppError>` ผ่าน `blocking`; error code `STRUCTURAL_PARSE` (message คือสตริง error จาก core)
  - `src/shared/structural.ts`: `export interface StructuralApi { canonicalize(text: string, format: StructuralFormat): Promise<string> }` (re-export `StructuralFormat` จาก `src/renderer/structural.ts` หรือกำหนดที่ shared แล้วให้ renderer import — เลือกอย่างเดียวและไม่ให้เกิดวงจร import)
  - `export const structuralApi: StructuralApi` ใน `platform.ts` และ `tests/folder-platform.ts` (ชื่อ export ต้องตรงกัน เพราะ test harness สลับ `./platform`)
  - action `"canonicalizeStructural"` ใน `folder-workspace.rs` รับ `text`, `format` คืน string หรือ error `STRUCTURAL_PARSE`

- [ ] **Step 1: เขียน test (ล้มก่อน)** — `scripts/test-structural-compare.mjs` ใช้โครงเดียวกับ `scripts/test-workspace-features.mjs` (fixture ใน `tmpdir`, `startFolderTestServer(root, 1457)` — ตรวจก่อนว่า 1457 ไม่ซ้ำด้วย `grep -n 1457 scripts/*.mjs`, `chromium.launch({ channel: 'msedge' })`, `checks.push(...)` แล้วพิมพ์สรุป) เช็กแรก: `server.call({ action: 'canonicalizeStructural', text: '{"b":1,"a":2}', format: 'json' })` เท่ากับ `'{\n  "a": 2,\n  "b": 1\n}\n'`; และ text `'{bad'` ปฏิเสธด้วยข้อความที่ขึ้นต้น `JSON parse error at line 1`
- [ ] **Step 2: รัน** build examples แล้ว `node scripts/test-structural-compare.mjs` — คาดว่า FAIL (action ไม่รู้จัก)
- [ ] **Step 3: เพิ่มครบทุกจุดตาม Interfaces** (command, handler, build.rs, capability `allow-canonicalize-structural`, shared type, สอง `structuralApi`, example action) แล้ว `cargo build --manifest-path src-tauri/Cargo.toml` (desktop) เพื่อสร้างไฟล์ permission autogenerated
- [ ] **Step 4: รัน** `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --examples`, `node scripts/test-structural-compare.mjs` (PASS), `npm run typecheck` (ผ่าน), `cargo check --manifest-path src-tauri/Cargo.toml` (feature desktop ผ่าน)

### Task 4: Generalize read-only handling (behavior-preserving)

**Files:**
- Modify: `src/renderer/main.ts` (จุดที่เช็ก `startsWith('history://')` ประมาณบรรทัด 110, 156–158, 165, 241, 278, 323, 335, 386), `src/renderer/diffView.ts` (ประมาณ 154, 377)

**Interfaces:**
- Consumes: `isVirtualPath`, `virtualKind` (Task 2)
- Produces: พฤติกรรมเดิมของ History ไม่เปลี่ยน; path `structural://` ได้ผลเหมือนกัน: Save ปิด, copy section เข้าฝั่งนั้นไม่ได้, ไม่ watch ไฟล์, ช่อง path อ่านอย่างเดียว, ป้ายแท็บต่อท้าย ` [History]` หรือ ` [Structural]`, ช่อง path แสดง `<ชื่อ> [History — read-only]` หรือ `<ชื่อ> [Structural — read-only]` ตาม `virtualKind`

- [ ] **Step 1: รันชุดเดิมเป็น baseline** `node scripts/test-workspace-features.mjs` และ `node scripts/test-tabs-ui.mjs` — ต้อง PASS ก่อนแก้ (ถ้าไม่ผ่านอยู่แล้ว ให้หยุดและรายงาน)
- [ ] **Step 2: เพิ่ม test (ล้มก่อน)** ใน `scripts/test-structural-compare.mjs`: โหลด document เสมือนเข้าแท็บผ่าน `window.__ocompare.loadDocument(window.__ocompare.sides.right, { path: 'structural://json/right/x/a.json', text: '{}', encoding: 'utf-8', bom: false, eol: 'LF', size: 2, mtimeMs: 1 })` แล้วยืนยันว่าช่อง path ขวามี `readOnly` และข้อความ `[Structural — read-only]`, ปุ่ม `.save` ฝั่งขวา disabled, และ editor ขวา `readOnly` option เป็น true
- [ ] **Step 3: แทนที่ทุกจุดด้วย `isVirtualPath`/`virtualKind`** ตาม Interfaces ไม่เปลี่ยนตรรกะอื่น
- [ ] **Step 4: รัน** `node scripts/test-structural-compare.mjs`, `node scripts/test-workspace-features.mjs`, `node scripts/test-tabs-ui.mjs`, `npm run typecheck` — PASS ทั้งหมด

### Task 5: Structural command, tab flow, refresh, errors (JSON end-to-end)

**Files:**
- Modify: `src/renderer/index.html` (ปุ่ม `<button data-cmd="structural" title="Compare canonical JSON / XML / CSV in a new tab"><span>Structural</span></button>` ถัดจากปุ่ม `history` ใน `#file-tools`), `src/renderer/main.ts`, `scripts/test-structural-compare.mjs`, `CHANGELOG.md` (บรรทัดใต้ `## [Unreleased]`)
- Modify (ถ้าจำเป็น): `src/renderer/styles.css`

**Interfaces:**
- Consumes: `detectFormat`, `structuralPath` (Task 2), `structuralApi.canonicalize` (Task 3), `isVirtualPath` (Task 4), `tabs.findPair/create/replace/activate`, `view.loadDocument(doc, file)`
- Produces: `commands.structural: () => Promise<void>` ใน `main.ts` ตามขั้นตอนใน spec หัวข้อ Renderer: (1) ถ้าแท็บ active มีฝั่งใดเป็น virtual → status `Press Structural on the original comparison tab` แล้วจบ (2) กันกดซ้ำขณะทำงาน + status `Building structural view…` (3) `detectFormat` ผิดพลาด → status ข้อความนั้น (4) canonicalize สองฝั่งพร้อมกัน; error ของฝั่งใด → status `Left: <message>` / `Right: <message>` โดยไม่สร้างหรือแก้แท็บใดเลย (5) สร้าง `FileData` {path ตาม `structuralPath`, text, `encoding: 'utf-8'`, `bom: false`, `eol: 'LF'`, `size` = UTF-8 bytes, `mtimeMs: Date.now()`} (6) `tabs.findPair(leftPath, rightPath) ?? tabs.create()` → `tabs.replace` ทั้งสองฝั่ง → **เรียก `view.loadDocument(doc, file)` กับ document ที่ `replace` คืนมาเสมอ** (กันข้อความเก่า) → ตั้งภาษา Monaco ตาม format (`json`) → `tabs.activate` ไม่เรียก `watchDocument`

- [ ] **Step 1: เขียน test (ล้มก่อน)** ต่อใน `scripts/test-structural-compare.mjs` (ผ่านหน้าเว็บจริง + Rust จริง; กดปุ่ม `#file-tools [data-cmd=structural]`):
  - `reorder_is_not_a_diff`: ซ้าย `{"a":1,"b":{"x":1,"y":2}}` ขวา `{"b":{"y":2,"x":1},"a":1}` (เปิดเป็นไฟล์ `.json`) → แท็บใหม่ `diffCount() === 0`; ต้นฉบับยัง `diffCount() > 0` เมื่อกลับไปดู (ยืนยันว่าเป็นคนละแท็บ) และต้นฉบับไม่ dirty
  - `value_change_is_a_diff`: เปลี่ยน `"y":2` เป็น `"y":3` ที่ขวา → กดใหม่ → `diffCount() === 1`
  - `same_basename_other_folder` (Review Focus 1): `l/config.json` กับ `r/config.json` เนื้อหาต่างกัน → แท็บ structural มี `diffCount() > 0` และ path สองฝั่งต่างกัน
  - `refresh_reuses_tab_with_new_text` (Review Focus 2): จำนวนแท็บไม่เพิ่มเมื่อกดซ้ำ และหลังแก้ข้อความต้นฉบับฝั่งขวาให้เท่ากับซ้าย แล้วกดซ้ำ → `diffCount() === 0` และ `textOf('right')` เป็นข้อความใหม่
  - `parse_error_creates_nothing` (Review Focus 3): ตั้งฝั่งขวาเป็น `{bad` → จำนวนแท็บไม่เปลี่ยน, `#st-msg` ขึ้นต้น `Right: JSON parse error at line 1`
  - `structural_on_structural_is_refused` (Review Focus 4): กดขณะอยู่แท็บ structural → จำนวนแท็บไม่เพิ่ม, `#st-msg` เป็น `Press Structural on the original comparison tab`
  - `read_only_tab`: ในแท็บ structural ปุ่ม `.save` ทั้งสองฝั่ง disabled, ป้ายแท็บมี `[Structural]`
  - `untitled_pasted_json`: สองแท็บ Untitled ที่ตั้งข้อความด้วย `view.sides.left.model.setValue(...)` เป็น JSON → ทำงานและภาษา model เป็น `json`
  - `unknown_format_message`: `.txt` สองไฟล์เนื้อหาไม่ใช่ JSON → ไม่เปิดแท็บ, สถานะบอกว่าไม่รู้จักฟอร์แมต
- [ ] **Step 2: รัน** build examples แล้ว `node scripts/test-structural-compare.mjs` — คาดว่า FAIL (ไม่มีปุ่ม/คำสั่ง)
- [ ] **Step 3: เพิ่มปุ่มและ `commands.structural` ตาม Interfaces** (ฟังก์ชันตัวช่วยแยกเป็นฟังก์ชันของตัวเองใน `main.ts` ใกล้ `showHistory`) และเพิ่มบรรทัด CHANGELOG ใต้ `[Unreleased]`: `Add Structural compare: open a read-only tab that compares canonical JSON (sorted keys, normalized whitespace) so formatting-only differences disappear.`
- [ ] **Step 4: รัน** `node scripts/test-structural-compare.mjs`, `npm run typecheck`, และชุด regression `node scripts/test-workspace-features.mjs`, `node scripts/test-tabs-ui.mjs`, `node scripts/test-editor.mjs` — PASS ทั้งหมด
- [ ] **Step 5: เพิ่ม `node scripts/test-structural-compare.mjs` ต่อท้าย `test:folders` ใน `package.json`** (ต่อท้ายสุด หลัง `scripts/test-folder-drop.mjs`) และยืนยันว่า `npm run test:folders` ผ่านบน PowerShell

### Task 6: XML canonicalizer

**Files:**
- Modify: `src-tauri/Cargo.toml` (เพิ่ม `quick-xml`, เลือกเวอร์ชันล่าสุดที่เสถียร), `src-tauri/src/structural.rs`, `src-tauri/tests/structural.rs`, `src/renderer/structural.ts`, `scripts/test-structural-model.mjs`, `scripts/test-structural-compare.mjs`, `src/renderer/main.ts` (ภาษา Monaco `xml`), `CHANGELOG.md` (ขยายบรรทัดเดิมให้รวม XML)

**Interfaces:**
- Consumes/Produces: `Format::Xml` (serde `"xml"`); `StructuralFormat` เพิ่ม `'xml'`; `detectFormat` รู้จักนามสกุล `xml`/`config`/`csproj` และ sniff `<` นำหน้าเป็น xml

- [ ] **Step 1: เขียน test (ล้มก่อน)** ใน `structural.rs` tests: `xml_self_closing_equals_empty_pair` (`<a/>` ≡ `<a></a>`), `xml_attribute_order_does_not_matter`, `xml_declaration_and_comments_are_dropped`, `xml_cdata_equals_escaped_text`, `xml_char_reference_equals_entity` (`&#38;` ≡ `&amp;`), `xml_whitespace_between_elements_ignored`, `xml_element_order_is_preserved`, `xml_doctype_and_processing_instructions_are_kept`, `xml_mixed_content_text_is_kept` (`<p>a <b>x</b> c</p>` ต่างจาก `<p>a<b>x</b>c</p>`), `xml_space_preserve_subtree_untouched`, `xml_namespace_declarations_sorted_with_attributes`, `xml_parse_error_reports_line_and_column` (ขึ้นต้น `XML parse error at line`), blank/oversize เหมือน JSON; เพิ่มใน `test-structural-model.mjs`: นามสกุล xml/config/csproj, sniff `<`, `.json` vs `.xml` → error; เพิ่มใน UI test: ไฟล์ `.xml` ที่ attribute สลับที่ + `<a/>` vs `<a></a>` → `diffCount() === 0`
- [ ] **Step 2: รัน** `cargo test --manifest-path src-tauri/Cargo.toml --test structural` และ `node --disable-warning=ExperimentalWarning scripts/test-structural-model.mjs` — FAIL
- [ ] **Step 3: เพิ่ม `Format::Xml` และตัวจัดรูป** ด้วย `quick-xml` reader/writer (indent 2 ช่องว่าง, เรียง attribute รวม `xmlns*` ตามชื่อ) ตามนโยบายในหัวข้อ "ผู้เขียนตัดสินใจแทน → XML" ของ spec; ตั้ง line/column ของ error จากตำแหน่ง byte ของ reader
- [ ] **Step 4: ต่อ renderer** (`StructuralFormat`, `detectFormat`, ภาษา Monaco) แล้วรัน: `cargo test … --test structural`, `node … test-structural-model.mjs`, `node scripts/test-structural-compare.mjs`, `npm run typecheck` — PASS

### Task 7: CSV canonicalizer

**Files:**
- Modify: `src-tauri/Cargo.toml` (เพิ่ม `csv`), `src-tauri/src/structural.rs`, `src-tauri/tests/structural.rs`, `src/renderer/structural.ts`, `scripts/test-structural-model.mjs`, `scripts/test-structural-compare.mjs`, `src/renderer/main.ts` (ภาษา `plaintext`), `CHANGELOG.md` (ขยายบรรทัดเดิมให้รวม CSV)

**Interfaces:**
- Consumes/Produces: `Format::Csv` (serde `"csv"`); `StructuralFormat` เพิ่ม `'csv'`; `detectFormat` รู้จักนามสกุล `csv`/`tsv` เท่านั้น (ไม่ sniff CSV)

- [ ] **Step 1: เขียน test (ล้มก่อน)** `csv_semicolon_and_tab_delimiters_normalize_to_comma`, `csv_unneeded_quotes_removed_and_needed_quotes_kept` (ค่าที่มี `,` `"` หรือขึ้นบรรทัดใหม่ยังมี quote และ `"` ถูก escape), `csv_crlf_equals_lf`, `csv_bom_is_stripped`, `csv_blank_lines_are_kept_as_empty_rows` (ต่างจากไฟล์ที่ไม่มีบรรทัดว่าง), `csv_ragged_rows_are_not_an_error`, `csv_header_is_an_ordinary_row`, `csv_row_and_column_order_preserved`, `csv_unterminated_quote_is_error` (ขึ้นต้น `CSV parse error at line`), blank/oversize เหมือนเดิม; ใน `test-structural-model.mjs`: `.csv`/`.tsv` ตรวจพบ, Untitled ที่ไม่ใช่ JSON/XML → error; UI test: `.csv` ตัวคั่น `;` กับ `,` เนื้อหาเดียวกัน → `diffCount() === 0`, ค่าต่างหนึ่งช่อง → `diffCount() === 1`
- [ ] **Step 2: รัน** ชุดคำสั่งเดียวกับ Task 6 Step 2 — FAIL
- [ ] **Step 3: เพิ่ม `Format::Csv`** ใช้ `csv` crate แบบ flexible (`flexible(true)`, `has_headers(false)`); ตัวคั่นตรวจจากบรรทัดแรกที่ไม่ว่าง (นับ `,` `;` tab นอก quote ตัวที่มากที่สุด; เท่ากันเลือก `,`); บรรทัดว่างต้องไม่ถูกข้าม (ประมวลผลบรรทัดว่างเอง ไม่พึ่งค่าเริ่มต้นของ crate)
- [ ] **Step 4: ต่อ renderer แล้วรันครบ**: `cargo test --manifest-path src-tauri/Cargo.toml` (ทั้งหมด), `npm run typecheck`, `node scripts/test-structural-model.mjs` (พร้อม flag), `node scripts/test-structural-compare.mjs`, `node scripts/test-workspace-features.mjs`, `node scripts/test-tabs-ui.mjs` — PASS ทั้งหมด

---

## Self-Review (ทำแล้ว)

- **Spec coverage:** goals (ปุ่ม, ใช้ข้อความ editor ปัจจุบัน, เครื่องมือ diff เดิม, ไม่แตะต้นฉบับ) → Task 5; ฟอร์แมต JSON/XML/CSV → Task 1/6/7; path เสมือนและ refresh → Task 2/5; read-only กลาง → Task 4; format detection → Task 2; error ฝั่ง+บรรทัด → Task 1/5; ขีดจำกัด 10/64 MiB + "Building structural view…" → Task 1/5; plumbing ครบ 4+ จุด → Task 3; การทดสอบตาม spec → ทุก task; non-goals ไม่มี task (ถูกต้อง)
- **Type consistency:** `Format`/`StructuralFormat`, `canonicalize`, `structuralApi.canonicalize`, `detectFormat`, `structuralPath`, `virtualKind`/`isVirtualPath` ใช้ชื่อเดียวกันทุก task
- **สัดส่วน:** แต่ละ task ระบุ signature, test name+assertion, คำสั่งยืนยัน; ไม่มีโค้ดเนื้อใน plan
