import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Real Rust canonicalizer and files behind the browser transport; only dialogs are simulated.
const root = await mkdtemp(join(tmpdir(), 'ocompare-structural-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture directory')
let server, browser
const checks = []
try {
  await Promise.all([mkdir(join(root, 'l'), { recursive: true }), mkdir(join(root, 'r'), { recursive: true })])
  const leftJson = join(root, 'l', 'config.json'), rightJson = join(root, 'r', 'config.json')
  const leftText = join(root, 'l', 'notes.txt'), rightText = join(root, 'r', 'notes.txt')
  await writeFile(leftJson, '{"a":1,"b":{"x":1,"y":2}}\n')
  await writeFile(rightJson, '{\n  "b": {"y": 2, "x": 1},\n  "a": 1\n}\n')
  await writeFile(leftText, 'plain words\n'); await writeFile(rightText, 'other words\n')
  server = await startFolderTestServer(root, 1457)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(server.url); await page.waitForFunction(() => Boolean(window.__ocompare))

  const open = async (side, path) => {
    const field = page.locator(`.side-head[data-side=${side}] .path`)
    await field.fill(path); await field.press('Enter')
    await page.waitForFunction(({ side, path }) => window.__ocompare.sides[side].path === path, { side, path })
  }
  const diffs = n => page.waitForFunction(n => { const c = window.__ocompare.editor.getLineChanges(); return c !== null && c.length === n }, n)
  const tabCount = () => page.locator('#file-tabs .file-tab').count()
  const selectTab = index => page.locator('#file-tabs .file-tab-label').nth(index).click()
  const message = () => page.locator('#st-msg').textContent()
  const pressStructural = () => page.locator('#file-tools [data-cmd=structural]').click()
  const textOf = side => page.evaluate(side => window.__ocompare.textOf(side), side)
  const pathOf = side => page.evaluate(side => window.__ocompare.sides[side].path, side)
  const setText = (side, text) => page.evaluate(({ side, text }) => window.__ocompare.sides[side].model.setValue(text), { side, text })
  const waitStructural = () => page.waitForFunction(() => window.__ocompare.sides.left.path?.startsWith('structural://'))

  assert.equal(await server.call({ action: 'canonicalizeStructural', text: '{"b":1,"a":2}', format: 'json' }), '{\n  "a": 2,\n  "b": 1\n}\n')
  await assert.rejects(server.call({ action: 'canonicalizeStructural', text: '{bad', format: 'json' }), /^Error: JSON parse error at line 1/)
  checks.push('Browser transport reaches the Rust canonicalizer and reports parse errors')

  // Same file name in two folders, differing only by key order and whitespace.
  await open('left', leftJson); await open('right', rightJson)
  await page.waitForFunction(() => window.__ocompare.diffCount() > 0)
  await pressStructural(); await waitStructural(); await diffs(0)
  assert.equal(await tabCount(), 2)
  const structuralLeft = await pathOf('left'), structuralRight = await pathOf('right')
  assert.match(structuralLeft, /^structural:\/\/json\/left\/.+\/l\/config\.json$/)
  assert.match(structuralRight, /^structural:\/\/json\/right\/.+\/r\/config\.json$/)
  assert.notEqual(structuralLeft, structuralRight)
  assert.equal(await textOf('left'), '{\n  "a": 1,\n  "b": {\n    "x": 1,\n    "y": 2\n  }\n}\n')
  assert.equal(await textOf('left'), await textOf('right'))
  assert.match(await page.locator('#file-tabs .file-tab-label').nth(1).textContent(), /\[Structural\]/)
  await selectTab(0); await diffs(1)
  for (const side of ['left', 'right']) assert.equal(await page.evaluate(side => window.__ocompare.isDirty(side), side), false)
  checks.push('Key order and whitespace are not differences; same-named files in different folders keep separate models; source tab is untouched')

  // Pressing Structural again refreshes the same tab with the current editor text.
  await setText('right', '{"b":{"y":3,"x":1},"a":1}')
  await pressStructural(); await waitStructural(); await diffs(1)
  assert.equal(await tabCount(), 2)
  assert.match(await textOf('right'), /"y": 3/)
  await selectTab(0); await setText('right', '{"b":{"x":1,"y":2},"a":1}')
  await pressStructural(); await waitStructural(); await diffs(0)
  assert.equal(await tabCount(), 2)
  assert.match(await textOf('right'), /"y": 2/)
  checks.push('Refresh reuses the Structural tab and loads the new text in both directions')

  // A parse error on either side creates and changes nothing.
  const before = await textOf('right')
  await selectTab(0); await setText('right', '{bad')
  await pressStructural()
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('Right: JSON parse error at line 1'))
  assert.equal(await tabCount(), 2)
  assert.equal(await pathOf('right'), rightJson)
  await selectTab(1); assert.equal(await textOf('right'), before)
  await selectTab(0); await setText('right', '{"b":{"x":1,"y":2},"a":1}'); await setText('left', '[')
  await pressStructural()
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('Left: JSON parse error'))
  assert.equal(await tabCount(), 2)
  checks.push('Parse errors name the side and line:column and leave tabs unchanged')

  // Structural on a derived tab explains itself instead of nesting.
  await selectTab(1); await pressStructural()
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent === 'Press Structural on the original comparison tab')
  assert.equal(await tabCount(), 2)
  for (const side of ['left', 'right']) {
    assert.equal(await page.locator(`.side-head[data-side=${side}] .save`).isDisabled(), true)
    assert.equal(await page.evaluate(side => window.__ocompare.editorFor(side).getRawOptions().readOnly, side), true)
  }
  assert.equal(await page.evaluate(() => window.__ocompare.copy('left')), false)
  checks.push('Structural tabs are read-only and refuse to nest')

  // Pasted text in Untitled editors is detected from its content.
  await page.locator('#tab-add').click()
  await setText('left', '{"a":[1,2]}'); await setText('right', '{ "a" : [1,\n 2] }')
  await pressStructural(); await waitStructural(); await diffs(0)
  assert.match(await pathOf('left'), /^structural:\/\/json\/left\/untitled-document-\d+\/Untitled$/)
  assert.equal(await page.evaluate(() => window.__ocompare.sides.left.model.getLanguageId()), 'json')
  const tabsAfterPaste = await tabCount()
  checks.push('Untitled editors with pasted JSON are compared structurally')

  // A saved file of an unknown type is refused with an explanation.
  await page.locator('#tab-add').click()
  await open('left', leftText); await open('right', rightText)
  await pressStructural()
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.includes('another file type'))
  assert.equal(await tabCount(), tabsAfterPaste + 1)
  checks.push('Unknown file types are refused without opening a tab')

  // XML: attribute order, <a/> vs <a></a>, comments and indentation are not differences.
  const leftXml = join(root, 'l', 'app.config'), rightXml = join(root, 'r', 'app.config')
  await writeFile(leftXml, '<?xml version="1.0"?>\n<cfg b="2" a="1"><item/><!-- note --><name>x</name></cfg>\n')
  await writeFile(rightXml, '<cfg a="1" b="2">\n  <item></item>\n  <name>x</name>\n</cfg>')
  await page.locator('#tab-add').click()
  await open('left', leftXml); await open('right', rightXml)
  await page.waitForFunction(() => window.__ocompare.diffCount() > 0)
  await pressStructural(); await waitStructural(); await diffs(0)
  assert.match(await pathOf('left'), /^structural:\/\/xml\/left\//)
  assert.equal(await page.evaluate(() => window.__ocompare.sides.left.model.getLanguageId()), 'xml')
  await selectTab(await tabCount() - 2); await setText('right', '<cfg a="1" b="2"><item/><name>y</name></cfg>')
  await pressStructural(); await waitStructural(); await diffs(1)
  checks.push('XML canonical form ignores attribute order, empty-element spelling, comments and indentation')

  // CSV: delimiter and quoting style are not differences; a changed cell is.
  const leftCsv = join(root, 'l', 'rows.csv'), rightCsv = join(root, 'r', 'rows.csv')
  await writeFile(leftCsv, 'id,name\r\n1,"Ann"\r\n2,"B, C"\r\n')
  await writeFile(rightCsv, 'id;name\n1;Ann\n2;"B, C"\n')
  await page.locator('#tab-add').click()
  await open('left', leftCsv); await open('right', rightCsv)
  await page.waitForFunction(() => window.__ocompare.diffCount() > 0)
  await pressStructural(); await waitStructural(); await diffs(0)
  assert.match(await pathOf('left'), /^structural:\/\/csv\/left\//)
  assert.equal(await textOf('left'), 'id,name\n1,Ann\n2,"B, C"\n')
  assert.equal(await page.evaluate(() => window.__ocompare.sides.left.model.getLanguageId()), 'plaintext')
  await selectTab(await tabCount() - 2); await setText('right', 'id;name\n1;Anna\n2;"B, C"\n')
  await pressStructural(); await waitStructural(); await diffs(1)
  checks.push('CSV canonical form ignores delimiter, quoting and line endings; a changed cell is one difference')

  // Derived paths are read-only like History snapshots, wherever they are loaded.
  const virtual = { path: 'structural://json/right/x/a.json', text: '{}\n', encoding: 'utf-8', bom: false, eol: 'LF', size: 3, mtimeMs: 1 }
  await page.evaluate(file => {
    const v = window.__ocompare
    v.loadDocument(v.sides.left, { ...file, path: 'structural://json/left/x/a.json' })
    v.loadDocument(v.sides.right, file)
  }, virtual)
  await page.waitForFunction(() => document.querySelector('.side-head[data-side=right] .path').value.includes('[Structural — read-only]'))
  assert.equal(await page.locator('.side-head[data-side=right] .path').evaluate(el => el.readOnly), true)
  checks.push('Structural paths show a read-only header like History snapshots')

  await page.waitForTimeout(200)
  assert.deepEqual(errors, [])
  console.log(`PASS: ${checks.length} structural compare scenarios`)
  checks.forEach(check => console.log(`  ${check}`))
} finally {
  await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true })
}
