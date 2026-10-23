import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'
const root = await mkdtemp(join(tmpdir(), 'ocompare-tabs-'))
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture root')
let server, browser
try {
 const first=join(root,'first.txt'), second=join(root,'second.txt'), third=join(root,'third.txt')
 await Promise.all([[first,'first\nline two'],[second,'second\nline two'],[third,'third']].map(([path,text])=>writeFile(path,text)))
 server=await startFolderTestServer(root,1428); browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:1300,height:850}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message))
 await page.goto(server.url); await page.waitForFunction(()=>!!window.__ocompare)
 const open=async(side,path)=>{const input=page.locator(`.side-head[data-side=${side}] .path`); await input.fill(path); await input.press('Enter'); await page.waitForFunction(({side,path})=>window.__ocompare.sides[side].path===path,{side,path})}
 await open('left',first); await open('right',second)
 await page.locator('[data-cmd=wrap]').click()
 await page.evaluate(()=>{const v=window.__ocompare; v.editorFor('right').focus();v.editorFor('right').executeEdits('test',[{range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},text:'edited '}])})
 await page.keyboard.press('Control+t'); assert.equal(await page.getByRole('tab').count(),2)
 assert.equal(await page.locator('[data-cmd=wrap]').getAttribute('aria-pressed'),'false')
 await open('left',third)
 await page.keyboard.press('Control+Shift+Tab'); assert.equal(await page.locator('[data-cmd=wrap]').getAttribute('aria-pressed'),'true')
 assert.equal(await page.evaluate(()=>window.__ocompare.textOf('right')),'edited second\nline two')
 await page.keyboard.press('Control+w'); await page.getByRole('dialog').waitFor(); await page.getByRole('button',{name:'Cancel',exact:true}).click(); assert.equal(await page.getByRole('tab').count(),2)
 // A delayed real filesystem save must mark its source document, never the newly selected tab.
 let releaseSave; const saving=new Promise(resolve=>releaseSave=resolve)
 await page.route('**/__folder_test/workspace',async route=>{const body=route.request().postDataJSON(); if(body.action==='saveFile'){const response=await route.fetch();await saving;await route.fulfill({response})}else await route.continue()})
 await page.locator('.side-head[data-side=right] .save').click(); await page.waitForTimeout(100)
 await page.keyboard.press('Control+Tab'); releaseSave()
 await page.waitForFunction(()=>!window.testDirty)
 assert.equal(await page.evaluate(()=>window.__ocompare.sides.left.path),third)
 assert.equal(await page.evaluate(()=>window.__ocompare.textOf('left')),'third')
 assert.equal(await readFile(second,'utf8'),'edited second\nline two')
 await page.unroute('**/__folder_test/workspace')
 await page.keyboard.press('Control+Shift+Tab')
 assert.equal(await page.evaluate(()=>window.__ocompare.isDirty('right')),false)
 // A read begun on tab one still applies there after selecting tab two.
 let releaseRead; const reading=new Promise(resolve=>releaseRead=resolve)
 await page.route('**/__folder_test/workspace',async route=>{const body=route.request().postDataJSON();if(body.action==='readFile'&&body.path===third){const response=await route.fetch();await reading;await route.fulfill({response})}else await route.continue()})
 const input=page.locator('.side-head[data-side=left] .path');await input.fill(third);await input.press('Enter');await page.waitForTimeout(100)
 await page.keyboard.press('Control+Tab'); releaseRead();await page.waitForTimeout(150)
 assert.equal(await page.evaluate(()=>window.__ocompare.sides.right.path),null)
 await page.keyboard.press('Control+Shift+Tab');await page.waitForFunction(path=>window.__ocompare.sides.left.path===path,third)
 await page.unroute('**/__folder_test/workspace')
 // Shared third.txt document edits remain dirty in both comparisons.
 await page.evaluate(()=>window.__ocompare.editorFor('left').executeEdits('test',[{range:{startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:1},text:'shared '}]))
 await page.keyboard.press('Control+Tab');assert.equal(await page.evaluate(()=>window.__ocompare.textOf('left')),'shared third')
 await page.keyboard.press('Control+w'); assert.equal(await page.getByRole('tab').count(),1)
 await page.keyboard.press('Control+w');await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Discard',exact:true}).click()
 assert.equal(await page.getByRole('tab').count(),1);assert.equal(await page.evaluate(()=>window.__ocompare.textOf('left')),'')
 await page.waitForTimeout(500);assert.deepEqual(errors,[])
 console.log('PASS: tab shortcuts, per-tab options, Cancel/Discard, shared dirty text and asynchronous real read/save isolation')
} finally {await browser?.close();await server?.close();await rm(root,{recursive:true,force:true})}
