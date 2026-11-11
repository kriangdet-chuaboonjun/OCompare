import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, chmod, rename, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Close = the app's close request (what the window × runs); "reopen" = a brand-new page on the same data folder.
const root = await mkdtemp(join(tmpdir(), 'ocompare-recovery-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture directory')
const draftsFile = join(root, 'tab-drafts.json')
let server, browser
const checks = []
const lf = text => text.replace(/\r\n/g, '\n')
const file = name => join(root, name)
const fingerprint = async path => { const s = await stat(path); return `${s.mtimeMs}:${await readFile(path, 'utf8')}` }
try {
  server = await startFolderTestServer(root, 1472)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const errors = []
  const launch = async (query = '', expect = null) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(server.url + query)
    await page.waitForFunction(() => Boolean(window.__ocompare) && Boolean(window.__ocompareClose))
    if (expect) await page.waitForFunction(text => document.querySelector('#st-msg')?.textContent?.includes(text), expect)
    else await page.waitForTimeout(700)
    return page
  }
  const closeApp = async page => { const closed = await page.evaluate(() => window.__ocompareClose()); await page.close(); return closed }
  const status = page => page.locator('#st-msg').textContent()
  const labels = page => page.locator('#file-tabs .file-tab-label').allTextContents()
  const activeIndex = page => page.evaluate(() => [...document.querySelectorAll('#file-tabs .file-tab-label')].findIndex(l => l.getAttribute('aria-selected') === 'true'))
  const select = async (page, index) => { await page.locator('#file-tabs .file-tab-label').nth(index).click(); await page.waitForTimeout(80) }
  const addTab = async page => { await page.locator('#tab-add').click(); await page.waitForTimeout(80) }
  const side = (page, which) => page.evaluate(which => {
    const s = window.__ocompare.sides[which]
    return { id: s.id, path: s.path, text: s.model.getValue(), dirty: window.__ocompare.isDirty(which) }
  }, which)
  const badge = (page, which) => page.locator(`.side-head[data-side=${which}] .dirty`).textContent()
  const loadPath = async (page, which, path) => {
    const field = page.locator(`.side-head[data-side=${which}] .path`)
    await field.fill(path); await field.press('Enter')
    await page.waitForFunction(({ which, path }) => window.__ocompare.sides[which].path === path, { which, path })
  }
  const type = (page, which, text) => page.evaluate(({ which, text }) => {
    window.__ocompare.editorFor(which).executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text }])
  }, { which, text })
  const save = async (page, which) => { await page.locator(`.side-head[data-side=${which}] .save`).click(); await page.waitForTimeout(400) }
  const forget = () => server.call({ action: 'clearTabDrafts' })

  // Fixtures. Thai text everywhere, so the encoding survives the round trip.
  const content = { 'a.txt': 'ไฟล์ซ้ายเดิม\nบรรทัดสอง\n', 'b.txt': 'ไฟล์ขวาเดิม\n', 'c.txt': 'คลีนซ้าย\n', 'd.txt': 'คลีนขวา\n', 'e.txt': 'ไฟล์ที่ห้า\n' }
  for (const [name, text] of Object.entries(content)) await writeFile(file(name), text)

  // ---- 1. Several tabs: untitled Thai on both sides, edited originals, shared file, clean and empty tabs ----
  let page = await launch()
  await loadPath(page, 'left', file('a.txt')); await loadPath(page, 'right', file('b.txt'))
  await type(page, 'left', 'แก้ไขซ้าย ')                               // tab 1: a.txt edited, b.txt clean
  await addTab(page); await type(page, 'left', 'ร่างซ้ายใหม่\n'); await type(page, 'right', 'ร่างขวาใหม่\n') // tab 2: untitled, Thai both sides
  await addTab(page)                                                   // tab 3: empty, must not come back
  await addTab(page); await loadPath(page, 'left', file('c.txt')); await loadPath(page, 'right', file('d.txt')) // tab 4: clean
  await addTab(page); await loadPath(page, 'left', file('a.txt')); await loadPath(page, 'right', file('e.txt'))  // tab 5: a.txt again (shared document)
  await type(page, 'right', 'แก้ขวา ')
  assert.equal((await side(page, 'left')).dirty, true, 'a.txt is one document across tabs, so it is modified here too')
  await select(page, 1)
  assert.equal(await activeIndex(page), 1)
  const before = Object.fromEntries(await Promise.all(Object.keys(content).map(async name => [name, await fingerprint(file(name))])))
  assert.equal(await closeApp(page), true, 'closing needs no Save or Save As')
  for (const name of Object.keys(content)) assert.equal(await fingerprint(file(name)), before[name], `${name} untouched by closing`)
  checks.push('Closing with unsaved tabs needs no Save/Save As and leaves every original file untouched')

  page = await launch('', 'Restored 3 tabs')
  const names = await labels(page)
  assert.equal(names.length, 3, `empty and clean tabs are not restored: ${names}`)
  assert.ok(names.every(name => name.startsWith('● ')), `restored tabs show the modified marker: ${names}`)
  assert.match(names[0], /a\.txt ↔ b\.txt/); assert.match(names[1], /Untitled ↔ Untitled/); assert.match(names[2], /a\.txt ↔ e\.txt/)
  assert.equal(await activeIndex(page), 1, 'the tab that was active is selected again')
  assert.deepEqual([(await side(page, 'left')).text, (await side(page, 'right')).text].map(lf), ['ร่างซ้ายใหม่\n', 'ร่างขวาใหม่\n'])
  assert.deepEqual([(await side(page, 'left')).path, (await side(page, 'right')).path], [null, null])
  assert.deepEqual([(await side(page, 'left')).dirty, (await side(page, 'right')).dirty], [true, true])
  assert.equal(await badge(page, 'left'), '● modified')
  checks.push('Untitled tab with Thai text on both sides is restored in its position, still modified, and active')

  await select(page, 0)
  const t1l = await side(page, 'left'), t1r = await side(page, 'right')
  assert.equal(t1l.path, file('a.txt')); assert.equal(lf(t1l.text), 'แก้ไขซ้าย ไฟล์ซ้ายเดิม\nบรรทัดสอง\n'); assert.equal(t1l.dirty, true)
  assert.equal(t1r.path, file('b.txt')); assert.equal(lf(t1r.text), content['b.txt']); assert.equal(t1r.dirty, false, 'a clean side is read again from its path')
  assert.equal(await badge(page, 'left'), '● modified', 'an unchanged original shows no disk warning')
  await select(page, 2)
  const t5l = await side(page, 'left'), t5r = await side(page, 'right')
  assert.equal(t5l.id, t1l.id, 'the file open in two tabs is one shared document after restoring')
  assert.equal(lf(t5r.text), 'แก้ขวา ไฟล์ที่ห้า\n'); assert.equal(t5r.dirty, true)
  checks.push('Edited originals come back with their path and text; the clean side is read from disk; a shared file stays one document')

  // The restored drafts save normally: Save for the original, Save As (dialog) for the untitled text.
  await select(page, 0)
  await save(page, 'left')
  assert.equal(await readFile(file('a.txt'), 'utf8'), 'แก้ไขซ้าย ไฟล์ซ้ายเดิม\nบรรทัดสอง\n')
  assert.equal((await side(page, 'left')).dirty, false)
  await select(page, 1)
  await page.evaluate(path => { window.testSavePath = path }, file('ใหม่.txt'))
  await save(page, 'left')
  assert.equal(lf(await readFile(file('ใหม่.txt'), 'utf8')), 'ร่างซ้ายใหม่\n')
  assert.equal((await side(page, 'left')).path, file('ใหม่.txt'))
  await page.evaluate(() => { window.testSavePath = null })
  checks.push('A restored draft can be saved over its file and an untitled draft saved through Save As')
  assert.equal(await closeApp(page), true)
  await forget()

  // ---- 2. Close-tab Discard never comes back; Save leaves nothing behind ----
  await writeFile(file('a.txt'), content['a.txt'])
  page = await launch()
  await loadPath(page, 'left', file('a.txt')); await type(page, 'left', 'ทิ้ง ')
  await addTab(page); await type(page, 'left', 'เก็บไว้\n')
  await addTab(page); await loadPath(page, 'left', file('c.txt')); await type(page, 'left', 'บันทึก ')
  await page.locator('#file-tabs .file-tab-close').nth(0).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click()
  await page.waitForTimeout(200)
  await page.locator('#file-tabs .file-tab-close').nth(1).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(500)
  assert.equal(await readFile(file('c.txt'), 'utf8'), 'บันทึก คลีนซ้าย\n')
  assert.equal((await labels(page)).length, 1)
  assert.equal(await closeApp(page), true)
  page = await launch('', 'Restored 1 tab ')
  assert.deepEqual((await labels(page)).map(lf), ['● Untitled ↔ Untitled'])
  assert.equal(lf((await side(page, 'left')).text), 'เก็บไว้\n')
  assert.equal(await readFile(file('a.txt'), 'utf8'), content['a.txt'], 'the discarded edit never reached the file')
  checks.push('A draft discarded when closing its tab (× / Ctrl+W) does not return after a normal close; a saved one leaves nothing to restore')
  assert.equal(await closeApp(page), true)
  await forget()

  // ---- 3. The original changed, vanished or moved while OCompare was closed ----
  const names3 = ['h.txt', 'i.txt', 'j.txt', 'k.txt', 'l.txt', 'm.txt', 'n.txt', 'o.txt']
  for (const name of names3) await writeFile(file(name), `${name} เดิม\n`)
  page = await launch()
  await loadPath(page, 'left', file('h.txt')); await loadPath(page, 'right', file('i.txt')); await type(page, 'left', 'ร่างH ')
  await addTab(page); await loadPath(page, 'left', file('j.txt')); await loadPath(page, 'right', file('k.txt')); await type(page, 'left', 'ร่างJ ')
  await addTab(page); await loadPath(page, 'left', file('l.txt')); await loadPath(page, 'right', file('m.txt')); await type(page, 'left', 'ร่างL ')
  await addTab(page); await loadPath(page, 'left', file('n.txt')); await loadPath(page, 'right', file('i.txt')); await type(page, 'left', 'ร่างN ')
  await addTab(page); await type(page, 'left', 'ร่างข้อความ\n'); await loadPath(page, 'right', file('o.txt'))
  assert.equal(await closeApp(page), true)
  await writeFile(file('h.txt'), 'h.txt ถูกแก้จากภายนอก\n')           // changed (size differs)
  await rm(file('j.txt'))                                              // deleted
  await rename(file('l.txt'), file('l-ย้าย.txt'))                      // moved
  const later = new Date(Date.now() + 60_000)
  await utimes(file('n.txt'), later, later)                            // same size, newer time
  await rm(file('o.txt'))                                              // a clean side whose file is gone

  page = await launch('', 'Restored 5 tabs')
  const note = await status(page)
  assert.match(note, /changed on disk since: h\.txt, n\.txt/); assert.match(note, /file not found: j\.txt, l\.txt/); assert.match(note, /could not reopen: o\.txt/)
  const drafts = [['h', 0, 'changed'], ['j', 1, 'not found'], ['l', 2, 'not found'], ['n', 3, 'changed']]
  for (const [letter, index] of drafts) {
    await select(page, index)
    assert.equal((await side(page, 'left')).dirty, true, `${letter}.txt draft is still modified`)
    assert.equal(lf((await side(page, 'left')).text), `ร่าง${letter.toUpperCase()} ${letter}.txt เดิม\n`, `${letter}.txt draft text restored`)
  }
  await select(page, 0); assert.match(await badge(page, 'left'), /file changed on disk/)
  await select(page, 1); assert.match(await badge(page, 'left'), /file not found/)
  await select(page, 2); assert.match(await badge(page, 'left'), /file not found/)
  await select(page, 3); assert.match(await badge(page, 'left'), /file changed on disk/)
  await select(page, 4)
  assert.equal(lf((await side(page, 'left')).text), 'ร่างข้อความ\n'); assert.equal((await side(page, 'right')).path, null, 'a clean side whose file is gone is left empty')
  checks.push('Drafts survive an original that was changed (size or time), deleted or moved, and each is flagged in the status and the file header')

  // Save over a changed file asks first; declining leaves the file as the other program wrote it.
  await select(page, 0)
  await page.evaluate(() => { window.testConfirm = false })
  await save(page, 'left')
  assert.equal(await readFile(file('h.txt'), 'utf8'), 'h.txt ถูกแก้จากภายนอก\n', 'declined: the changed file is not overwritten')
  assert.equal((await side(page, 'left')).dirty, true)
  await page.evaluate(() => { window.testConfirm = true })
  await save(page, 'left')
  assert.equal(await readFile(file('h.txt'), 'utf8'), 'ร่างH h.txt เดิม\n')
  assert.equal((await side(page, 'left')).dirty, false)
  assert.equal(await badge(page, 'left'), '')
  const history = await server.call({ action: 'listHistory', path: file('h.txt') })
  assert.ok(history.length >= 1, 'the file that was replaced is kept in History')
  checks.push('Saving over a file that changed needs explicit confirmation and keeps the replaced version in History')

  // A vanished file is never silently recreated: the Save dialog decides where it goes.
  await select(page, 1)
  await page.evaluate(() => { window.testSavePath = null })
  await save(page, 'left')
  await assert.rejects(stat(file('j.txt')), 'cancelled Save As recreates nothing')
  assert.equal((await side(page, 'left')).dirty, true)
  await page.evaluate(path => { window.testSavePath = path }, file('j-ใหม่.txt'))
  await save(page, 'left')
  assert.equal(await readFile(file('j-ใหม่.txt'), 'utf8'), 'ร่างJ j.txt เดิม\n')
  assert.equal((await side(page, 'left')).path, file('j-ใหม่.txt'))
  await select(page, 2)
  await page.evaluate(path => { window.testSavePath = path }, file('l.txt'))
  await save(page, 'left')
  assert.equal(await readFile(file('l.txt'), 'utf8'), 'ร่างL l.txt เดิม\n', 'choosing the original path recreates it')
  await page.evaluate(() => { window.testSavePath = null })
  checks.push('A draft whose file vanished is saved through Save As, to a new path or the original one')
  assert.equal(await closeApp(page), true)
  await forget()

  // ---- 4. The recovery data cannot be written ----
  await writeFile(file('a.txt'), content['a.txt'])
  page = await launch()
  await loadPath(page, 'left', file('a.txt')); await type(page, 'left', 'รุ่น1 ')
  assert.equal(await closeApp(page), true)
  const first = JSON.parse(await readFile(draftsFile, 'utf8'))
  page = await launch('', 'Restored 1 tab ')
  await type(page, 'left', 'รุ่น2 ')
  await chmod(draftsFile, 0o444)
  assert.equal(await page.evaluate(() => window.__ocompareClose()), false, 'the window stays open when the recovery data cannot be written')
  assert.equal((await page.evaluate(() => window.testRetryMessages)).length, 1)
  assert.match((await page.evaluate(() => window.testRetryMessages))[0], /could not be stored for recovery/)
  assert.match(await status(page), /could not be stored for recovery/)
  assert.equal(lf((await side(page, 'left')).text), 'รุ่น2 รุ่น1 ไฟล์ซ้ายเดิม\nบรรทัดสอง\n', 'nothing is lost from the window')
  assert.deepEqual(await server.call({ action: 'loadTabDrafts' }), first, 'the previous recovery data is still readable')
  assert.equal(await readFile(file('a.txt'), 'utf8'), content['a.txt'])
  checks.push('When the recovery data cannot be written, the error is shown, the window stays open and the previous data stays readable')

  // "Try again": the fault is fixed while the prompt is open, and the same close then succeeds.
  await page.exposeFunction('repairDraftsFile', () => chmod(draftsFile, 0o666))
  await page.evaluate(() => { window.testRetry = true; window.testRetryHook = () => window.repairDraftsFile() })
  assert.equal(await page.evaluate(() => window.__ocompareClose()), true)
  const second = JSON.parse(await readFile(draftsFile, 'utf8'))
  assert.equal(lf(second.documents[0].text), 'รุ่น2 รุ่น1 ไฟล์ซ้ายเดิม\nบรรทัดสอง\n')
  await page.close()
  checks.push('Choosing Try again stores the latest text once the problem is fixed and then closes')
  await forget()

  // ---- 5. An Explorer launch opens next to the restored tabs; Folder Sessions behave as before ----
  page = await launch()
  await loadPath(page, 'left', file('a.txt')); await type(page, 'left', 'ร่างก่อนเปิดจาก Explorer ')
  assert.equal(await closeApp(page), true)
  page = await launch(`?startup=files&left=${encodeURIComponent(file('c.txt'))}&right=${encodeURIComponent(file('d.txt'))}`, 'Restored 1 tab ')
  await page.waitForFunction(({ left, right }) => window.__ocompare.sides.left.path === left && window.__ocompare.sides.right.path === right, { left: file('c.txt'), right: file('d.txt') })
  const after = await labels(page)
  assert.equal(after.length, 2)
  assert.match(after[0], /^● a\.txt ↔ Untitled/); assert.match(after[1], /c\.txt ↔ d\.txt/)
  assert.equal(await activeIndex(page), 1, 'the launched comparison is shown')
  assert.equal((await side(page, 'left')).path, file('c.txt')); assert.equal((await side(page, 'right')).path, file('d.txt'))
  await select(page, 0)
  assert.equal(lf((await side(page, 'left')).text), 'ร่างก่อนเปิดจาก Explorer ไฟล์ซ้ายเดิม\nบรรทัดสอง\n', 'the restored draft was not replaced')
  checks.push('A files launch from Explorer opens in a new tab and does not overwrite the restored one')
  assert.equal(await closeApp(page), true)
  await mkdir(file('dirA'), { recursive: true }); await mkdir(file('dirB'), { recursive: true })
  await writeFile(join(file('dirA'), 'x.txt'), 'x\n'); await writeFile(join(file('dirB'), 'x.txt'), 'y\n')
  page = await launch(`?startup=folders&left=${encodeURIComponent(file('dirA'))}&right=${encodeURIComponent(file('dirB'))}`, 'Restored 1 tab ')
  assert.equal(await page.locator('[data-mode=folders]').getAttribute('aria-pressed'), 'true', 'a folder launch still shows Folders')
  await page.waitForFunction(() => document.querySelector('#st-diffs')?.textContent?.includes('1 files'))
  await page.locator('[data-mode=files]').click()
  assert.equal((await labels(page)).length, 1); assert.match((await labels(page))[0], /^● a\.txt/)
  checks.push('A folders launch compares as before and the restored file tab is still there')
  assert.equal(await closeApp(page), true)
  await forget()

  // ---- 6. Nothing to recover: no stale data, one empty tab ----
  page = await launch()
  await loadPath(page, 'left', file('a.txt')); await type(page, 'left', 'ชั่วคราว ')
  assert.equal(await closeApp(page), true)
  page = await launch('', 'Restored 1 tab ')
  await save(page, 'left')
  assert.equal(await closeApp(page), true, 'a clean workspace closes normally')
  await assert.rejects(stat(draftsFile), 'no recovery data is kept when nothing is unsaved')
  page = await launch()
  assert.deepEqual(await labels(page), ['Untitled ↔ Untitled'])
  await page.close()
  checks.push('With nothing unsaved the recovery data is removed and the next start opens one empty tab')

  assert.deepEqual(errors, [])
  console.log(`PASS: ${checks.length} tab-recovery scenarios`)
  checks.forEach(check => console.log(`  ${check}`))
} finally {
  await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true })
}
