import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

execFileSync('cargo', ['build','--manifest-path','src-tauri/Cargo.toml','--no-default-features','--example','comparison_normalize'], {stdio:'inherit'})
const exe = resolve('src-tauri/target/debug/examples/comparison_normalize' + (process.platform === 'win32' ? '.exe' : ''))
function normalizeMiddleware(request,response) {
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    const result = spawnSync(exe, {input:body,encoding:'utf8',maxBuffer:100*1024*1024})
    response.statusCode = result.status === 0 ? 200 : 400
    response.end(result.status === 0 ? result.stdout : result.stderr)
  })
}
const server = await createServer({configFile:false, root:process.cwd(), plugins:[{name:'rust-normalizer',configureServer(server){server.middlewares.use('/normalize',normalizeMiddleware)}}], optimizeDeps:{entries:['tests/regex-diff.html'],include:['monaco-editor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js']}, server:{host:'127.0.0.1',port:1425,strictPort:true,watch:{ignored:['**/src-tauri/target/**']}}})
let browser
try {
  await server.listen()
  browser = await chromium.launch({channel:'msedge',headless:true})
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:1425/tests/regex-diff.html')
  await page.waitForFunction(() => !!window.regexTest)
  const load = async (left,right,rules) => {
    await page.evaluate(({left,right,rules}) => {
      const test = window.regexTest
      test.adapter.setRules(rules)
      test.left.setValue(left); test.right.setValue(right)
    }, {left,right,rules})
  }
  const count = async expected => page.waitForFunction(expected => {
    const t = window.regexTest, v = t.computed()
    return v[0] === t.left.getVersionId() && v[1] === t.right.getVersionId() && t.editor.getLineChanges()?.length === expected
  }, expected, { timeout: 10000 }).catch(async error => {
    console.error(await page.evaluate(() => { const t=window.regexTest; return { computed:t.computed(),versions:[t.left.getVersionId(),t.right.getVersionId()],changes:t.editor.getLineChanges(),status:t.status } }), errors)
    throw error
  })
  const rules = [{id:'digits',pattern:'[0-9]+',enabled:true}]
  await load('ไทย😀123X\nend','ไทย😀1234X\nend',rules)
  await count(0)
  assert.equal(await page.evaluate(() => window.regexTest.right.getValue()),'ไทย😀1234X\nend')
  await page.evaluate(() => window.regexTest.right.setValue('ไทย😀1234Y\nend'))
  await count(1)
  const change = await page.evaluate(() => window.regexTest.editor.getLineChanges()[0].charChanges[0])
  assert.equal(change.originalStartColumn,9)
  assert.equal(change.modifiedStartColumn,10)
  await page.evaluate(() => window.regexTest.right.setValue('ไทย😀999999X\nend'))
  await count(0)
  await load('a\n123\nz','a\n999\nz',[])
  await count(1)
  await page.evaluate(rules => window.regexTest.adapter.setRules(rules), rules)
  await count(0)
  await load('a\n123\nz','a\n123\ninsert\nz',rules)
  await count(1)
  await page.evaluate(() => { window.regexTest.right.setValue('new 111'); window.regexTest.right.setValue('a\n999\nz') })
  await count(0)
  // Invalid Apply must leave draft open and active caller state unchanged.
  await page.evaluate(() => {
    const t = window.regexTest
    t.dialogResult = 'pending'
    t.openComparisonRules({rules:[],validate: rules => t.normalizePair('','',rules), normalizePair:t.normalizePair}).then(value => {t.dialogResult=value})
  })
  await page.getByRole('button',{name:'Add rule',exact:true}).click()
  await page.getByRole('textbox',{name:'Rule 1 pattern'}).fill('(?=bad)')
  await page.getByRole('button',{name:'Apply',exact:true}).click()
  await page.waitForSelector('[aria-invalid="true"]')
  assert.equal(await page.evaluate(() => window.regexTest.dialogResult),'pending')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await page.evaluate(() => window.regexTest.dialogResult),null)
  assert.deepEqual(errors,[])
  console.log('Rust engine + Monaco worker/provider, Unicode mapping, edits, cancellation, and invalid dialog Apply passed')
} finally { await browser?.close(); await server.close() }
