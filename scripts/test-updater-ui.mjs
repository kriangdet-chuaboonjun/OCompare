import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const server = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { noDiscovery: true, entries: ['tests/updater.html'] }, server: { host: '127.0.0.1', port: 1438, strictPort: true, watch: { ignored: ['**/src-tauri/target/**', '**/release/**', '**/node_modules/**'] } }, cacheDir: '.cache/vite-updater' })
let browser
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  page.setDefaultTimeout(15_000)
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://127.0.0.1:1438/tests/updater.html')
  await page.waitForFunction(() => !!window.updates)
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await page.getByRole('dialog', { name: 'Software update' }).waitFor()
  assert.match(await page.locator('.update-dialog').innerText(), /0\.4\.5[\s\S]*0\.4\.6/)
  assert.equal(await page.locator('.update-notes img').count(), 0)
  assert.match(await page.locator('.update-notes').innerText(), /<img/)
  await page.getByRole('button', { name: 'Download and install', exact: true }).click()
  await page.getByRole('dialog', { name: 'Unsaved changes' }).waitFor()
  assert.equal(await page.locator('#workspace').evaluate(el => el.inert), true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.installCount), 0)
  assert.equal(await page.locator('#workspace').evaluate(el => el.inert), false)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.screenshot({ path: resolve(`.cache/updater-${theme}.png`) })
    assert(await page.locator('.update-dialog').evaluate(el => el.scrollWidth <= el.clientWidth))
  }
  await page.getByRole('button', { name: 'Install update', exact: true }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.waitForFunction(() => window.installCount === 1)
  assert.equal(await page.evaluate(() => window.downloadCount), 1)
  assert.deepEqual(errors, [])
  console.log('PASS: accessible update dialog, release notes as text, progress, cancel/discard guards, light/dark layouts')
} finally { await browser?.close(); await server.close() }
