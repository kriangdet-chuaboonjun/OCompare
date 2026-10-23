import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Browser plugin not available; reuse the project's Edge headless/Rust test transport.
// Catches themes that update only the toolbar, lose edits, or fail to restore on startup.
const root = await mkdtemp(join(tmpdir(), 'ocompare-theme-'))
let server, browser
try {
  for (const side of ['left', 'right']) {
    await mkdir(join(root, side))
    await writeFile(join(root, side, 'changed.sql'), `SELECT '${side}';\n`)
  }
  await mkdir('docs/evidence/theme', { recursive: true })
  server = await startFolderTestServer(root, 1423)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: 'dark' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const ready = async () => {
    await page.goto(server.url)
    await page.waitForFunction(() => Boolean(window.__ocompare))
  }
  const theme = () => page.locator('html').getAttribute('data-theme')
  const bg = selector => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor)
  const darkSurface = async selector => {
    const rgb = (await bg(selector)).match(/\d+/g).slice(0, 3).map(Number)
    assert(rgb.every(channel => channel < 100), `${selector} should have a dark background: ${rgb}`)
  }
  await ready()
  assert.equal(await page.locator('#theme-toggle').count(), 1, 'Shared toolbar needs a theme toggle')
  assert.equal(await theme(), 'light', 'Default stays Light even on a dark OS')
  await page.screenshot({ path: 'docs/evidence/theme/files-light.png' })
  await page.evaluate(() => {
    const v = window.__ocompare
    v.sides.left.model.setValue('SELECT 1;\n')
    v.sides.right.model.setValue('SELECT 2;\n')
    v.editorFor('right').executeEdits('typing', [{ range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 10 }, text: ' -- unsaved' }])
    v.editorFor('right').setPosition({ lineNumber: 1, column: 4 })
  })
  await page.waitForFunction(() => window.__ocompare.diffCount() === 1)
  const before = await page.evaluate(() => ({ text: window.__ocompare.textOf('right'), position: window.__ocompare.editorFor('right').getPosition() }))
  await page.locator('#theme-toggle').click()
  assert.equal(await theme(), 'dark')
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true')
  for (const selector of ['body', '#toolbar', '.pathbar input', '#statusbar', '.monaco-editor-background']) await darkSurface(selector)
  assert.deepEqual(await page.evaluate(() => ({ text: window.__ocompare.textOf('right'), position: window.__ocompare.editorFor('right').getPosition() })), before)
  await page.evaluate(() => window.__ocompare.editorFor('right').getModel().undo())
  assert.equal(await page.evaluate(() => window.__ocompare.textOf('right')), 'SELECT 2;\n')
  await page.waitForFunction(() => window.__ocompare.diffCount() === 1)
  await page.screenshot({ path: 'docs/evidence/theme/files-dark.png' })
  await ready()
  assert.equal(await theme(), 'dark', 'Reload restores Dark before editor creation')
  await darkSurface('.monaco-editor-background')
  await page.locator('[data-mode=folders]').click()
  for (const side of ['left', 'right']) await page.locator(`[data-root=${side}]`).fill(join(root, side))
  await page.locator('[data-folder-cmd=compare]').click()
  await page.waitForFunction(() => document.querySelector('.folder-progress').textContent === 'Comparison complete')
  for (const selector of ['.folder-scroll', '.folder-row', '.folder-grid-header', '.folder-filterbar']) await darkSurface(selector)
  await page.locator('.folder-row').first().click()
  const contrast = await page.locator('.folder-row.selected').evaluate(el => {
    const luminance = color => {
      const c = color.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
    }
    const style = getComputedStyle(el), a = luminance(style.color), b = luminance(style.backgroundColor)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
  assert(contrast >= 4.5, `Changed-file text must stay readable when selected: ${contrast}`)
  await page.screenshot({ path: 'docs/evidence/theme/folders-dark.png' })
  await page.locator('[data-folder-cmd=filters]').click()
  await darkSurface('.folder-dialog')
  await darkSurface('.folder-dialog input')
  await page.screenshot({ path: 'docs/evidence/theme/dialog-dark.png' })
  await page.keyboard.press('Escape')
  await page.locator('#theme-toggle').focus()
  await page.keyboard.press('Space')
  assert.equal(await theme(), 'light')
  assert.equal(await bg('.folder-scroll'), 'rgb(255, 255, 255)')
  assert.equal(await page.locator('.folder-row').count(), 1, 'Switching theme preserves comparison results')
  await page.screenshot({ path: 'docs/evidence/theme/folders-light.png' })
  await ready()
  assert.equal(await theme(), 'light', 'Reload restores Light too')
  await page.evaluate(() => localStorage.setItem('ocompare-theme', 'invalid'))
  await ready()
  assert.equal(await theme(), 'light', 'Invalid saved values fall back to Light')
  await page.setViewportSize({ width: 900, height: 650 })
  await page.locator('[data-mode=folders]').click()
  await page.locator('#theme-toggle').click()
  const bounds = await page.locator('#theme-toggle').boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 900, 'Toggle remains reachable in compact windows')
  await page.screenshot({ path: 'docs/evidence/theme/compact-dark.png' })
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  assert.deepEqual(errors, [])
  const blocked = await browser.newContext()
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError') } })
  })
  const blockedPage = await blocked.newPage()
  blockedPage.on('pageerror', e => errors.push(e.message))
  await blockedPage.goto(server.url)
  await blockedPage.waitForFunction(() => Boolean(window.__ocompare))
  await blockedPage.locator('#theme-toggle').click()
  assert.equal(await blockedPage.locator('html').getAttribute('data-theme'), 'dark', 'Blocked storage must not prevent toggling')
  assert((await blockedPage.locator('#st-msg').textContent()).includes('could not save'))
  assert.deepEqual(errors, [])
  await blocked.close()
  console.log('PASS: default, toggle, editor/edit/undo preservation, persistence, Files/Folders/dialogs, keyboard, compact window, blocked storage, no runtime errors')
} finally {
  await browser?.close()
  await server?.close()
  // Only the exact disposable directory returned by mkdtemp is removed.
  await rm(root, { recursive: true, force: true })
}
