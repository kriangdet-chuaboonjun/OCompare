import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Browser plugin not available. Catch wrapped/clipped commands and stale popup actions.
const root = await mkdtemp(join(tmpdir(), 'ocompare-toolbar-'))
assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
const evidence = process.env.TOOLBAR_EVIDENCE_DIR
let server, browser
try {
  server = await startFolderTestServer(root, 1437)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 640, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    // The desktop fixture has no website favicon; still fail for application/resource errors.
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(`${message.text()} (${message.location().url})`)
  })
  await page.goto(server.url)
  await page.waitForFunction(() => Boolean(window.__ocompare))
  assert.match(await page.title(), /^OCompare(?: v[\d.]+)?$/)
  assert(page.url().startsWith(server.url))
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  const more = page.getByRole('button', { name: 'More commands', exact: true })
  const menu = page.getByRole('menu', { name: 'More commands' })
  const geometry = async () => {
    await page.waitForTimeout(150)
    const rects = await page.locator('#toolbar').evaluate(bar => {
      const visible = [...bar.querySelectorAll('button')].filter(b => b.getClientRects().length)
      return visible.map(b => { const r = b.getBoundingClientRect(); return { label: b.textContent, top: r.top, right: r.right, bottom: r.bottom } })
    })
    assert(rects.length > 3)
    assert(Math.max(...rects.map(r => r.top)) - Math.min(...rects.map(r => r.top)) <= 3, 'All toolbar buttons stay in one row')
    assert(rects.every(r => r.right <= page.viewportSize().width && r.bottom <= 45), `Toolbar commands fit within the bar: ${JSON.stringify(rects)}`)
  }
  await geometry()
  assert(await more.isVisible(), 'Narrow Files exposes overflow')
  await more.click()
  await menu.waitFor()
  assert.equal(await menu.getByRole('menuitemcheckbox', { name: /Mode/ }).count(), 0, 'Theme belongs in Settings')
  assert.equal(await menu.getByRole('menuitem', { name: 'Check for updates', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  assert.equal(await menu.count(), 0)
  assert(await more.evaluate(b => b === document.activeElement), 'Escape restores trigger focus')
  await page.locator('[data-mode=folders]').click()
  await geometry()
  await more.click()
  // History is one combined, read-only view: it opens even with nothing selected.
  assert.notEqual(await menu.getByRole('menuitem', { name: 'History', exact: true }).getAttribute('aria-disabled'), 'true')
  await menu.getByRole('menuitemcheckbox', { name: 'Log', exact: true }).click()
  assert.equal(await page.locator('.folder-log-wrap').isVisible(), false, 'Overflow changes folder view state')
  await more.click()
  assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Log', exact: true }).getAttribute('aria-checked'), 'false')
  await page.keyboard.press('Escape')
  await page.locator('#folder-tab-add').click()
  await geometry()
  await more.click()
  assert.equal(await menu.getByRole('menuitemcheckbox', { name: 'Log', exact: true }).getAttribute('aria-checked'), 'true', 'New tab has independent state')
  await menu.getByRole('menuitemcheckbox', { name: 'Log', exact: true }).click()
  assert.equal(await page.locator('.folder-tab-panel:not([hidden]) .folder-log-wrap').isVisible(), false)
  await more.click()
  await page.setViewportSize({ width: 800, height: 700 })
  await geometry()
  assert.equal(await menu.count(), 0, 'Resize dismisses stale menu')
  assert.equal(await more.getAttribute('aria-expanded'), 'false')
  await more.click()
  await page.locator('[data-mode=files]').click()
  await geometry()
  assert.equal(await menu.count(), 0, 'Mode switch dismisses folder commands')
  await more.click()
  await page.mouse.click(10, 680)
  assert.equal(await menu.count(), 0, 'Outside pointer dismisses overflow')
  for (const mode of ['folders', 'files']) {
    await page.locator(`[data-mode=${mode}]`).click()
    for (const width of [640, 800, 1100, 1400, 1920]) {
      await page.setViewportSize({ width, height: 700 })
      await geometry()
      if (evidence && width === 800) {
        await mkdir(evidence, { recursive: true })
        await page.screenshot({ path: join(evidence, `${mode}-800.png`) })
        await more.click()
        await page.screenshot({ path: join(evidence, `${mode}-800-menu.png`) })
        await page.keyboard.press('Escape')
      }
    }
    assert.equal(await more.isVisible(), false, 'Wide toolbar restores all commands')
  }
  assert.deepEqual(errors, [])
  console.log('PASS: single-row Files/Folders at 640–1920px; overflow actions, state, tabs, Escape and restoration')
} finally {
  await browser?.close()
  await server?.close()
  await rm(root, { recursive: true, force: true })
}
