import * as monaco from 'monaco-editor'
import type { FileData, Side } from '../shared/types'
import { languageForPath } from './language'
import { LineFilter } from './lineFilter'
import { editorTheme } from './theme'

export type ViewMode = 'all' | 'diffs' | 'context'

export interface SideState {
  id: string
  path: string | null
  encoding: string
  bom: boolean
  size: number
  mtimeMs: number
  savedVersion: number
  model: monaco.editor.ITextModel
}

type Listener = () => void
let documentSequence = 0

/**
 * Wraps Monaco's DiffEditor: both sides are editable and Monaco recomputes
 * the diff after every edit, so recomparison is automatic.
 */
export class DiffView {
  readonly editor: monaco.editor.IStandaloneDiffEditor
  readonly sides: Record<Side, SideState>
  private focused: Side = 'right'
  private listeners: Listener[] = []
  private viewMode: ViewMode = 'all'
  private readonly filter: LineFilter
  private recompareKick = false
  private pairViewModel: monaco.editor.IDiffEditorViewModel | undefined

  constructor(host: HTMLElement, services?: monaco.editor.IEditorOverrideServices) {
    this.editor = monaco.editor.createDiffEditor(host, {
      theme: editorTheme(),
      originalEditable: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      automaticLayout: true,
      enableSplitViewResizing: true,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      diffWordWrap: 'off',
      maxComputationTime: 0,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: false,
      renderMarginRevertIcon: false,
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false }
    }, services)

    this.sides = {
      left: this.createDocument(),
      right: this.createDocument()
    }
    this.applyModels()

