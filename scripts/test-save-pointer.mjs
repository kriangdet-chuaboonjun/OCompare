import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Save acts on the side under the mouse pointer; the focused editor only decides when the pointer is over neither.
const root = await mkdtemp(join(tmpdir(), 'ocompare-save-pointer-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture directory')
let server, browser
const checks = []
try {
  const a = join(root, 'a.txt'), b = join(root, 'b.txt')
  await writeFile(a, 'one\n'); await writeFile(b, 'two\n')
  server = await startFolderTestServer(root, 1470)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(server.url); await page.waitForFunction(() => Boolean(window.__ocompare))
  for (const [side, path] of [['left', a], ['right', b]]) {
    const field = page.locator(`.side-head[data-side=${side}] .path`)
    await field.fill(path); await field.press('Enter')
    await page.waitForFunction(({ side, path }) => window.__ocompare.sides[side].path === path, { side, path })
  }
  const dirty = side => page.evaluate(side => window.__ocompare.isDirty(side), side)
  const edit = (side, tag) => page.evaluate(({ side, tag }) => {
    const editor = window.__ocompare.editorFor(side)
    editor.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: `${tag} ` }])
  }, { side, tag })
  const dirtyBoth = async tag => { await edit('left', tag); await edit('right', tag); assert.equal(await dirty('left') && await dirty('right'), true) }
  const focusEditor = side => page.evaluate(side => window.__ocompare.editorFor(side).focus(), side)
  const paneCenter = side => page.evaluate(side => {
    const r = window.__ocompare.editorFor(side).getDomNode().getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, side)
  const mouseTo = async point => { await page.mouse.move(point.x, point.y); await page.mouse.move(point.x + 1, point.y + 1) }
  const centerOf = async selector => { const box = await page.locator(selector).first().boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } }
  const settle = () => page.waitForTimeout(500)

  // 1. Focus is in the LEFT editor, the mouse is over the RIGHT pane: the right side is saved.
  await dirtyBoth('R1')
  await focusEditor('left')
  await mouseTo(await paneCenter('right'))
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('right'))
  await settle()
  assert.equal(await readFile(b, 'utf8'), 'R1 two\n')
  assert.equal(await readFile(a, 'utf8'), 'one\n', 'the focused left file is untouched')
  assert.equal(await dirty('left'), true)
  checks.push('Ctrl+S in the left editor saves the right side when the mouse is over the right pane')

  // 2. Focus is in the RIGHT editor, the mouse is over the LEFT path bar: the left side is saved.
  await edit('right', 'R2')
  await focusEditor('right')
  await mouseTo(await centerOf('.side-head[data-side=left] .infobar'))
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('left'))
  await settle()
  assert.equal(await readFile(a, 'utf8'), 'R1 one\n')
  assert.equal(await dirty('right'), true, 'the focused right side was not saved')
  assert.equal(await readFile(b, 'utf8'), 'R1 two\n')
  checks.push('The left path bar counts as the left side')

  // 3. The mouse is over neither pane (status bar): the focused editor is saved, as before.
  await focusEditor('right')
  await mouseTo(await centerOf('#statusbar'))
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('right'))
  await settle()
  assert.equal(await readFile(b, 'utf8'), 'R2 R1 two\n')
  checks.push('With the mouse outside both sides, Ctrl+S saves the focused editor')

  // 4. Focus is outside Monaco (a path field): the document-level shortcut also follows the mouse.
  await dirtyBoth('R4')
  await page.locator('.side-head[data-side=right] .path').focus()
  await mouseTo(await paneCenter('left'))
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('left'))
  await settle()
  assert.equal(await readFile(a, 'utf8'), 'R4 R1 one\n')
  assert.equal(await dirty('right'), true)
  await mouseTo(await paneCenter('right'))
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('right'))
  await settle()
  assert.equal(await readFile(b, 'utf8'), 'R4 R2 R1 two\n')
  checks.push('Ctrl+S with focus outside the editors saves whichever side the mouse is over')

  // 5. The divider belongs to the closer pane; moving the mouse changes the target immediately.
  await dirtyBoth('R5')
  await focusEditor('left')
  const left = await page.evaluate(() => window.__ocompare.editorFor('left').getDomNode().getBoundingClientRect().toJSON())
  const right = await page.evaluate(() => window.__ocompare.editorFor('right').getDomNode().getBoundingClientRect().toJSON())
  const y = left.top + left.height / 2
  await mouseTo({ x: (left.right + right.left) / 2 + 6, y })
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('right'))
  await settle()
  assert.equal(await dirty('left'), true, 'just right of the divider centre is the right pane')
  await mouseTo({ x: (left.right + right.left) / 2 - 6, y })
  await page.keyboard.press('Control+S')
  await page.waitForFunction(() => !window.__ocompare.isDirty('left'))
  checks.push('The divider is split between the two panes and the target follows the mouse as it moves')

  assert.deepEqual(errors, [])
  console.log(`PASS: ${checks.length} save-follows-mouse scenarios`)
  checks.forEach(check => console.log(`  ${check}`))
} finally {
  await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true })
}
