import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

// ใช้ implementation เดิมเป็น oracle โดยไม่แก้ไขไฟล์ต้นฉบับ
const source = resolve(process.argv[2] ?? '../O_Compare')
const require = createRequire(resolve(source, 'package.json'))
const ts = require('typescript')
const iconv = require('iconv-lite')
const code = ts.transpile(await readFile(resolve(source, 'src/main/fileio.ts'), 'utf8'), {
  module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022
})
const legacy = {}
new Function('require', 'exports', code)(require, legacy)
const root = resolve('tests/fixtures')
await mkdir(root, { recursive: true })
const thai = 'สวัสดีครับ ทดสอบภาษาไทย เปรียบเทียบข้อความและบันทึกไฟล์ ข้อมูลถูกต้องครบถ้วน\r\n'.repeat(8)
const cases = [
  ['empty.txt', '', 'utf-8', false],
  ['ascii-lf.sql', 'SELECT 1;\nSELECT 2;\n', 'utf-8', false],
  ['thai-utf8.txt', 'สวัสดี ภาษาไทย 😀\nไม่มีบรรทัดปิดท้าย', 'utf-8', false],
  ['thai-bom.txt', 'ภาษาไทย 😀\r\n', 'utf-8', true],
  ['utf16le.txt', 'ภาษาไทย 😀\r\nUTF-16', 'utf-16le', true],
  ['utf16be.txt', 'ภาษาไทย 😀\nUTF-16', 'utf-16be', true],
  ['windows874.txt', thai, 'windows-874', false],
  ['tis620.txt', thai, 'tis-620', false],
  ['mixed-eol.txt', 'one\r\ntwo\nthree\r\n', 'utf-8', false],
  ['eol-tie.txt', 'one\r\ntwo\n', 'utf-8', false]
]
const oracle = []
for (const [file, text, encoding, bom] of cases) {
  await writeFile(resolve(root, file), iconv.encode(text, encoding, { addBOM: bom }))
  const data = await legacy.readTextFile(resolve(root, file))
  oracle.push({ file, text: data.text, encoding: data.encoding, bom: data.bom, eol: data.eol })
}
await writeFile(resolve(root, 'oracle.json'), JSON.stringify(oracle, null, 2) + '\n')
console.log(`Captured ${oracle.length} fixtures using original fileio.ts`)
