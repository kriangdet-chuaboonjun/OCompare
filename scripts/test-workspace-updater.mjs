import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

const root = await mkdtemp(join(tmpdir(), 'ocompare-updater-'))
let browser, server
try {
  const path = join(root, 'edited.txt'); await writeFile(path, 'original')
  server = await startFolderTestServer(root, 1439, { updater: true })
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1500, height: 850 } }); page.setDefaultTimeout(20_000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.url); await page.waitForFunction(() => !!window.__ocompare)
  const input = page.locator('.side-head[data-side=left] .path'); await input.fill(path); await input.press('Enter')
  await page.waitForFunction(path => window.__ocompare.sides.left.path === path, path)
  await page.evaluate(() => window.__ocompare.sides.left.model.setValue('saved by update guard'))
  await page.keyboard.press('Control+t')
  // A clean file may change externally while update confirmation freezes the workspace.
  const watchedPath = join(root, 'watched.txt'); await writeFile(watchedPath, 'old on disk')
  const watchedInput = page.locator('.side-head[data-side=left] .path'); await watchedInput.fill(watchedPath); await watchedInput.press('Enter')
  await page.waitForFunction(path => window.__ocompare.sides.left.path === path, watchedPath)
  await page.evaluate(() => window.__ocompare.sides.right.model.setValue('untitled content'))
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await page.getByRole('button', { name: 'Download and install', exact: true }).click()
  await page.getByRole('dialog', { name: 'Unsaved changes' }).waitFor()
  assert.equal(await page.locator('#editor').evaluate(el => el.inert), true)
  await writeFile(watchedPath, 'changed during update confirmation')
  await page.evaluate(async path => {
    const platform = await import('/tests/folder-platform.ts')
    platform.emitFileChanged(path)
  }, watchedPath)
  await page.keyboard.press('Control+t'); assert.equal(await page.getByRole('tab').count(), 2)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).waitFor()
  await page.waitForFunction(() => window.__ocompare.sides.left.model.getValue() === 'changed during update confirmation')
  assert.equal(await page.evaluate(() => window.updateInstalls), 0)
  // An actual failed filesystem save must keep both the document and app alive.
  await page.route('**/__folder_test/workspace', async route => {
    if (route.request().postDataJSON().action === 'saveFile') await route.fulfill({ json: { error: { message: 'read only fixture' } } })
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Install update', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.updateInstalls), 0)
  assert.equal(await readFile(path, 'utf8'), 'original')
  await page.unroute('**/__folder_test/workspace')
  await page.getByRole('button', { name: 'Install update', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByText('Save changes to Untitled?').waitFor()
  assert.equal(await readFile(path, 'utf8'), 'saved by update guard')
  // Native Save As cancellation for Untitled is represented by the existing test platform.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.updateInstalls), 0)
  await page.getByRole('button', { name: 'Install update', exact: true }).click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.waitForFunction(() => window.updateInstalls === 1)
  assert.equal(await page.evaluate(() => window.updateDownloads), 1)
  // A real folder job prevents install, and the update remains available after Stop.
  await page.reload(); await page.waitForFunction(() => !!window.__ocompare)
  const left = join(root, 'left'), right = join(root, 'right')
  await mkdir(left); await mkdir(right)
  await page.locator('[data-mode=folders]').click()
  await page.locator('[data-root=left]').fill(left); await page.locator('[data-root=left]').press('Tab')
  await page.locator('[data-root=right]').fill(right); await page.locator('[data-root=right]').press('Tab')
  await page.evaluate(() => { window.compareDelayMs = 1500 })
  await page.locator('[data-folder-cmd=compare]').click()
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await page.getByRole('button', { name: 'Download and install', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.updateInstalls), 0)
  await page.getByRole('button', { name: 'Later', exact: true }).click()
  await page.locator('[data-folder-cmd=cancel]').click()
  await page.getByRole('button', { name: 'Update 99.0.0 available', exact: true }).click()
  await page.getByRole('button', { name: 'Install update', exact: true }).click()
  await page.waitForFunction(() => window.updateInstalls === 1)
  assert.deepEqual(errors, [])
  console.log('PASS: real workspace updater covers other tabs, Untitled, Cancel/Save/Discard, deferred file events, locked shortcuts and active/stopped folder jobs')
} finally { await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true }) }
