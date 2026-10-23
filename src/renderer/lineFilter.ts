import * as monaco from 'monaco-editor'

/** Hidden-area API that exists on Monaco's code editor but is not in its public typings. */
interface HiddenAreasEditor {
  setHiddenAreas(ranges: monaco.IRange[], source?: unknown): void
}

/** An unchanged block: same length on both sides. */
interface Block {
  original: number // first line on the left
  modified: number // first line on the right
  length: number
}

const SOURCE = 'o-compare-line-filter'

/**
 * Join hidden ranges that touch on one side. This happens when a difference
 * has no lines on that side (lines only on the other side): Monaco shows the
 * two hidden blocks as one, so they get one bar with the combined count.
 */
function mergeAdjacent(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [first, length] of ranges) {
    const last = out[out.length - 1]
    if (last && last[0] + last[1] === first) last[1] += length
    else out.push([first, length])
  }
  return out
}

/**
 * Beyond Compare's "Diffs" / "Context" filter: hides unchanged lines on both
 * sides and leaves a thin "N FILTERED LINES" bar where they were.
 *
 * Unchanged blocks always have the same number of lines on both sides, so
 * hiding the same block on each side keeps the two panes aligned.
 */
export class LineFilter {
  private zoneIds: { original: string[]; modified: string[] } = { original: [], modified: [] }

  constructor(private readonly diff: monaco.editor.IStandaloneDiffEditor) {}

  /** contextLines: null shows everything; 0 = differences only; n = n lines around each difference. */
  apply(contextLines: number | null): void {
    const changes = this.diff.getLineChanges()
    const original = this.diff.getOriginalEditor()
    const modified = this.diff.getModifiedEditor()
    const blocks = contextLines === null || !changes ? [] : this.hiddenBlocks(changes, contextLines)

    ;(original as unknown as HiddenAreasEditor).setHiddenAreas(
      blocks.map((b) => new monaco.Range(b.original, 1, b.original + b.length - 1, 1)),
      SOURCE
    )
    ;(modified as unknown as HiddenAreasEditor).setHiddenAreas(
      blocks.map((b) => new monaco.Range(b.modified, 1, b.modified + b.length - 1, 1)),
      SOURCE
    )
    this.zoneIds.original = this.replaceBars(original, this.zoneIds.original, mergeAdjacent(blocks.map((b) => [b.original, b.length])))
    this.zoneIds.modified = this.replaceBars(modified, this.zoneIds.modified, mergeAdjacent(blocks.map((b) => [b.modified, b.length])))
  }

  /** Unchanged blocks minus `context` lines next to each difference. */
  private hiddenBlocks(changes: monaco.editor.ILineChange[], context: number): Block[] {
    const origCount = this.diff.getOriginalEditor().getModel()!.getLineCount()
    const modCount = this.diff.getModifiedEditor().getModel()!.getLineCount()
    const blocks: Block[] = []
    let origNext = 1 // first left line after the previous difference
    let modNext = 1

    const addGap = (origEnd: number, modEnd: number, atStart: boolean, atEnd: boolean) => {
      // origEnd/modEnd are inclusive; both sides have the same gap length
      const length = Math.min(origEnd - origNext + 1, modEnd - modNext + 1)
      const top = atStart ? 0 : context
      const bottom = atEnd ? 0 : context
      const hidden = length - top - bottom
      if (hidden > 0) blocks.push({ original: origNext + top, modified: modNext + top, length: hidden })
    }

    changes.forEach((c, i) => {
      const origFirst = c.originalEndLineNumber === 0 ? c.originalStartLineNumber + 1 : c.originalStartLineNumber
      const modFirst = c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber + 1 : c.modifiedStartLineNumber
      addGap(origFirst - 1, modFirst - 1, i === 0, false)
      origNext = (c.originalEndLineNumber === 0 ? c.originalStartLineNumber : c.originalEndLineNumber) + 1
      modNext = (c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber : c.modifiedEndLineNumber) + 1
    })
    addGap(origCount, modCount, changes.length === 0, true)
    return blocks
  }

  /** Replace the "N FILTERED LINES" bars on one editor. */
  private replaceBars(editor: monaco.editor.ICodeEditor, oldIds: string[], bars: [number, number][]): string[] {
    const ids: string[] = []
    editor.changeViewZones((acc) => {
      oldIds.forEach((id) => acc.removeZone(id))
      for (const [first, length] of bars) {
        const dom = document.createElement('div')
        dom.className = 'filtered-lines'
        dom.textContent = `${length} FILTERED LINE${length === 1 ? '' : 'S'}`
        // Anchor on the last hidden line and keep the zone visible although its
        // anchor is hidden (also covers a hidden block at the end of the file)
        ids.push(
          acc.addZone({
            afterLineNumber: first + length - 1,
            heightInPx: 14,
            domNode: dom,
            suppressMouseDown: true,
            showInHiddenAreas: true
          })
        )
      }
    })
    return ids
  }
}