    this.filter = new LineFilter(this.editor)
    this.editor.onDidUpdateDiff(() => {
      // Re-filter on every recompare so edits and pasted text are filtered too
      this.applyFilter()
      this.emit()
    })
    for (const side of ['left', 'right'] as Side[]) {
      const ed = this.editorFor(side)
      ed.onDidFocusEditorText(() => {
        this.focused = side
        this.emit()
      })
      ed.onDidChangeCursorPosition(() => {
        if (this.focused === side) this.emit()
      })
    }
  }

  createDocument(): SideState {
    const model = monaco.editor.createModel('', 'plaintext')
    model.onDidChangeContent(() => this.emit())
    return { id: `document-${++documentSequence}`, path: null, encoding: 'utf-8', bom: false, size: 0, mtimeMs: 0, savedVersion: model.getAlternativeVersionId(), model }
  }

  private applyModels(): void {
    const previous = this.pairViewModel
    const next = this.editor.createViewModel({ original: this.sides.left.model, modified: this.sides.right.model })
    this.pairViewModel = next
    this.editor.setModel(next)
    // Cancel pending work before FileTabs retires the previous text models.
    previous?.dispose()
  }

  /** Attach persistent models without replacing their edit histories. */
  attach(sides: Record<Side, SideState>, focused: Side = 'right'): void {
    this.filter.apply(null)
    this.sides.left = sides.left
    this.sides.right = sides.right
    this.focused = focused
    this.applyModels()
    this.applyReadOnly()
    this.emit()
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn)
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn())
  }

  editorFor(side: Side): monaco.editor.IStandaloneCodeEditor {
    // Both inner editors of a standalone diff editor are standalone editors at runtime
    const ed = side === 'left' ? this.editor.getOriginalEditor() : this.editor.getModifiedEditor()
    return ed as monaco.editor.IStandaloneCodeEditor
  }

  get focusedSide(): Side {
    return this.focused
  }

  isDirty(side: Side): boolean {
    const s = this.sides[side]
    return s.model.getAlternativeVersionId() !== s.savedVersion
  }

  /** Replace a side's content with a freshly read file. */
  load(side: Side, file: FileData): void {
    this.loadDocument(this.sides[side], file)
  }

  /** Reload an existing document, including one in an inactive tab. */
  loadDocument(s: SideState, file: FileData): void {
    s.path = file.path || null
    s.encoding = file.encoding
    s.bom = file.bom
    s.size = file.size
    s.mtimeMs = file.mtimeMs
    monaco.editor.setModelLanguage(s.model, languageForPath(file.path))
    // pushEditOperations-free replace keeps the model (and its listeners) alive
    s.model.setValue(file.text)
    s.model.setEOL(file.eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    s.savedVersion = s.model.getAlternativeVersionId()
    if (s === this.sides.left || s === this.sides.right) this.applyReadOnly()
    this.emit()
  }
  private applyReadOnly(): void {
    this.editor.updateOptions({ originalEditable: !this.sides.left.path?.startsWith('history://'), readOnly: Boolean(this.sides.right.path?.startsWith('history://')) })
  }

  markSaved(side: Side, size: number, mtimeMs: number, savedVersion?: number): void {
    this.markDocumentSaved(this.sides[side], size, mtimeMs, savedVersion)
  }

  markDocumentSaved(s: SideState, size: number, mtimeMs: number, savedVersion?: number): void {
    s.size = size
    s.mtimeMs = mtimeMs
    s.savedVersion = savedVersion ?? s.model.getAlternativeVersionId()
    this.emit()
  }

  setLanguage(side: Side, lang: string): void {
    monaco.editor.setModelLanguage(this.sides[side].model, lang)
    this.emit()
  }

  eolOf(side: Side): 'LF' | 'CRLF' {
    return this.sides[side].model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
  }

  textOf(side: Side): string {
    return this.sides[side].model.getValue(monaco.editor.EndOfLinePreference.TextDefined)
  }

  diffCount(): number {
    return this.editor.getLineChanges()?.length ?? 0
  }

  /**
   * All / Diffs / Context. Uses our own LineFilter rather than Monaco's
   * hideUnchangedRegions, whose region tracking breaks when a whole side is
   * replaced (paste, load) and then refuses to hide anything.
   */
  setViewMode(mode: ViewMode): void {
    this.viewMode = mode
    this.applyFilter()
  }

  private applyFilter(): void {
    this.filter.apply(this.viewMode === 'all' ? null : this.viewMode === 'context' ? 3 : 0)
  }

  setIgnoreWhitespace(on: boolean): void {
    this.editor.updateOptions({ ignoreTrimWhitespace: on })
  }

  setWordWrap(on: boolean): void {
    this.editor.updateOptions({ diffWordWrap: on ? 'on' : 'off', wordWrap: on ? 'on' : 'off' })
  }

  goToDiff(dir: 'next' | 'previous'): void {
    const changes = this.editor.getLineChanges() ?? []
    if (changes.length === 0) return
    const side = this.focused
    const ed = this.editorFor(side)
    const line = ed.getPosition()?.lineNumber ?? 1
    const startOf = (c: monaco.editor.ILineChange) =>
      side === 'left'
        ? Math.max(1, c.originalEndLineNumber === 0 ? c.originalStartLineNumber + 1 : c.originalStartLineNumber)
        : Math.max(1, c.modifiedEndLineNumber === 0 ? c.modifiedStartLineNumber + 1 : c.modifiedStartLineNumber)
    const starts = changes.map(startOf)
    let target: number | undefined
    if (dir === 'next') target = starts.find((s) => s > line) ?? starts[0]
    else target = [...starts].reverse().find((s) => s < line) ?? starts[starts.length - 1]
    const max = ed.getModel()!.getLineCount()
    target = Math.min(target, max)
    ed.setPosition({ lineNumber: target, column: 1 })
    ed.revealLineInCenter(target)
    ed.focus()
  }

  /** [start, end] of a change on one side; end === 0 means that side has no lines (block sits after `start`). */
  private range(c: monaco.editor.ILineChange, side: Side): [number, number] {
    return side === 'left'
      ? [c.originalStartLineNumber, c.originalEndLineNumber]
      : [c.modifiedStartLineNumber, c.modifiedEndLineNumber]
  }

  /** The diff section under the cursor of the focused side, if any. */
  currentChange(): monaco.editor.ILineChange | undefined {
    const side = this.focused
    const line = this.editorFor(side).getPosition()?.lineNumber ?? 0
    return (this.editor.getLineChanges() ?? []).find((c) => {
      const [start, end] = this.range(c, side)
      return end === 0 ? line === start || line === start + 1 : line >= start && line <= end
    })
  }

  /** Lines of a change on `side` as [start, end]; an empty block gives end = start - 1. */
  changeLines(c: monaco.editor.ILineChange, side: Side): [number, number] {
    const [start, end] = this.range(c, side)
    return end === 0 ? [start + 1, start] : [start, end]
  }

  /**
   * Map a line on `from` to the aligned line on the other side.
   * Inside a change, lines pair up top-down (the way the diff is drawn);
   * a line past the end of the other block maps to the insertion point below it.
   * `edge` decides how an empty/short block resolves: 'start' -> line after, 'end' -> line before.
   */
  private mapLine(from: Side, line: number, edge: 'start' | 'end'): number {
    const to: Side = from === 'left' ? 'right' : 'left'
    const changes = this.editor.getLineChanges() ?? []
    let base: [number, number] = [0, 0] // last aligned (src, dst) line pair before `line`
    for (const c of changes) {
      const [s, e] = this.range(c, from)
      const [ds, de] = this.range(c, to)
      if (e !== 0 && line >= s && line <= e) {
        if (de === 0) return edge === 'start' ? ds + 1 : ds
        const paired = ds + (line - s)
        if (paired <= de) return paired
        return edge === 'start' ? de + 1 : de
      }
      const srcLast = e === 0 ? s : e
      if (srcLast < line) base = [srcLast, de === 0 ? ds : de]
    }
    return base[1] + (line - base[0])
  }

  /**
   * Replace lines [start, end] of `to` with `lines`.
   * end < start means "insert before line `start`" (nothing replaced).
   */
  private replaceLines(to: Side, start: number, end: number, lines: string[], source: string): void {
    const dst = this.sides[to].model
    const eol = dst.getEOL()
    const text = lines.join(eol)
    const count = dst.getLineCount()
    let range: monaco.IRange
    let insert: string

    if (end < start) {
      if (lines.length === 0) return
      if (start <= count) {
        range = new monaco.Range(start, 1, start, 1)
        insert = text + eol
      } else {
        const col = dst.getLineMaxColumn(count)
        range = new monaco.Range(count, col, count, col)
        insert = eol + text
      }
    } else if (lines.length === 0) {
      // delete whole lines, including one line break
      if (end < count) range = new monaco.Range(start, 1, end + 1, 1)
      else if (start > 1) range = new monaco.Range(start - 1, dst.getLineMaxColumn(start - 1), end, dst.getLineMaxColumn(end))
      else range = new monaco.Range(1, 1, end, dst.getLineMaxColumn(end))
      insert = ''
    } else {
      range = new monaco.Range(start, 1, end, dst.getLineMaxColumn(end))
      insert = text
    }

    const ed = this.editorFor(to)
    ed.pushUndoStop()
    ed.executeEdits(source, [{ range, text: insert, forceMoveMarkers: true }])
    ed.pushUndoStop()
  }

  private linesOf(side: Side, start: number, end: number): string[] {
    const m = this.sides[side].model
    const out: string[] = []
    for (let i = start; i <= end; i++) out.push(m.getLineContent(i))
    return out
  }

  /** Copy the current section from one side over the other (BC's "Copy to Right/Left"). */
  copySection(from: Side): boolean {
    const c = this.currentChange()
    if (!c) return false
    const to: Side = from === 'left' ? 'right' : 'left'
    const [s, e] = this.range(c, from)
    const [ds, de] = this.range(c, to)
    const lines = e === 0 ? [] : this.linesOf(from, s, e)
    if (de === 0) this.replaceLines(to, ds + 1, ds, lines, 'copy-section')
    else this.replaceLines(to, ds, de, lines, 'copy-section')
    return true
  }

  /** Whole lines covered by the selection on `side`, or null if nothing is selected. */
  selectedLines(side: Side): [number, number] | null {
    const sel = this.editorFor(side).getSelection()
    if (!sel || sel.isEmpty()) return null
    let end = sel.endLineNumber
    // a selection that ends at column 1 of the next line means "whole lines above"
    if (end > sel.startLineNumber && sel.endColumn === 1) end--
    return [sel.startLineNumber, end]
  }

  /** Copy the selected lines over the aligned lines on the other side. */
  copySelection(from: Side): boolean {
    const sel = this.selectedLines(from)
    if (!sel) return false
    const to: Side = from === 'left' ? 'right' : 'left'
    const [a, b] = sel
    const start = this.mapLine(from, a, 'start')
    const end = Math.max(this.mapLine(from, b, 'end'), start - 1)
    this.replaceLines(to, start, end, this.linesOf(from, a, b), 'copy-selection')
    return true
  }

  /** Selection on the focused side first, otherwise the section under the cursor. */
  copy(from: Side): boolean {
    const to: Side = from === 'left' ? 'right' : 'left'
    if (this.sides[to].path?.startsWith('history://')) return false
    const copied = (this.focused === from && this.copySelection(from)) || this.copySection(from)
    if (copied) this.recompareNow()
    return copied
  }

  /**
   * Monaco waits 200 ms after an edit before recomparing (good while typing,
   * laggy after a one-shot copy). Its diff computation also reruns at once when
   * the hideUnchangedRegions line counts change, and we don't use that feature
   * (LineFilter does the hiding), so flipping one of them forces an immediate
   * recompare with no other effect.
   */
  private recompareNow(): void {
    this.recompareKick = !this.recompareKick
    this.editor.updateOptions({ hideUnchangedRegions: { enabled: false, contextLineCount: this.recompareKick ? 4 : 3 } })
  }

  swap(): void {
    const { left, right } = this.sides
    this.sides.left = right
    this.sides.right = left
    this.applyModels()
    this.applyReadOnly()
    this.emit()
  }
}
