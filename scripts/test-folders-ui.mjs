import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

const root = await mkdtemp(join(tmpdir(), 'ocompare-folder-ui-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture root')
const left = join(root, 'ซ้าย left'),
  right = join(root, 'ขวา right'),
  results = []
let server, browser
try {
  for (const dir of [left, right]) {
    for (const sub of ['empty', 'nested', 'many']) await mkdir(join(dir, sub), { recursive: true })
    for (const [name, text] of [
      ['same.txt', 'same\n'],
      ['nested/child.txt', 'child\n'],
      ['ไทย มีช่องว่าง.sql', 'SELECT 1; -- ไทย\n'],
    ])
      await writeFile(join(dir, name), text)
    await writeFile(join(dir, 'binary.bin'), Buffer.from([0, 1, 255]))
    for (let start = 0; start < 10000; start += 100)
      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          writeFile(
            join(dir, 'many', `file${String(start + i).padStart(5, '0')}.txt`),
            `line ${start + i}\n`,
          ),
        ),
      )
  }
  await writeFile(join(left, 'changed.txt'), 'LEFT\n')
  await writeFile(join(right, 'changed.txt'), 'RGHT\n')
  await writeFile(join(left, 'minor.sql'), 'SELECT  1;\r\n')
  await writeFile(join(right, 'minor.sql'), 'SELECT\t1;\n')
  await writeFile(join(left, 'only-left.sql'), 'SELECT 42;\n')
  await writeFile(join(right, 'only-right.sql'), 'SELECT 43;\n')
  await writeFile(join(left, 'conflict'), 'file')
  await mkdir(join(right, 'conflict'))
  await writeFile(join(right, 'conflict', 'child.txt'), 'child')
  await symlink(left, join(left, 'nested', 'loop'), 'junction')
  server = await startFolderTestServer(root)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(server.url)
  await page.waitForFunction(() => Boolean(window.__ocompare))
  await page.evaluate(() => window.__ocompare.sides.left.model.setValue('unsaved buffer retained'))
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-root=left]').fill(left)
  await page.locator('[data-root=right]').fill(right)
  const done = () =>
    page.waitForFunction(
      () => document.querySelector('.folder-progress').textContent === 'Comparison complete',
    )
  await page.locator('[data-folder-cmd=compare]').click()
  await done()
  assert((await page.locator('.folder-summary').textContent()).includes('Minor 1'))
  assert((await page.locator('.folder-summary').textContent()).includes('Skipped 1'))
  await page.getByRole('button', { name: 'Collapse many', exact: true }).first().click()
  assert((await page.locator('.folder-row').count()) < 100)
  assert.equal(await page.locator('[data-path="nested/child.txt"] .folder-side').count(), 2)
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('left')), 'unsaved buffer retained')
  assert.equal(await page.locator('[data-path="changed.txt"] .folder-status').textContent(), '≠')
  results.push(
    '10,000+ real filesystem entries: aligned virtual rows, folder icons, Minor and skipped junction',
  )
  const mask = async (value) => {
    await page.getByRole('textbox', { name: 'Include patterns', exact: true }).fill(value)
    await page.getByRole('textbox', { name: 'Include patterns', exact: true }).press('Enter')
    await page.getByRole('textbox', { name: 'Include patterns', exact: true }).blur()
  }
  await page.locator('[data-folder-cmd=same]').click()
  assert.equal(await page.locator('[data-path="changed.txt"]').count(), 0)
  await page.locator('[data-folder-cmd=diffs]').click()
  await page.locator('[data-path="minor.sql"]').waitFor()
  await page.locator('[data-folder-cmd=minor]').click()
  assert.equal(await page.locator('[data-path="minor.sql"]').count(), 0)
  await page.locator('[data-folder-cmd=minor]').click()
  await page.locator('[data-folder-cmd=all]').click()
  await mask('*.sql')
  assert.equal(await page.locator('[data-path="changed.txt"]').count(), 0)
  await page.locator('[data-folder-cmd=peek]').click()
  assert(
    await page
      .locator('[data-path="changed.txt"]')
      .getAttribute('class')
      .then((s) => s.includes('peek-hidden')),
  )
  await page.locator('[data-folder-cmd=peek]').click()
  await page.locator('[data-folder-cmd=filters]').click()
  await page.getByRole('textbox', { name: 'Exclude patterns' }).fill('nested/**;many/**')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  assert.equal(await page.locator('[data-path=nested]').count(), 0)
  await mask('*.*')
  await page.locator('[data-folder-cmd=structure]').click()
  assert.equal(await page.locator('[data-path=empty]').count(), 0)
  await page.locator('[data-folder-cmd=structure]').click()
  await page.getByRole('button', { name: 'Sort left size' }).click()
  await page.getByRole('button', { name: 'Sort left name' }).click()
  results.push('All/Diffs/Same, Minor toggle, masks, Exclude, Peek, Tree/Flat and sorting')
  await page.locator('[data-path="changed.txt"]').click()
  await page.locator('[data-path="only-left.sql"]').click({ modifiers: ['Control'] })
  assert((await page.locator('[data-selection]').textContent()).includes('2 selected'))
  await mask('changed.txt')
  assert((await page.locator('[data-selection]').textContent()).includes('1 selected'))
  await mask('*.*')
  await page.locator('[data-path="changed.txt"]').click()
  await page.locator('[data-path="minor.sql"]').click({ modifiers: ['Shift'] })
  assert((await page.locator('[data-selection]').textContent()).includes('2 selected'))
  results.push('Ctrl/Shift selection and clearing hidden selections after filter changes')
  await page.locator('[data-path="changed.txt"]').click()
  await page.locator('[data-folder-cmd=copy]').click()
  await page.getByRole('button', { name: 'Left → Right', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review copy plan' }).waitFor()
  assert((await page.locator('.copy-preview').textContent()).includes('OVERWRITE'))
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await readFile(join(right, 'changed.txt'), 'utf8'), 'RGHT\n')
  await page.locator('[data-folder-cmd=copy]').click()
  await page.getByRole('button', { name: 'Left → Right', exact: true }).click()
  await page.getByRole('button', { name: 'Copy now', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.folder-progress').textContent.startsWith('Copy complete:'),
  )
  assert.equal(await readFile(join(right, 'changed.txt'), 'utf8'), 'LEFT\n')
  assert.equal(await readFile(join(right, 'only-right.sql'), 'utf8'), 'SELECT 43;\n')
  results.push('Copy preview Cancel is read-only; confirmed real Rust overwrite preserves unselected files')
  // Watch reports the real overwrite during the post-copy scan; explicitly refresh before another copy.
  await page.waitForFunction(() => !document.querySelector('[data-folder-cmd=compare]').disabled)
  await page.locator('[data-folder-cmd=refresh]').click()
  await done()
  assert.equal(await page.locator('[data-folder-cmd=home], [data-folder-cmd=sessions]').count(), 0)
  const store=JSON.parse(await readFile(join(root,'sessions.json'),'utf8'))
  assert(!JSON.stringify(store).includes('unsaved buffer'))
  results.push('Home/Sessions absent from Folders; persistent history excludes editor contents')
  await page.locator('[data-path="minor.sql"]').dblclick()
  await page.waitForFunction(() => window.__ocompare.textOf('left').includes('SELECT'))
  assert.equal(await page.locator('#editor').isVisible(), true)
  assert.equal(await page.getByRole('tab').count(), 2)
  await page.getByRole('tab').first().click()
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('left')), 'unsaved buffer retained')
  assert.equal(await page.evaluate(() => window.__ocompare.isDirty('left')), true)
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-path="minor.sql"]').dblclick()
  await page.waitForFunction(() => window.__ocompare.textOf('left').includes('SELECT'))
  assert.equal(await page.getByRole('tab').count(), 2)
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => window.__ocompare.sides.right.model.setValue('unsaved destination'))
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-path="minor.sql"]').click()
  await page.locator('[data-folder-cmd=copy]').click()
  await page.getByRole('button', { name: 'Left → Right', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.folder-progress').textContent.includes('Unsaved destination edits'),
  )
  assert.equal(await page.getByRole('dialog', { name: 'Review copy plan' }).count(), 0)
  assert.equal(await readFile(join(right, 'minor.sql'), 'utf8'), 'SELECT\t1;\n')
  await page.evaluate(() => window.__ocompare.sides.right.model.undo())
  results.push('Copy refuses a destination with unsaved Monaco edits before showing an executable preview')
  await page.locator('[data-path="only-left.sql"]').dblclick()
  await page.waitForFunction(() => window.__ocompare.textOf('left').includes('42'))
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('right')), '')
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-path="binary.bin"]').dblclick()
  await page.waitForFunction(() =>
    document.querySelector('.folder-progress').textContent.includes('Binary files'),
  )
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('left')), 'SELECT 42;\n')
  results.push(
    'New pair tabs preserve edited comparisons, duplicate pairs activate existing tabs, empty peer and binary rejection retain state',
  )
  await page.locator('[data-root=right]').fill(join(root, 'missing'))
  assert.equal(await page.locator('[data-folder-cmd=copy]').isDisabled(), true)
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() =>
    document.querySelector('.folder-progress').textContent.includes('system cannot find'),
  )
  assert(await page.locator('[data-path="same.txt"]').count())
  await page.locator('[data-root=right]').fill(right)
  await page.locator('[data-folder-cmd=compare]').click()
  await done()
  await page.evaluate(() => (window.compareDelayMs = 400))
  await page.locator('[data-folder-cmd=refresh]').click()
  await page.locator('[data-folder-cmd=cancel]').click()
  await page.waitForTimeout(600)
  assert((await page.locator('.folder-progress').textContent()).includes('Canceled'))
  await page.evaluate(() => (window.compareDelayMs = 0))
  results.push('Missing roots and canceled jobs retain prior complete results; stale responses ignored')
  await page.locator('[data-folder-cmd=swap]').click()
  await done()
  assert.equal(await page.locator('[data-root=left]').inputValue(), right)
  const tree = page.locator('.folder-scroll')
  await tree.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  assert.equal(await tree.evaluate((el) => el.scrollTop), 0)
  await page.locator('[data-folder-cmd=filters]').click()
  await page.getByRole('textbox', { name: 'Exclude patterns' }).fill('')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.locator('[data-folder-cmd=collapse]').click()
  await page.getByRole('button', { name: 'All folders', exact: true }).click()
  await page.screenshot({ path: 'docs/evidence/folders-0.3.0-desktop.png' })
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.screenshot({ path: 'docs/evidence/folders-0.3.0-compact.png' })
  assert(await page.getByRole('button', { name: 'More', exact: true }).isVisible())
  assert.equal(await page.locator('[data-folder-cmd=sessions]').count(), 0)
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'More commands' })
    .getByRole('button', { name: 'Rules', exact: true })
    .click()
  await page.getByRole('dialog', { name: 'Comparison rules' }).getByRole('checkbox').first().uncheck()
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.locator('[data-folder-cmd=compare]').click()
  await done()
  await page.setViewportSize({ width: 1500, height: 950 })
  assert.equal(await page.locator('[data-path="minor.sql"] .folder-status').textContent(), '≠')
  results.push('Responsive overflow invokes Rules and changed rules reclassify Minor without modifying files')
  assert(await page.locator('[data-folder-cmd=cancel]').isVisible())
  results.push('Swap, keyboard, responsive overflow, adjacent toolbar controls and screenshots')
  assert.deepEqual(errors, [])
  await writeFile(
    'docs/evidence/folder-ui-tests-0.3.0.json',
    JSON.stringify({ results, pageErrors: errors, fixtureEntries: 10000 }, null, 2),
  )
  console.log(
    `PASS: ${results.length} folder workspace scenarios; real Rust filesystem services; no page errors`,
  )
  for (const r of results) console.log('  ' + r)
} catch (error) {
  if (process.env.O_COMPARE_WATCH_TRACE) console.error(server?.diagnostics())
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    console.error(await page.evaluate(() => ({ progress: document.querySelector('.folder-progress')?.textContent, log: document.querySelector('.folder-log')?.textContent, dialogs: [...document.querySelectorAll('dialog')].map(d => d.textContent) })))
    await page.screenshot({ path: 'docs/evidence/folders-0.3.0-failure.png' })
  }
  throw error
} finally {
  await browser?.close()
  await server?.close()
  await rm(root, { recursive: true, force: true })
}
