import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

// Browser plugin not available. ใช้ Edge headless แยกจาก desktop ของผู้ใช้
const server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['tests/editor.html'] }, server: { host: '127.0.0.1', port: 1421, strictPort: true, watch: { ignored: ['**/src-tauri/target/**', '**/release/**', '**/docs/evidence/**'] } } })
let browser
const results = []
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:1421/tests/editor.html')
  await page.waitForFunction(() => Boolean(window.editorTest))
  const snapshot = () => page.evaluate(() => {
    const v = window.editorTest.view
    return { left: v.textOf('left'), right: v.textOf('right'), count: v.diffCount(), dirty: v.isDirty('right') }
  })
  const differences = async (count) => {
    try { await page.waitForFunction((expected) => window.editorTest.view.diffCount() === expected, count, { timeout: 5000 }) }
    catch (error) { console.error({ expected: count, actual: await snapshot(), errors }); throw error }
  }
  const load = async (left, right, count = 1) => {
    await page.evaluate(({ left, right }) => {
      const v = window.editorTest.view
      for (const side of ['left', 'right']) v.load(side, {
        path: `${side}.sql`, text: side === 'left' ? left : right,
        encoding: 'utf-8', bom: false, eol: 'LF', size: 1, mtimeMs: 1
      })
      v.setViewMode('all')
      v.setIgnoreWhitespace(false)
    }, { left, right })
    await differences(count)
  }
  const copy = async (from, line = 2, selection) => {
    assert.equal(await page.evaluate(({ from, line, selection }) => {
      const { view: v, monaco } = window.editorTest
      const editor = v.editorFor(from)
      editor.focus()
      if (selection) editor.setSelection(new monaco.Selection(...selection))
      else editor.setPosition({ lineNumber: line, column: 1 })
      return v.copy(from)
    }, { from, line, selection }), true)
  }
  await load('same\nleft\nlast\n', 'same\nright\nlast\n')
  await copy('left')
  await differences(0)
  assert.equal((await snapshot()).right, 'same\nleft\nlast\n')
  assert.equal((await snapshot()).dirty, true)
  await page.evaluate(() => {
    const editor = window.editorTest.view.editorFor('right')
    editor.focus()
    editor.trigger('test', 'undo', null)
  })
  await differences(1)
  assert.equal((await snapshot()).right, 'same\nright\nlast\n')
  assert.equal((await snapshot()).dirty, false)
  await page.evaluate(() => window.editorTest.view.editorFor('right').trigger('test', 'redo', null))
  await differences(0)
  results.push('copy section and undo/redo preserve dirty state')

  await load('a\nnew\nz\n', 'a\nz\n')
  await copy('left')
  await differences(0)
  assert.equal((await snapshot()).right, 'a\nnew\nz\n')
  await load('a\nz\n', 'a\nremove\nz\n')
  await copy('left')
  await differences(0)
  assert.equal((await snapshot()).right, 'a\nz\n')
  results.push('insert and delete sections including empty-side blocks')

  await load('a\nLEFT\nz\n', 'a\nRIGHT\nz\n')
  await copy('right')
  await differences(0)
  assert.equal((await snapshot()).left, 'a\nRIGHT\nz\n')
  await load('a\nfirst\nsecond\nz\n', 'a\none\ntwo\nz\n')
  await copy('left', 2, [2, 1, 3, 1])
  assert.equal((await snapshot()).right, 'a\nfirst\ntwo\nz\n')
  results.push('reverse copy and selected-line mapping')

  await load('a\n one \nz\n', 'a\none\nz\n')
  await page.evaluate(() => window.editorTest.view.setIgnoreWhitespace(true))
  await differences(0)
  results.push('Minor ignores leading/trailing whitespace')

  const common = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  await load(`${common}\nLEFT\n${common}`, `${common}\nRIGHT\n${common}`)
  await page.evaluate(() => window.editorTest.view.setViewMode('diffs'))
  await page.waitForFunction(() => document.querySelectorAll('.filtered-lines').length > 0)
  await page.evaluate(() => window.editorTest.view.setViewMode('context'))
  await page.waitForFunction(() => [...document.querySelectorAll('.filtered-lines')].every((e) => e.textContent.includes('27 FILTERED')))
  await page.evaluate(() => window.editorTest.view.setViewMode('all'))
  assert.equal(await page.locator('.filtered-lines').count(), 0)
  await page.evaluate(() => window.editorTest.view.setWordWrap(true))
  results.push('All/Diffs/Context and Wrap respond without runtime errors')

  await load('LEFT\nsame\n', 'RIGHT\nsame\n')
  await page.evaluate(() => window.editorTest.view.swap())
  assert.equal((await snapshot()).left, 'RIGHT\nsame\n')
  assert.equal((await snapshot()).right, 'LEFT\nsame\n')
  await page.evaluate(() => window.editorTest.view.goToDiff('next'))
  await page.evaluate(() => window.editorTest.view.goToDiff('previous'))
  results.push('Swap retains buffers; next/previous navigation works')

  // จำลองเวลาที่ผู้ใช้พิมพ์ต่อหลังเริ่มบันทึก แต่ก่อน native I/O ส่งผลกลับ
  await page.evaluate(() => {
    const v = window.editorTest.view
    const savedVersion = v.sides.right.model.getAlternativeVersionId()
    v.editorFor('right').executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'new edit' }])
    v.markSaved('right', 10, 1, savedVersion)
  })
  assert.equal((await snapshot()).dirty, true)
  results.push('edits made while save is pending remain modified')
  assert.equal(await page.title(), 'OCompare Monaco regression harness')
  assert.ok(await page.locator('.monaco-editor').count() >= 2)
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  assert.deepEqual(errors, [])
  await mkdir('docs/evidence', { recursive: true })
  await page.screenshot({ path: 'docs/evidence/monaco-headless.png' })
  await writeFile('docs/evidence/editor-tests.json', JSON.stringify({ environment: 'Edge headless, 1400x900; editor harness only, no Tauri API mocks', results, errors }, null, 2) + '\n')
  console.log(`PASS: ${results.length} Monaco scenarios; no page errors`)
  for (const result of results) console.log(`  ${result}`)
} finally {
  await browser?.close()
  await server.close()
}
