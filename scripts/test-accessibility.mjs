import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Regression coverage for the eight findings in AUDIT-2026-10-21.md.
// Browser plugin cannot drive this isolated Rust-backed fixture transport.
const root = await mkdtemp(join(tmpdir(), 'ocompare-a11y-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture root')
const failures = [], pageErrors = []
let server, browser
const check = async (name, action) => {
  try { await action(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`) }
}
try {
  for (const side of ['left', 'right']) {
    await mkdir(join(root, side))
    await writeFile(join(root, side, 'changed.sql'), `-- ${side}\nSELECT ${side === 'left' ? '1' : '2'}, N'${side}';\n`)
    await writeFile(join(root, side, 'same.sql'), 'SELECT 1;\n')
    await writeFile(join(root, side, 'minor.sql'), side === 'left' ? 'SELECT  1;\n' : 'SELECT 1;\n')
    await writeFile(join(root, side, `${side}-only.sql`), 'SELECT 1;\n')
  }
  await mkdir(join(root, 'outside'))
  await symlink(join(root, 'outside'), join(root, 'left', 'skipped'), 'junction')
  server = await startFolderTestServer(root, 1431)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(server.url)
  await page.waitForFunction(() => Boolean(window.__ocompare))
  for (const side of ['left', 'right']) {
    const path = join(root, side, 'changed.sql')
    const input = page.locator(`.side-head[data-side=${side}] .path`)
    await input.fill(path); await input.press('Enter')
    await page.waitForFunction(({ side, path }) => window.__ocompare.sides[side].path === path, { side, path })
  }
  await page.waitForFunction(() => window.__ocompare.diffCount() > 0)
  await check('A02 distinct accessible names for both file sides', async () => {
    for (const side of ['Left', 'Right']) {
      assert.equal(await page.getByRole('combobox', { name: `${side} language`, exact: true }).count(), 1)
      assert.equal(await page.getByRole('textbox', { name: `${side} file path`, exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: `Open ${side.toLowerCase()} file`, exact: true }).count(), 1)
    }
  })
  await check('A03 file errors reach a live region without moving focus', async () => {
    const input = page.locator('.side-head[data-side=left] .path')
    await input.fill(join(root, 'missing.sql')); await input.press('Enter')
    await page.waitForFunction(() => document.querySelector('#st-msg').textContent.includes('Cannot open'))
    const live = await page.locator('#st-msg').evaluate(el => Boolean(el.closest('[role=status], [role=alert], [aria-live=polite], [aria-live=assertive]')))
    assert(live, 'File error must be exposed as a live message')
    assert(await input.evaluate(el => el === document.activeElement))
    await input.press('Escape')
  })
  await check('A04 commands and both path fields remain reachable in compact windows', async () => {
    try {
      for (const width of [900, 640]) {
        await page.setViewportSize({ width, height: 650 })
        const clipped = await page.locator('#toolbar button, .pathbar input, .pathbar button').evaluateAll(els => els.filter(el => el.checkVisibility()).filter(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1 }).map(el => el.textContent || el.className))
        assert.deepEqual(clipped, [], `${width}px clipped controls`)
        await page.locator('[data-cmd=rules]').click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape')
        await page.locator('[data-cmd=history]').click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape')
      }
    } finally { await page.setViewportSize({ width: 1400, height: 900 }) }
  })
  await check('A07 arrow keys move tab focus and Ctrl+Tab still cycles', async () => {
    await page.locator('#tab-add').click()
    const firstName = await page.getByRole('tab').first().innerText()
    await page.getByRole('tab', { selected: true }).focus(); await page.keyboard.press('ArrowLeft')
    assert.equal(await page.getByRole('tab', { selected: true }).innerText(), firstName)
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'tab')
    await page.keyboard.press('End'); assert.equal(await page.getByRole('tab', { selected: true }).innerText(), 'Untitled ↔ Untitled')
    await page.keyboard.press('Control+Tab'); assert.equal(await page.getByRole('tab', { selected: true }).innerText(), firstName)
  })
  await check('A08 toolbar uses a small bitmap while preserving displayed size', async () => {
    const image = await page.locator('#logo').evaluate(el => ({ width: el.naturalWidth, height: el.naturalHeight, displayed: el.clientWidth }))
    assert(image.width <= 128 && image.height <= 128, `Oversized logo: ${image.width}×${image.height}`)
    assert.equal(image.displayed, 32)
  })
  await page.getByRole('tab').first().click()
  await page.locator('.view-lines span').first().waitFor()
  await check('A01 SQL token contrast survives diff and character backgrounds in both themes', async () => {
    const ratios = []
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const colors = await page.evaluate(theme => {
      const parse = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0)
      const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      const rows = []
        const base = theme === 'light' ? [255,227,227] : [84,43,50]
        const overlay = theme === 'light' ? [255,154,154] : [168,70,86]
        const alpha = theme === 'light' ? .6 : .4
        const char = base.map((v,i) => overlay[i]*alpha + v*(1-alpha))
        for (const el of document.querySelectorAll('.view-lines span')) if(!el.children.length && el.textContent.trim()) {
          const fg = parse(getComputedStyle(el).color)
          rows.push({theme,text:el.textContent,ratio:Math.min(contrast(fg,base),contrast(fg,char))})
        }
      return rows
      }, theme)
      ratios.push(...colors)
    }
    assert(ratios.length > 5)
    assert.deepEqual(ratios.filter(x => x.ratio < 4.5), [], 'SQL tokens must stay readable on changed lines and characters')
  })
  await page.locator('[data-mode=folders]').click()
  for (const side of ['left', 'right']) await page.locator(`[data-root=${side}]`).fill(join(root, side))
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() => document.querySelector('.folder-progress').textContent === 'Comparison complete')
  await check('A01 selected folder status text stays readable in both themes', async () => {
    const low = []
    for (const status of ['different', 'identical', 'minor', 'left-only', 'right-only', 'skipped'])
      assert.equal(await page.locator(`.folder-row.status-${status}`).count(), 1, `Real ${status} fixture must be present`)
    for (const theme of ['light', 'dark']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click()
      for (const row of await page.locator('.folder-row').all()) {
        await row.click()
        const result = await page.locator('.folder-row.selected').evaluate(el => {
          const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
          const style=getComputedStyle(el),a=luminance(style.color),b=luminance(style.backgroundColor)
          return {status:el.className,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
        })
        if (result.ratio < 4.5) low.push({theme,...result})
      }
    }
    assert.deepEqual(low, [], 'Selected status text must meet contrast in both themes')
  })
  await check('A05 seven column headers map to seven ordered row cells', async () => {
    assert.equal(await page.getByRole('columnheader').count(), 7)
    const indexes = await page.locator('.folder-row').first().getByRole('gridcell').evaluateAll(els => els.map(el => Number(el.getAttribute('aria-colindex'))))
    assert.deepEqual(indexes, [1,2,3,4,5,6,7])
  })
  await check('Folder sort retains keyboard focus for every column and direction', async () => {
    for (const side of ['left', 'right']) {
      for (const column of ['name', 'size', 'modified']) {
        const button = page.getByRole('button', { name: `Sort ${side} ${column}`, exact: true })
        await button.focus()
        for (let attempt = 0; attempt < 2; attempt++) {
          const direction = await button.locator('..').getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending'
          await page.keyboard.press('Enter')
          assert(await button.evaluate(el => el === document.activeElement), `${side} ${column} ${direction} must retain focus`)
          assert.equal(await button.locator('..').getAttribute('aria-sort'), direction)
        }
        await page.keyboard.press('Tab')
        assert(await page.getByRole('separator', { name: `Resize ${side} ${column}`, exact: true }).evaluate(el => el === document.activeElement), 'Tab must reach the adjacent resize control')
      }
    }
  })
  await check('A06 column resize supports keyboard and splitters expose changing values', async () => {
    const handle = page.locator('[title="Resize left size"]')
    assert.equal(await handle.getAttribute('role'), 'separator')
    await handle.focus()
    const before = Number(await handle.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    const after = Number(await handle.getAttribute('aria-valuenow'))
    assert(after > before, `ArrowRight must increase width (${before} → ${after})`)
    await page.keyboard.press('ArrowLeft')
    assert.equal(Number(await handle.getAttribute('aria-valuenow')), before)
    for (const selector of ['.folder-divider', '.folder-log-resizer']) {
      const el = page.locator(selector)
      assert(await el.getAttribute('aria-valuenow'))
      assert(await el.getAttribute('aria-orientation'))
    }
    await page.locator('.folder-divider').focus()
    const split = Number(await page.locator('.folder-divider').getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    assert.equal(Number(await page.locator('.folder-divider').getAttribute('aria-valuenow')), split + 1)
  })
  assert.deepEqual(pageErrors, [], 'Unexpected browser errors')
  assert.deepEqual(failures, [], 'Accessibility regressions')
} finally {
  await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true })
}
