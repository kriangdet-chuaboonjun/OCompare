import type * as monaco from 'monaco-editor'
import type { FileData, Side, RegexRule } from '../shared/types'
import { DiffView, type SideState, type ViewMode } from './diffView'

export interface FileTab {
  id: string
  sides: Record<Side, SideState>
  options: { viewMode: ViewMode; ignoreWs: boolean; wrap: boolean }
  regexRules: RegexRule[]
  focused: Side
  viewState: monaco.editor.IDiffEditorViewState | null
}

/** Windows paths returned by the backend are absolute; normalize case/separators for model reuse. */
export function documentKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase('en-US')
}
export const documentDirty = (doc: SideState): boolean => doc.model.getAlternativeVersionId() !== doc.savedVersion
let sequence = 0

/** Owns tab references; each file has one live model across all comparisons. */
export class FileTabs {
  readonly tabs: FileTab[] = []
  active: FileTab
  private listeners: (() => void)[] = []
  onRelease: (document: SideState) => void = () => {}

  constructor(readonly view: DiffView) {
    this.active = this.make({ ...view.sides })
    this.tabs.push(this.active)
  }

  private make(sides: Record<Side, SideState>): FileTab {
    return { id: `tab-${++sequence}`, sides, options: { viewMode: 'all', ignoreWs: false, wrap: false }, regexRules: [], focused: 'right', viewState: null }
  }

  onChange(callback: () => void): void { this.listeners.push(callback) }
  changed(): void { this.listeners.forEach(callback => callback()) }
  documents(): SideState[] { return [...new Set(this.tabs.flatMap(tab => [tab.sides.left, tab.sides.right]))] }
  dirtyPaths(): string[] { return this.documents().filter(documentDirty).map(doc => doc.path).filter((path): path is string => Boolean(path)) }
  findDocument(path: string): SideState | undefined { return path ? this.documents().find(doc => doc.path && documentKey(doc.path) === documentKey(path)) : undefined }
  findPair(left: string | null, right: string | null): FileTab | undefined {
    return this.tabs.find(tab => documentKey(tab.sides.left.path ?? '') === documentKey(left ?? '') && documentKey(tab.sides.right.path ?? '') === documentKey(right ?? ''))
  }

  create(): FileTab {
    const tab = this.make({ left: this.view.createDocument(), right: this.view.createDocument() })
    this.tabs.push(tab)
    this.activate(tab.id)
    return tab
  }

  activate(id: string): void {
    const next = this.tabs.find(tab => tab.id === id)
    if (!next) return
    this.active.viewState = this.view.editor.saveViewState()
    this.active.focused = this.view.focusedSide
    this.active = next
    this.view.attach(next.sides, next.focused)
    this.view.setViewMode(next.options.viewMode)
    this.view.setIgnoreWhitespace(next.options.ignoreWs)
    this.view.setWordWrap(next.options.wrap)
    if (next.viewState) this.view.editor.restoreViewState(next.viewState)
    this.view.editorFor(next.focused).focus()
    this.changed()
  }

  replace(tab: FileTab, side: Side, file: FileData): SideState {
    let doc = this.findDocument(file.path)
    const old = tab.sides[side]
    if (!doc) { doc = this.view.createDocument(); this.view.loadDocument(doc, file) }
    tab.sides[side] = doc
    tab.viewState = null
    if (tab === this.active) this.view.attach(tab.sides, tab.focused)
    this.release(old)
    this.changed()
    return doc
  }

  swap(): void {
    const tab = this.active
    ;[tab.sides.left, tab.sides.right] = [tab.sides.right, tab.sides.left]
    this.view.attach(tab.sides, tab.focused)
    this.changed()
  }

  remove(id: string): void {
    const index = this.tabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    const [tab] = this.tabs.splice(index, 1)
    if (!this.tabs.length) this.tabs.push(this.make({ left: this.view.createDocument(), right: this.view.createDocument() }))
    if (this.active === tab) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id)
    this.release(tab.sides.left); this.release(tab.sides.right)
    this.changed()
  }

  private release(doc: SideState): void {
    if (this.documents().includes(doc) || doc.model.isDisposed()) return
    this.onRelease(doc)
    // Monaco 0.57 defers cancellation/disposal of its previous diff view model by one task.
    // Retire text models after that task so an in-flight worker sees the canceled token.
    setTimeout(() => { if (!this.documents().includes(doc) && !doc.model.isDisposed()) doc.model.dispose() }, 0)
  }
}
