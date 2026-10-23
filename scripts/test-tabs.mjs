import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright'
const server = await createServer({ configFile:false, root:process.cwd(), server:{host:'127.0.0.1',port:1427,strictPort:true,watch:{ignored:['**/src-tauri/target/**','**/release/**']}} })
let browser
try {
 await server.listen(); browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:1427/tests/editor.html'); await page.waitForFunction(()=>!!window.editorTest)
 const result=await page.evaluate(async()=>{
  const {FileTabs}=await import('/src/renderer/fileTabs.ts'); const {view,monaco}=window.editorTest
  const tabs=new FileTabs(view); const first=tabs.active
  const file=(path,text)=>({path,text,encoding:'utf-8',bom:false,eol:'LF',size:text.length,mtimeMs:1})
  tabs.replace(first,'left',file('C:\\work\\a.sql','one\ntwo')); tabs.replace(first,'right',file('C:\\work\\b.sql','right'))
  view.editorFor('left').setPosition({lineNumber:2,column:2}); view.editorFor('left').focus()
  view.editorFor('left').executeEdits('test',[{range:new monaco.Range(2,1,2,1),text:'edited '}]); const doc=first.sides.left
  first.options.wrap=true; const second=tabs.create(); tabs.replace(second,'left',file('c:/work/A.sql','SHOULD NOT RELOAD'))
  const shared=second.sides.left===doc && view.textOf('left')==='one\nedited two'
  tabs.activate(first.id); const position=view.editorFor('left').getPosition(); view.editorFor('left').trigger('test','undo',null)
  const undo=view.textOf('left')==='one\ntwo'; view.editorFor('left').trigger('test','redo',null)
  const redo=view.textOf('left')==='one\nedited two'; const dirty=tabs.dirtyPaths()
  const found=tabs.findPair('c:/work/a.sql','c:/work/b.sql')===first
  const docId=doc.id; tabs.remove(first.id); const retained=tabs.documents().some(d=>d.id===docId)
  tabs.remove(second.id); await new Promise(resolve=>setTimeout(resolve,25)); const disposed=doc.model.isDisposed(); const blank=tabs.tabs.length===1 && !tabs.active.sides.left.path
  return {shared,undo,redo,dirty,found,retained,disposed,blank,position:{lineNumber:position.lineNumber,column:position.column}}
 }); assert.equal(result.shared,true); assert.equal(result.undo,true); assert.equal(result.redo,true); assert.deepEqual(result.dirty,['C:\\work\\a.sql']); assert.equal(result.found,true); assert.equal(result.retained,true); assert.equal(result.disposed,true); assert.equal(result.blank,true); assert.equal(result.position.lineNumber,2); assert.deepEqual(errors,[])
 console.log('PASS: tab models share documents, preserve view/undo, identify ordered pairs and dispose final references')
} finally {await browser?.close(); await server.close()}
