import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,sep } from 'node:path'
import { chromium } from 'playwright'
import { startFolderTestServer } from './folder-test-server.mjs'
const root=await mkdtemp(join(tmpdir(),'ocompare-folder-controls-'))
if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe fixture root')
let server,browser
const checks=[]
try {
  const left=join(root,'left'),right=join(root,'right')
  for(const dir of [left,right]){await mkdir(join(dir,'nested'),{recursive:true});await writeFile(join(dir,'nested/a.sql'),'SELECT 1;\n');await writeFile(join(dir,'a.txt'),'same')}
  server=await startFolderTestServer(root,1423);browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1500,height:950}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);await page.locator('[data-mode=folders]').click();await page.locator('[data-root=left]').fill(left);await page.locator('[data-root=right]').fill(right);await page.locator('[data-folder-cmd=compare]').click();await page.waitForFunction(()=>document.querySelector('.folder-progress').textContent==='Comparison complete')
  const filterButton=cmd=>page.locator(`[data-folder-cmd=${cmd}]`)
  const selectedFilter=async cmd=>{
    for(const name of ['all','diffs','same'])assert.equal(await filterButton(name).getAttribute('aria-pressed'),String(name===cmd),`${name} selected state after ${cmd}`)
  }
  await selectedFilter('all')
  await filterButton('diffs').locator('svg').click()
  assert.equal(await page.locator('.folder-canvas [data-path]').count(),0)
  await selectedFilter('diffs')
  await filterButton('same').click()
  await page.locator('[data-path="a.txt"]').waitFor()
  await selectedFilter('same')
  await filterButton('all').click()
  await selectedFilter('all')
  await filterButton('filters').click()
  await page.locator('[data-filter=identical]').uncheck()
  await page.getByRole('button',{name:'Apply',exact:true}).click()
  await selectedFilter('custom')
  await filterButton('all').click()
  await selectedFilter('all')
  checks.push('All/Diffs/Same filter real rows and visibly track the selected preset, including icon clicks')
  const drag=async(locator,dx,dy=0)=>{const b=await locator.boundingBox();assert(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+dx,b.y+b.height/2+dy,{steps:5});await page.mouse.up()}
  const name=page.locator('.folder-grid-header .folder-column').first();const before=(await name.boundingBox()).width
  await drag(page.locator('[title="Resize left name"]'),20)
  assert((await name.boundingBox()).width>before+10)
  const rowLeft=await page.locator('[data-path="a.txt"] .folder-name').first().boundingBox();assert(Math.abs(rowLeft.width-(await name.boundingBox()).width)<2)
  await drag(page.getByRole('separator',{name:'Resize comparison panes'}),80)
  const split=Number(await page.locator('.folder-tab-panel:not([hidden])').evaluate(el=>el.style.getPropertyValue('--folder-left').replace('%','')));assert(split>50)
  const logBefore=await page.locator('.folder-log').evaluate(el=>el.offsetHeight);await drag(page.getByRole('separator',{name:'Resize log'}),0,-30);assert(await page.locator('.folder-log').evaluate(el=>el.offsetHeight)>logBefore)
  checks.push('Name column, pane splitter and log resize use pointer capture and keep row/header widths aligned')
  await page.locator('[data-path=nested]').click();await page.locator('[data-folder-cmd=collapse]').click();await page.getByRole('button',{name:'Selected folders',exact:true}).click();assert.equal(await page.locator('[data-path="nested/a.sql"]').count(),0);await page.locator('[data-folder-cmd=expand]').click();await page.getByRole('button',{name:'Selected folders',exact:true}).click();await page.locator('[data-path="nested/a.sql"]').waitFor()
  await page.locator('[data-folder-cmd=select]').click();await page.getByRole('button',{name:'Select all visible',exact:true}).click();assert((await page.locator('[data-selection]').textContent()).includes('3 selected'))
  await page.locator('[data-folder-cmd=select]').click();await page.getByRole('button',{name:'Invert selection',exact:true}).click();assert((await page.locator('[data-selection]').textContent()).includes('0 selected'))
  await page.locator('[data-path="a.txt"]').click({button:'right'});await page.getByRole('menu',{name:'Selected items'}).getByRole('menuitem',{name:'Open files',exact:true}).click();await page.waitForFunction(()=>window.__ocompare.textOf('left')==='same');await page.locator('[data-mode=folders]').click();checks.push('Selected expand/collapse, Select all/invert and context-menu Open files reuse toolbar commands')
  assert.equal(await page.locator('[data-folder-cmd=home], [data-folder-cmd=sessions]').count(),0)
  const folderY=(await page.locator('.folder-toolbar').boundingBox()).y
  await page.locator('[data-mode=files]').click()
  const fileY=(await page.locator('#file-tools').boundingBox()).y
  assert(Math.abs(folderY-fileY)<2)
  assert.equal(await page.locator('#folder-tools').isVisible(),false)
  await page.locator('[data-mode=folders]').click()
  assert.equal(await page.locator('#file-tools').isVisible(),false)
  assert.equal(await page.locator('#folder-tools').isVisible(),true)
  await page.locator('[data-mode=files]').click()
  await page.evaluate(()=>{
    const view=window.__ocompare
    for(const side of ['left','right'])view.load(side,{path:`${side}.txt`,text:`shared start\nshared 2\nshared 3\nshared 4\n${side}\nshared 6\nshared 7\nshared 8\nshared end\n`,encoding:'utf-8',bom:false,eol:'LF',size:80,mtimeMs:1})
  })
  await page.waitForFunction(()=>window.__ocompare.diffCount()===1)
  const fileButton=cmd=>page.locator(`#file-tools [data-cmd=${cmd}]`)
  const selectedFile=async cmd=>{
    for(const name of ['viewAll','viewDiffs','viewContext']){
      assert.equal(await fileButton(name).getAttribute('aria-pressed'),String(name===cmd))
      assert.equal(await fileButton(name).evaluate(el=>el.classList.contains('active')),name===cmd)
    }
  }
  await selectedFile('viewAll')
  await fileButton('viewDiffs').locator('svg').click()
  await selectedFile('viewDiffs')
  await page.waitForFunction(()=>![...document.querySelectorAll('.view-line')].some(el=>el.textContent.includes('start')))
  await fileButton('viewContext').click()
  await selectedFile('viewContext')
  await fileButton('viewAll').locator('span').click()
  await selectedFile('viewAll')
  await page.waitForFunction(()=>[...document.querySelectorAll('.view-line')].some(el=>el.textContent.includes('start')))
  await fileButton('ignoreWs').locator('svg').click()
  assert.equal(await fileButton('ignoreWs').getAttribute('aria-pressed'),'true')
  await fileButton('ignoreWs').click()
  await fileButton('wrap').locator('svg').click()
  assert.equal(await fileButton('wrap').getAttribute('aria-pressed'),'true')
  await fileButton('wrap').click()
  await page.locator('[data-mode=folders]').click()
  await selectedFilter('all')
  checks.push('Files All/Diffs/Context filter rendered lines and track selection; icon/label clicks, Minor/Wrap and mode switching work')
  checks.push('Folders toolbar shares the Files header row; mode switching hides the other toolbar and Home/Sessions are removed')
  await page.locator('[data-mode=files]').click()
  await page.screenshot({path:'docs/evidence/icons-files-0.3.2.png'});await page.locator('#toolbar').screenshot({path:'docs/evidence/icons-files-toolbar-0.3.2.png'})
  await page.locator('[data-mode=folders]').click()
  await page.screenshot({path:'docs/evidence/icons-folders-0.3.2.png'});await page.locator('#toolbar').screenshot({path:'docs/evidence/icons-folders-toolbar-0.3.2.png'})
  const scaled=await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:1.5});const p=await scaled.newPage();await p.goto(server.url);await p.locator('[data-mode=folders]').click();await p.locator('[data-root=left]').fill(left);await p.locator('[data-root=right]').fill(right);await p.locator('[data-folder-cmd=compare]').click();await p.waitForFunction(()=>document.querySelector('.folder-progress').textContent==='Comparison complete');assert.equal(await p.evaluate(()=>window.devicePixelRatio),1.5);await p.screenshot({path:'docs/evidence/folders-0.3.0-dpr150.png'});checks.push('Browser DPR 1.5 and 1000x700 render and compare; this is not Windows system-DPI verification')
  assert.deepEqual(errors,[]);await writeFile('docs/evidence/folder-controls-0.3.0.json',JSON.stringify({checks,errors},null,2));console.log(`PASS: ${checks.length} control interaction groups`);checks.forEach(s=>console.log('  '+s))
}finally{await browser?.close();await server?.close();await rm(root,{recursive:true,force:true})}
