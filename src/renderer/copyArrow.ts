import * as monaco from 'monaco-editor'
import type { Side } from '../shared/types'
import type { DiffView } from './diffView'

/**
 * Floating arrow in the gap between the panes (like Beyond Compare):
 * select text on one side, or put the cursor in a difference, and click
 * the arrow to copy those lines to the other side. A bracket line runs from
 * the arrow down to the last line that will be copied.
 */
export function installCopyArrow(view: DiffView, host: HTMLElement, onCopied: (msg: string) => void): void {
  const btn = document.createElement('button')
  btn.className = 'copy-arrow'
  btn.hidden = true
  const bracket = document.createElement('div')
  bracket.className = 'copy-bracket'
  bracket.hidden = true
  host.append(bracket, btn)

  let from: Side = 'left'

  /** Lines (on `side`) that the arrow would copy; end < start means an empty block. */
  function target(): { side: Side; start: number; end: number; kind: 'selection' | 'section' } | null {
    const side = view.focusedSide
    const sel = view.selectedLines(side)
    if (sel) return { side, start: sel[0], end: sel[1], kind: 'selection' }
    const c = view.currentChange()
    if (!c) return null
    const [start, end] = view.changeLines(c, side)
    return { side, start, end, kind: 'section' }
  }

  function hide(): void {
    btn.hidden = true
    bracket.hidden = true
  }

  function update(): void {
    const t = target()
    if (!t) return hide()

    const ed = view.editorFor(t.side)
    const leftNode = view.editorFor('left').getDomNode()
    const rightNode = view.editorFor('right').getDomNode()
    const editorNode = ed.getDomNode()
    // Monaco emits layout/selection events while attaching or disposing a model pair.
    if (!leftNode || !rightNode || !editorNode || !host.isConnected || host.hidden) return hide()
    const hostRect = host.getBoundingClientRect()
    const leftRect = leftNode.getBoundingClientRect()
    const rightRect = rightNode.getBoundingClientRect()
    const edRect = editorNode.getBoundingClientRect()
    const lineHeight = ed.getOption(monaco.editor.EditorOption.lineHeight)

    const viewTop = edRect.top - hostRect.top
    const viewBottom = edRect.bottom - hostRect.top
    const toY = (line: number) => ed.getTopForLineNumber(line) - ed.getScrollTop() + viewTop
    const blockTop = toY(t.start)
    const blockBottom = t.end >= t.start ? toY(t.end) + lineHeight : blockTop

    // Nothing of the block on screen
    if (blockBottom < viewTop || blockTop > viewBottom) return hide()

    // Keep the arrow on screen while part of a long block is visible
    const arrowTop = Math.min(Math.max(blockTop, viewTop), viewBottom - lineHeight)

    from = t.side
    const gapCenter = Math.round((leftRect.right + rightRect.left) / 2 - hostRect.left)
    btn.textContent = from === 'left' ? '⇨' : '⇦'
    btn.title =
      (t.kind === 'selection' ? 'Copy selected lines' : 'Copy this difference') +
      (from === 'left' ? ' to the right (Alt+→)' : ' to the left (Alt+←)')
    btn.style.top = `${Math.round(arrowTop)}px`
    btn.style.left = `${gapCenter}px`
    btn.style.height = `${lineHeight}px`
    btn.hidden = false

    // Bracket: from under the arrow to the bottom of the last line (clipped to the view)
    const lineTop = arrowTop + lineHeight
    const lineBottom = Math.min(blockBottom, viewBottom)
    if (lineBottom - lineTop < 4) {
      bracket.hidden = true
      return
    }
    bracket.classList.toggle('from-left', from === 'left')
    bracket.classList.toggle('open-end', blockBottom > viewBottom)
    bracket.style.top = `${Math.round(lineTop)}px`
    bracket.style.height = `${Math.round(lineBottom - lineTop)}px`
    bracket.style.left = `${gapCenter}px`
    bracket.hidden = false
  }

  // Keep the editor's selection: don't let the button take focus
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  btn.addEventListener('click', () => {
    const kind = view.selectedLines(from) ? 'selected lines' : 'difference'
    if (view.copy(from)) onCopied(`Copied ${kind} to the ${from === 'left' ? 'right' : 'left'}`)
    view.editorFor(from).focus()
  })

  for (const side of ['left', 'right'] as Side[]) {
    const ed = view.editorFor(side)
    ed.onDidChangeCursorSelection(update)
    ed.onDidScrollChange(update)
    ed.onDidLayoutChange(update)
    ed.onDidFocusEditorText(update)
  }
  view.editor.onDidUpdateDiff(update)
  view.onChange(update)
}
