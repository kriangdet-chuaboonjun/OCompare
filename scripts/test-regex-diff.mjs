import assert from 'node:assert/strict'
import { computeRegexDiff } from '../src/renderer/regexDiffCore.ts'
const mapping = (text, starts, ends = starts) => ({ text, lines: [{ startColumns: starts, endColumns: ends }] })
const pair = { left: mapping('ไทย😀X', [1,2,3,4,5,9,10], [1,2,3,4,5,6,10]), right: mapping('ไทย😀Y', [1,2,3,4,5,10,11], [1,2,3,4,5,6,11]), applied: true, reason: null }
const diff = computeRegexDiff(pair, { ignoreTrimWhitespace: false, maxComputationTimeMs: 0 })
assert.equal(diff.changes.length, 1)
const inner = diff.changes[0].innerChanges[0]
assert.equal(inner.originalRange.startColumn, 9)
assert.equal(inner.originalRange.endColumn, 10)
assert.equal(inner.modifiedRange.startColumn, 10)
assert.equal(inner.modifiedRange.endColumn, 11)
const same = computeRegexDiff({ ...pair, right: pair.left }, {})
assert.equal(same.changes.length, 0)
assert.equal(same.identical, true)
console.log('Regex diff mapping and equivalence passed')
