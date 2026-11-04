import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Browser plugin not available; exercise the real renderer and existing updater fixture.
const root = await mkdtemp(join(tmpdir(), 'ocompare-settings-'))
assert(resolve(root).startsWith(resolve(tmpdir()) + sep))
let server, browser
try {
  server = await startFolderTestServer(root, 1440, { updater: true })
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.url)
  await page.waitForFunction(() => Boolean(window.__ocompare))
  assert.equal(await page.locator('#toolbar #theme-toggle, #toolbar #check-updates').count(), 0, 'Theme and update commands move out of the toolbar')
  const gear = page.getByRole('button', { name: 'Settings', exact: true })
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await page.evaluate(() => window.__ocompare.sides.left.model.setValue('unsaved settings regression'))
  await gear.click()
  await settings.waitFor()
  await settings.getByRole('button', { name: 'Dark Mode', exact: true }).click()
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('left')), 'unsaved settings regression')
  const tabCount = await page.locator('#file-tabs [role=tab]').count()
  await page.keyboard.press('Control+t')
  assert.equal(await page.locator('#file-tabs [role=tab]').count(), tabCount, 'Settings blocks workspace shortcuts')
  await page.keyboard.press('Escape')
  assert.equal(await settings.count(), 0)
  assert(await gear.evaluate(el => el === document.activeElement), 'Escape restores the Settings button focus')
  await gear.click()
  assert.equal(await settings.getByRole('button', { name: 'Dark Mode', exact: true }).getAttribute('aria-pressed'), 'true')
  await settings.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await page.getByRole('dialog', { name: 'Software update', exact: true }).waitFor()
  assert.equal(await settings.count(), 0, 'Manual update hands off to the existing update dialog')
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  await page.reload()
  await page.waitForFunction(() => Boolean(window.__ocompare))
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Theme survives reload')
  for (const mode of ['files', 'folders']) {
    await page.locator(`[data-mode=${mode}]`).click()
    for (const width of [640, 900, 1920]) {
      await page.setViewportSize({ width, height: 700 })
      await gear.click()
      const bounds = await settings.boundingBox()
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Settings fits compact windows')
      assert.equal(await settings.locator('#theme-toggle, #check-updates').count(), 2)
      if (process.env.TOOLBAR_EVIDENCE_DIR && mode === 'folders' && width === 900) {
        await mkdir(process.env.TOOLBAR_EVIDENCE_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.TOOLBAR_EVIDENCE_DIR, 'settings-dark.png') })
        await settings.getByRole('button', { name: 'Dark Mode', exact: true }).click()
        await page.screenshot({ path: join(process.env.TOOLBAR_EVIDENCE_DIR, 'settings-light.png') })
      }
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: Settings relocation, theme/persistence/edits, focus, shortcuts, update handoff and 640–1920px layouts')
} finally {
  await browser?.close()
  await server?.close()
  await rm(root, { recursive: true, force: true })
}
