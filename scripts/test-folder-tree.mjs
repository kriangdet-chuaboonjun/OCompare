import assert from 'node:assert/strict'
import { visibleFolderEntries } from '../src/renderer/folderTree.ts'

const entry = (relativePath, kind, status) => ({ relativePath, kind, status, left: { kind }, right: null, error: null })
const entries = [entry('parent', 'directory', 'different'), entry('parent/nested', 'directory', 'different'), entry('parent/nested/only.txt', 'file', 'left-only'), entry('same.txt', 'file', 'identical'), entry('empty', 'directory', 'identical')]
assert.deepEqual(visibleFolderEntries(entries, new Set(['left-only']), new Set()).map(e => e.relativePath), ['parent', 'parent/nested', 'parent/nested/only.txt'])
assert.deepEqual(visibleFolderEntries(entries, new Set(['left-only']), new Set(['parent'])).map(e => e.relativePath), ['parent'])
assert.deepEqual(visibleFolderEntries(entries, new Set(['identical']), new Set()).map(e => e.relativePath), ['same.txt', 'empty'])
assert.deepEqual(visibleFolderEntries(entries, new Set(), new Set()), [])
assert.equal(visibleFolderEntries([entry('empt', 'directory', 'identical'), entry('empty', 'file', 'identical')], new Set(['identical']), new Set()).length, 2)
const conflict = { ...entry('conflict', 'directory', 'different'), left: { kind: 'file' }, right: { kind: 'directory' } }
assert.equal(visibleFolderEntries([conflict, entry('conflict/child', 'file', 'right-only')], new Set(['different']), new Set())[0], conflict)
console.log('PASS: folder filter ancestry, collapse, empty directories, empty filter and type conflicts')
