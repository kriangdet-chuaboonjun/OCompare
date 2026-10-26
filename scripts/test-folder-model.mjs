import assert from 'node:assert/strict'
import { matchesName, projectRows, defaultViewOptions, addIgnoredFolders, normalizeIgnoredFolders } from '../src/renderer/folderModel.ts'
const entry=(relativePath,status='identical',kind='file')=>({relativePath,status,kind,error:null,left:{name:relativePath.split('/').at(-1),kind,size:1,mtimeMs:1,path:relativePath},right:null})
assert(matchesName('LICENSE','*.*',''))
assert(matchesName('src/A.CS','*.cs;*.sql',''))
assert(!matchesName('bin/a.cs','*.cs','bin/**'))
assert(!matchesName('src/a.sql','*.cs',''))
const entries=[entry('src','different','directory'),entry('src/a.cs','different'),entry('src/b.txt'),entry('bin','identical','directory'),entry('bin/a.cs')]
const opts={...defaultViewOptions(),include:'*.cs',exclude:'bin/**'}
assert.deepEqual(projectRows(entries,opts,new Set()).map(e=>e.entry.relativePath),['src','src/a.cs'])
assert.deepEqual(projectRows(entries,{...opts,structure:'flat'},new Set()).map(e=>e.entry.relativePath),['src/a.cs'])
assert(projectRows(entries,{...opts,peek:true},new Set()).some(e=>e.entry.relativePath==='src/b.txt'&&e.hidden))
assert.deepEqual(addIgnoredFolders(['build'],['builder','build/obj','build']),['build','builder'])
assert.deepEqual(addIgnoredFolders(['src/generated'],['src']),['src'])
assert.deepEqual(addIgnoredFolders([],['ไทย/ผลลัพธ์','ไทย']),['ไทย'])
assert.deepEqual(normalizeIgnoredFolders(undefined),[])
assert.deepEqual(normalizeIgnoredFolders(['a',1,'']),['a'])
console.log('PASS: wildcard, include/exclude, ancestor retention, flat mode, Peek and ignore-list helpers')
