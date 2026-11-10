import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'
import { clickToolbarCommand } from './toolbar-test-helpers.mjs'

// Real Rust store + real Rust folder scan; only native dialogs are simulated by the test transport.
const root = await mkdtemp(join(tmpdir(), 'ocompare-compare-history-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture directory')
let server, server2, browser
const checks = []
const list = async (s = server) => (await s.call({ action: 'listCompareHistory' })).entries
/** Wait for exactly `count` entries, then prove no late duplicate arrives. */
let current
const expectEntries = async (count, s = server) => {
  const until = Date.now() + 8000
  while ((await list(s)).length < count) {
    if (Date.now() > until) {
      const note = current ? await current.locator('#st-msg').textContent().catch(() => '?') : ''
      throw new Error(`Expected ${count} history entries, found ${(await list(s)).length} (status bar: "${note}")`)
    }
    await new Promise(r => setTimeout(r, 50))
  }
  await new Promise(r => setTimeout(r, 700))
  assert.equal((await list(s)).length, count, `exactly ${count} history entries`)
  return list(s)
}
try {
  const a = join(root, 'a.txt'), b = join(root, 'b.txt'), same1 = join(root, 'same1.txt'), same2 = join(root, 'same2.txt')
  await writeFile(a, 'one\ntwo\nthree\n'); await writeFile(b, 'one\nTWO\nthree\n')
  await writeFile(same1, 'alpha\nbeta\n'); await writeFile(same2, 'alpha\nbeta\n')
  const left = join(root, 'left'), right = join(root, 'right'), empty1 = join(root, 'empty1'), empty2 = join(root, 'empty2')
  await Promise.all([left, right, empty1, empty2].map(dir => mkdir(dir, { recursive: true })))
  for (const [dir, name, text] of [
    [left, 'same1.txt', 'x\n'], [right, 'same1.txt', 'x\n'], [left, 'same2.txt', 'y\n'], [right, 'same2.txt', 'y\n'],
    [left, 'diff.txt', 'left\n'], [right, 'diff.txt', 'right\n'], [left, 'onlyL.txt', 'l\n'],
    [right, 'onlyR1.txt', 'r1\n'], [right, 'onlyR2.txt', 'r2\n'],
  ]) await writeFile(join(dir, name), text)

  server = await startFolderTestServer(root, 1460)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const errors = []
  const fresh = async (url = server.url) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(url); await page.waitForFunction(() => Boolean(window.__ocompare))
    current = page
    return page
  }
  const open = async (page, side, path) => {
    const field = page.locator(`.side-head[data-side=${side}] .path`)
    await field.fill(path); await field.press('Enter')
    await page.waitForFunction(({ side, path }) => window.__ocompare.sides[side].path === path, { side, path })
  }
  const status = page => page.locator('#st-msg').textContent()

  // ---- Files ----
  let page = await fresh()
  assert.deepEqual(await list(), [], 'no history before any comparison')
  await open(page, 'left', a)
  await new Promise(r => setTimeout(r, 600))
  assert.deepEqual(await list(), [], 'loading one side is not a comparison')
  await open(page, 'right', b)
  let entries = await expectEntries(1)
  assert.equal(entries[0].kind, 'file'); assert.equal(entries[0].leftPath, a); assert.equal(entries[0].rightPath, b)
  assert.equal(entries[0].result.status, 'different'); assert.ok(entries[0].result.changeCount >= 1)
  assert.ok(Math.abs(entries[0].createdAtMs - Date.now()) < 60_000)
  checks.push('Files: loading a differing pair records exactly one "different" entry (one side alone records nothing)')

  await clickToolbarCommand(page, '#file-tools [data-cmd=compare]')
  entries = await expectEntries(2)
  assert.equal(entries[1].leftPath, a); assert.equal(entries[1].rightPath, b); assert.equal(entries[1].result.status, 'different')
  assert.notEqual(entries[1].id, entries[0].id)
  checks.push('Files: Compare on the same pair again creates a new entry')

  await page.keyboard.press('F5')
  await page.evaluate(() => { const e = window.__ocompare.editorFor('right'); e.focus(); e.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'edit ' }]) })
  await page.waitForTimeout(900)
  assert.equal((await list()).length, 2, 'F5 reload and typing are not Compare runs')
  checks.push('Files: F5 reload and editing text do not create entries')

  page = await fresh()
  await open(page, 'left', same1); await open(page, 'right', same2)
  entries = await expectEntries(3)
  assert.equal(entries[2].result.status, 'identical'); assert.equal(entries[2].result.changeCount, 0)
  await clickToolbarCommand(page, '#file-tools [data-cmd=compare]')
  entries = await expectEntries(4)
  assert.equal(entries[3].result.status, 'identical')
  checks.push('Files: identical pair is recorded as "identical" and re-run adds another entry')

  // Cancel: edit the pair right after it loads, before Monaco finishes the diff.
  const before = (await list()).length
  page = await fresh()
  await open(page, 'left', a)
  const rightField = page.locator('.side-head[data-side=right] .path')
  await rightField.fill(b); await rightField.press('Enter')
  await page.waitForFunction(path => {
    if (window.__ocompare.sides.right.path !== path) return false
    const e = window.__ocompare.editorFor('right')
    e.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'changed ' }])
    return true
  }, b)
  await page.waitForTimeout(1000)
  assert.equal((await list()).length, before, 'a run superseded by an edit before the diff finished is skipped')
  checks.push('Files: a comparison interrupted by an edit before it completes is skipped')

  // Failure: unreadable path (inside the fixture root, but missing).
  const missing = join(root, 'does-not-exist.txt')
  page = await fresh()
  await open(page, 'left', a)
  const field = page.locator('.side-head[data-side=right] .path')
  await field.fill(missing); await field.press('Enter')
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('Cannot open'))
  await page.waitForTimeout(800)
  assert.equal((await list()).length, before, 'a failed load records nothing')
  checks.push('Files: reading a missing file fails visibly and records nothing')

  // ---- Folders ----
  const base = (await list()).length
  page = await fresh()
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-root=left]').fill(left); await page.locator('[data-root=right]').fill(right)
  const complete = async () => {
    await page.waitForFunction(() => document.querySelector('.folder-progress').textContent === 'Comparison complete')
    await page.waitForFunction(() => !document.querySelector('[data-folder-cmd=compare]').disabled)
  }
  await page.locator('[data-folder-cmd=compare]').click(); await complete()
  entries = await expectEntries(base + 1)
  const folderEntry = entries.at(-1)
  assert.equal(folderEntry.kind, 'folder'); assert.equal(folderEntry.leftPath, left); assert.equal(folderEntry.rightPath, right)
  assert.deepEqual(folderEntry.result, { files: 6, directories: 0, identical: 2, minor: 0, different: 1, leftOnly: 1, rightOnly: 2, errors: 0, skipped: 0 })
  checks.push('Folders: a 6-file comparison (same/different/left-only/right-only) produces ONE entry with the real summary')

  await page.locator('[data-folder-cmd=refresh]').click(); await complete()
  entries = await expectEntries(base + 2)
  assert.deepEqual(entries.at(-1).result, folderEntry.result)
  assert.equal(entries.at(-1).leftPath, left)
  checks.push('Folders: comparing the same pair again creates a new entry')

  // Cancel in the middle of a comparison.
  await page.evaluate(() => { window.compareDelayMs = 2500 })
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() => !document.querySelector('[data-folder-cmd=cancel]').disabled)
  await page.locator('[data-folder-cmd=cancel]').click()
  await page.waitForFunction(() => document.querySelector('.folder-progress').textContent.startsWith('Canceled'))
  await page.waitForTimeout(3200)
  assert.equal((await list()).length, base + 2, 'canceled comparison records nothing')
  await page.evaluate(() => { window.compareDelayMs = 0 })
  checks.push('Folders: Stop during a comparison records nothing')

  // Failure: a root that does not exist.
  await page.locator('[data-root=left]').fill(join(root, 'no-such-folder'))
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() => !document.querySelector('[data-folder-cmd=compare]').disabled && !/Scanning|Comparison complete/.test(document.querySelector('.folder-progress').textContent))
  await page.waitForTimeout(800)
  assert.equal((await list()).length, base + 2, 'failed comparison records nothing')
  checks.push('Folders: a failing comparison (missing root) records nothing and shows the error')

  // All-identical folders still count.
  await page.locator('[data-root=left]').fill(empty1); await page.locator('[data-root=right]').fill(empty2)
  await page.locator('[data-folder-cmd=compare]').click(); await complete()
  entries = await expectEntries(base + 3)
  assert.equal(entries.at(-1).result.files, 0); assert.equal(entries.at(-1).result.different, 0)
  checks.push('Folders: a comparison with no differences is recorded')

  // ---- One History dialog: newest first, live updates, English labels ----
  await clickToolbarCommand(page, '[data-folder-cmd=history]')
  const dialog = page.getByRole('dialog', { name: 'History', exact: true })
  await dialog.waitFor()
  const total = (await list()).length
  assert.equal(await dialog.locator('tbody tr').count(), total)
  assert.equal(await dialog.locator('tbody tr').first().getAttribute('data-type'), 'run')
  assert.match(await dialog.locator('tbody tr').first().textContent(), /Compare · Folder/)
  assert.match(await dialog.locator('tbody tr').last().textContent(), /Compare · File/)
  assert.match(await dialog.locator('tbody tr').nth(1).textContent(), /Same 2 · Different 1 · Left only 1 · Right only 2/)
  assert.match(await dialog.locator('tbody tr').last().textContent(), /Different/)
  for (const heading of ['Date / time', 'Type', 'Left', 'Right', 'Result']) await dialog.getByRole('columnheader', { name: heading, exact: true }).waitFor()
  await page.evaluate(() => { document.querySelector('[data-folder-cmd=compare]').click() })
  await page.waitForFunction(n => document.querySelectorAll('.backup-history tbody tr').length === n, total + 1)
  checks.push('One History dialog lists comparisons newest first and shows a new run immediately while open')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expectEntries(total + 1)

  // ---- Persistence across restart (new Rust process, same app-data file) ----
  const persisted = await list()
  await page.close(); await server.close(); server = null
  server2 = await startFolderTestServer(root, 1461)
  assert.deepEqual(await list(server2), persisted)
  page = await fresh(server2.url)
  await clickToolbarCommand(page, '#file-tools [data-cmd=history]')
  const reopened = page.getByRole('dialog', { name: 'History', exact: true })
  await reopened.waitFor()
  assert.equal(await reopened.locator('tbody tr').count(), persisted.length)
  await reopened.getByRole('button', { name: 'Close', exact: true }).click()
  checks.push('History survives an application restart')

  // ---- Pasted text (no file) is recorded too, with a snapshot ----
  const paste = (pg, side, text) => pg.evaluate(({ side, text }) => {
    const editor = window.__ocompare.editorFor(side)
    editor.focus()
    const data = new DataTransfer()
    data.setData('text/plain', text)
    // Monaco takes input through the EditContext element (a textarea only as a fallback).
    const input = editor.getDomNode().querySelector('.native-edit-context') ?? editor.getDomNode().querySelector('textarea')
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { side, text })
  const snapshot = (entryId, side) => server2.call({ action: 'readCompareSnapshot', entryId, side })
  // New empty models use the platform EOL (CRLF on Windows), so stored pasted text may carry it.
  const lf = text => text.replaceAll('\r\n', '\n')
  const startCount = (await list(server2)).length
  page = await fresh(server2.url)
  await paste(page, 'left', 'alpha\nbeta\n')
  await page.waitForTimeout(900)
  assert.equal((await list(server2)).length, startCount, 'text on one side only is not a comparison')
  await paste(page, 'right', 'alpha\nBETA\n')
  entries = await expectEntries(startCount + 1, server2)
  let pasted = entries.at(-1)
  assert.equal(pasted.kind, 'file'); assert.equal(pasted.leftPath, 'Pasted text'); assert.equal(pasted.rightPath, 'Pasted text')
  assert.equal(pasted.leftText, true); assert.equal(pasted.rightText, true); assert.equal(pasted.result.status, 'different')
  assert.equal(lf(await snapshot(pasted.id, 'left')), 'alpha\nbeta\n'); assert.equal(lf(await snapshot(pasted.id, 'right')), 'alpha\nBETA\n')
  checks.push('Pasted text on both sides: one entry, flagged as text, content stored and readable')

  await page.evaluate(() => { const e = window.__ocompare.editorFor('right'); e.focus(); e.executeEdits('test', [{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 5 }, text: 'beta' }]) })
  await page.waitForTimeout(900)
  assert.equal((await list(server2)).length, startCount + 1, 'typing is not a comparison')
  await clickToolbarCommand(page, '#file-tools [data-cmd=compare]')
  entries = await expectEntries(startCount + 2, server2)
  pasted = entries.at(-1)
  assert.equal(pasted.result.status, 'identical'); assert.equal(lf(await snapshot(pasted.id, 'right')), 'alpha\nbeta\n')
  checks.push('Compare button on pasted text records a new run from the current text; typing alone does not')

  page = await fresh(server2.url)
  await open(page, 'left', a)
  await paste(page, 'right', 'one\ntwo\nthree\n')
  entries = await expectEntries(startCount + 3, server2)
  const mixed = entries.at(-1)
  assert.equal(mixed.leftPath, a); assert.equal(mixed.leftText, undefined); assert.equal(mixed.rightPath, 'Pasted text'); assert.equal(mixed.rightText, true)
  assert.equal(mixed.result.status, 'identical')
  await assert.rejects(snapshot(mixed.id, 'left'), /No saved text/)
  checks.push('A file on one side and pasted text on the other is recorded and only the text is stored')

  // A file side with unsaved edits is not what is on disk, so it is not recorded under that path.
  await page.evaluate(() => { const e = window.__ocompare.editorFor('left'); e.focus(); e.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'dirty ' }]) })
  await paste(page, 'right', 'whatever\n')
  await page.waitForTimeout(900)
  assert.equal((await list(server2)).length, startCount + 3, 'an edited file side is never recorded under its path')
  checks.push('Pasting beside a file with unsaved edits records nothing')

  // ---- Combined History: filters, saved versions beside comparisons, reopening ----
  const c = join(root, 'c.txt'); await writeFile(c, 'saved\n')
  page = await fresh(server2.url)
  await open(page, 'left', c)
  await page.evaluate(() => { const e = window.__ocompare.editorFor('left'); e.focus(); e.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'v2 ' }]) })
  await page.locator('.side-head[data-side=left] .save').click()
  await page.waitForFunction(() => !window.__ocompare.isDirty('left'))
  const versions = await server2.call({ action: 'listAllHistory' })
  const verbatim = versions.find(v => v.path.toLowerCase().endsWith('c.txt') && v.reason === 'Save')
  assert.ok(verbatim, 'Save created a version of c.txt')
  await page.evaluate(() => window.__ocompare.editorFor('left').focus())
  await clickToolbarCommand(page, '#file-tools [data-cmd=history]')
  const combined = page.getByRole('dialog', { name: 'History', exact: true })
  await combined.waitFor()
  const rowsOf = type => combined.locator(`tbody tr[data-type=${type}]`)
  assert.equal(await rowsOf('run').count(), 0, 'with a file in focus the dialog starts on its saved versions')
  assert.ok(await rowsOf('version').count() >= 1)
  assert.doesNotMatch(await rowsOf('version').first().textContent(), /\\\\\?\\/, 'saved versions show ordinary paths, not \\\\?\\ verbatim ones')
  assert.equal(await combined.getByRole('combobox', { name: 'Show' }).isDisabled(), true)
  await combined.getByRole('button', { name: 'Show all history', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.backup-history tbody tr[data-type=run]').length > 0)
  assert.ok(await rowsOf('version').count() >= 1)
  assert.equal(await combined.locator('tbody tr').count(), (await list(server2)).length + (await server2.call({ action: 'listAllHistory' })).length)
  await combined.getByRole('combobox', { name: 'Show' }).selectOption('runs')
  assert.equal(await rowsOf('version').count(), 0); assert.equal(await rowsOf('run').count(), (await list(server2)).length)
  await combined.getByRole('combobox', { name: 'Show' }).selectOption('versions')
  assert.equal(await rowsOf('run').count(), 0)
  await combined.getByRole('combobox', { name: 'Show' }).selectOption('all')
  await combined.getByRole('searchbox', { name: 'Filter by path' }).fill('Pasted')
  assert.ok(await combined.locator('tbody tr').count() >= 3)
  assert.equal(await rowsOf('version').count(), 0, 'path filter hides non-matching rows')
  checks.push('One History: starts on the focused file\'s saved versions, "Show all history" adds comparisons, filters and search narrow the timeline')

  // Open a recorded comparison: pasted text comes back from its snapshot, and viewing is not a new run.
  const beforeOpen = (await list(server2)).length
  const bothPasted = (await list(server2))[startCount + 1]
  assert.ok(bothPasted.leftText && bothPasted.rightText)
  await combined.locator(`tbody tr[data-key="run:${bothPasted.id}"]`).click()
  assert.equal(await combined.getByRole('button', { name: 'Restore', exact: true }).isDisabled(), true, 'a comparison row cannot be restored')
  await combined.getByRole('button', { name: 'Open', exact: true }).click()
  const leftSnapshot = await snapshot(bothPasted.id, 'left')
  await page.waitForFunction(text => window.__ocompare.textOf('left') === text, leftSnapshot)
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('right')), await snapshot(bothPasted.id, 'right'))
  assert.equal(await page.evaluate(() => window.__ocompare.sides.left.path), null)
  assert.equal(await page.evaluate(() => window.__ocompare.sides.right.path), null)
  await page.waitForTimeout(900)
  assert.equal((await list(server2)).length, beforeOpen, 'reopening a comparison does not record another')
  checks.push('History > Open restores a pasted-text comparison from its snapshot without recording a new run')

  // ---- Save failure: tell the user, still show the comparison ----
  const historyFile = join(root, 'sessions.compare-history.json')
  const goodBytes = await readFile(historyFile)
  await writeFile(historyFile, '{broken')
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-root=left]').fill(left); await page.locator('[data-root=right]').fill(right)
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() => document.querySelector('.folder-progress').textContent.startsWith('Compare history could not be saved'))
  assert.equal(await page.locator('.folder-summary').textContent().then(t => /6 files|files/.test(t)), true)
  assert.ok(await page.locator('[data-path="diff.txt"]').count() > 0, 'comparison result still displayed')
  assert.equal(await readFile(historyFile, 'utf8'), '{broken', 'the damaged file is preserved, not overwritten')
  await page.locator('[data-mode=files]').click()
  await open(page, 'left', a); await open(page, 'right', b)
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.startsWith('Compare history could not be saved'))
  assert.ok(await page.evaluate(() => window.__ocompare.diffCount()) >= 1, 'file diff still displayed')
  await writeFile(historyFile, goodBytes)
  checks.push('Save failure: user is told, comparison result stays visible, damaged history is never overwritten')

  await page.waitForTimeout(300)
  assert.deepEqual(errors, [])
  console.log(`PASS: ${checks.length} compare history scenarios`)
  checks.forEach(check => console.log(`  ${check}`))
} finally {
  await browser?.close(); await server?.close(); await server2?.close(); await rm(root, { recursive: true, force: true })
}
