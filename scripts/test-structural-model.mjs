import assert from 'node:assert/strict'
import { detectFormat, structuralPath, virtualKind, isVirtualPath } from '../src/renderer/structural.ts'

const side = (path, text = '') => ({ path, text })
const ok = (left, right) => { const r = detectFormat(left, right); assert('format' in r, JSON.stringify(r)); return r.format }
const fails = (left, right) => { const r = detectFormat(left, right); assert('error' in r && r.error.length > 0, JSON.stringify(r)) }

assert.equal(ok(side('E:\\a.json'), side('E:\\b.JSON')), 'json')
assert.equal(ok(side(null, '  \n {"a":1}'), side(null, '[1]')), 'json')
// A side without a path takes the other side's format; parse errors are reported later.
assert.equal(ok(side('a.json'), side(null, 'not json')), 'json')
assert.equal(ok(side(null, 'not json'), side('a.json')), 'json')
// A saved file with an unknown extension never inherits, but sniffable content still works.
fails(side('a.json', '{}'), side('b.txt', 'plain words'))
assert.equal(ok(side('a.json'), side('b.txt', '{"a":1}')), 'json')
fails(side(null, 'plain'), side(null, 'words'))
fails(side(null, ''), side(null, ''))

// XML: by extension, by sniffing a leading '<', and never mixed with JSON.
assert.equal(ok(side('a.xml'), side('b.config')), 'xml')
assert.equal(ok(side('app.csproj'), side(null, '\n<?xml version="1.0"?><a/>')), 'xml')
assert.equal(ok(side(null, '<a/>'), side('notes.txt', '  <b/>')), 'xml')
fails(side('a.json'), side('b.xml'))
fails(side(null, '{}'), side(null, '<a/>'))
fails(side('a.xml', '<a/>'), side('b.txt', 'plain'))

// CSV: by extension only (never sniffed), inherited by an Untitled side.
assert.equal(ok(side('a.CSV'), side('b.tsv')), 'csv')
assert.equal(ok(side('a.csv'), side(null, 'x;y')), 'csv')
fails(side(null, 'a,b'), side(null, 'c,d'))
fails(side('a.csv'), side('b.json'))
fails(side('a.csv'), side('b.txt', 'a,b'))

const left = structuralPath('json', 'left', { path: 'E:\\a\\config.json', id: 'document-1' })
assert.equal(left, 'structural://json/left/E:/a/config.json')
assert.equal(structuralPath('json', 'right', { path: null, id: 'document-7' }), 'structural://json/right/untitled-document-7/Untitled')
// Same file name in different folders must not collide, and the two sides must differ.
const other = structuralPath('json', 'right', { path: 'E:\\b\\config.json', id: 'document-2' })
assert.notEqual(left, other)
assert.notEqual(structuralPath('json', 'left', { path: 'E:\\a\\config.json', id: 'x' }), structuralPath('json', 'right', { path: 'E:\\a\\config.json', id: 'x' }))

assert.equal(virtualKind('history://abc/file.txt'), 'History')
assert.equal(virtualKind(left), 'Structural')
assert.equal(virtualKind('E:\\a\\history.txt'), null)
assert.equal(virtualKind(null), null)
assert.equal(virtualKind(undefined), null)
assert.equal(isVirtualPath(left), true)
assert.equal(isVirtualPath('E:\\a.json'), false)
console.log('PASS: structural format detection, virtual path identity and virtual-kind helpers')
