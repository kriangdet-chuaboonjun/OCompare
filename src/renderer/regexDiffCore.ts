// Monaco 0.57 internal imports are deliberately isolated and guarded by integration tests.
// @ts-expect-error Monaco does not publish declarations for this internal module.
import { DefaultLinesDiffComputer } from 'monaco-editor/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js'
import type { NormalizedPair, NormalizedText } from './regexDiff'

export interface DiffRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
export interface DiffChange {
  original: { startLineNumber: number; endLineNumberExclusive: number }
  modified: { startLineNumber: number; endLineNumberExclusive: number }
  innerChanges?: { originalRange: DiffRange; modifiedRange: DiffRange }[]
}
export interface RegexDiffResult { changes: DiffChange[]; moves: never[]; identical: boolean; quitEarly: boolean }

/** Convert normalized UTF-16 columns back without including ignored adjacent spans. */
function restoreRange(range: DiffRange, normalized: NormalizedText): DiffRange {
  const column = (line: number, col: number, end: boolean) => {
    const row = normalized.lines[line - 1]
    const values = end ? row?.endColumns : row?.startColumns
    return values?.[col - 1] ?? col
  }
  const startColumn = column(range.startLineNumber, range.startColumn, false)
  let endColumn = column(range.endLineNumber, range.endColumn, true)
  if (range.startLineNumber === range.endLineNumber) endColumn = Math.max(startColumn, endColumn)
  return { ...range, startColumn, endColumn }
}

/** CPU-heavy line diff runs exclusively inside the dedicated Vite worker. */
export function computeRegexDiff(pair: NormalizedPair, options: Record<string, unknown>): RegexDiffResult {
  const result = new DefaultLinesDiffComputer().computeDiff(
    pair.left.text.split(/\r\n|\n|\r/), pair.right.text.split(/\r\n|\n|\r/),
    { ignoreTrimWhitespace: false, maxComputationTimeMs: 3000, ...options, computeMoves: false },
  )
  const changes: DiffChange[] = result.changes.map((change: DiffChange) => ({
    original: { ...change.original }, modified: { ...change.modified },
    innerChanges: change.innerChanges?.map(inner => ({
      originalRange: restoreRange(inner.originalRange, pair.left),
      modifiedRange: restoreRange(inner.modifiedRange, pair.right),
    })),
  }))
  return { changes, moves: [], identical: changes.length === 0, quitEarly: result.hitTimeout }
}
