import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'

// Folders mode accepts dropped folders; paths are classified by the real Rust core, only the native drop event is injected.
const root = await mkdtemp(join(tmpdir(), 'ocompare-drop-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture directory')
let server, browser
try {
  const [a, b, file] = [join(root, 'โฟลเดอร์ A'), join(root, 'B'), join(root, 'note.txt')]
  await Promise.all([mkdir(a), mkdir(b), writeFile(file, 'x')])
  server = await startFolderTestServer(root, 1456)
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(server.url); await page.waitForFunction(() => typeof window.__ocompareDrop === 'function')
  await page.locator('[data-mode=folders]').click()
  const panel = '.folder-tab-panel:not([hidden])'
  const root_ = side => page.locator(`${panel} input[data-root=${side}]`)
  const drop = (type, paths, x) => page.evaluate(args => window.__ocompareDrop({ type: args.type, paths: args.paths, x: args.x }), { type, paths, x })

  await drop('over', [a], 1200)
  assert.equal(await page.locator(`${panel} .folder-pathbar.drop-target`).count(), 1)
  assert.equal(await page.locator(`${panel} input[data-root=right]`).evaluate(el => el.parentElement.classList.contains('drop-target')), true)
  await drop('leave', [], 0)
  assert.equal(await page.locator(`${panel} .folder-pathbar.drop-target`).count(), 0)

  await drop('drop', [a], 100)
  await page.waitForFunction(v => document.querySelector('.folder-tab-panel:not([hidden]) input[data-root=left]').value === v, a)
  assert.equal(await root_('right').inputValue(), '')

  await drop('drop', [b], 1200)
  await page.waitForFunction(v => document.querySelector('.folder-tab-panel:not([hidden]) input[data-root=right]').value === v, b)

  await drop('drop', [b, a], 700)
  await page.waitForFunction(([l, r]) => document.querySelector('.folder-tab-panel:not([hidden]) input[data-root=left]').value === l && document.querySelector('.folder-tab-panel:not([hidden]) input[data-root=right]').value === r, [b, a])

  await drop('drop', [file], 100)
  await page.waitForFunction(() => document.querySelector('#st-msg').textContent.includes('files are not compared'))
  assert.equal(await root_('left').inputValue(), b, 'a dropped file must not replace a folder root')

  await drop('drop', [file, a], 100)
  await page.waitForFunction(v => document.querySelector('.folder-tab-panel:not([hidden]) input[data-root=left]').value === v, a)
  assert.match(await page.locator('#st-msg').textContent(), /dropped files were ignored/)
  assert.deepEqual(errors, [])
  console.log('PASS: Folders mode drop — side by pointer, two folders fill both, files ignored, highlight follows pointer')
} finally {
  await browser?.close(); await server?.close()
}
