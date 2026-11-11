import * as monaco from 'monaco-editor'
import type { FileData, Side } from '../shared/types'
import type { DraftDocument, TabDraftStore } from '../shared/tabDrafts'
import type { DiffView, SideState } from './diffView'
import { documentDirty, type FileTabs } from './fileTabs'
import { isVirtualPath } from './structural'

const SIDES: Side[] = ['left', 'right']

/**
 * Files-tab recovery. Only text with unsaved edits is stored; clean sides keep just their path,
 * so a file open in several tabs is one document that every tab refers to.
 */
export function snapshotTabs(tabs: FileTabs, view: DiffView): TabDraftStore | null {
  const recoverable = tabs.tabs.filter(tab => SIDES.some(side => documentDirty(tab.sides[side])))
  if (!recoverable.length) return null
  const documents: DraftDocument[] = []
  const ids = new Map<SideState, string>()
  const reference = (doc: SideState): string => {
    const known = ids.get(doc)
    if (known) return known
    const id = `document-${documents.length + 1}`
    ids.set(doc, id)
    const base = { id, encoding: doc.encoding, bom: doc.bom, eol: doc.model.getEOL() === '\r\n' ? 'CRLF' as const : 'LF' as const, language: null, size: doc.size, mtimeMs: doc.mtimeMs }
    if (isVirtualPath(doc.path)) documents.push({ ...base, path: null, text: null, encoding: 'utf-8', bom: false, size: 0, mtimeMs: 0 }) // History/Structural views have no file to come back to
    else if (documentDirty(doc)) documents.push({ ...base, path: doc.path, text: doc.model.getValue(monaco.editor.EndOfLinePreference.LF), language: doc.model.getLanguageId() })
    else documents.push({ ...base, path: doc.path, text: null })
    return id
  }
  const entries = recoverable.map(tab => ({
    left: reference(tab.sides.left),
    right: reference(tab.sides.right),
    focused: tab === tabs.active ? view.focusedSide : tab.focused,
    options: { ...tab.options },
    regexRules: tab.regexRules.map(rule => ({ ...rule })),
  }))
  const active = recoverable.indexOf(tabs.active)
  return { version: 1, savedAtMs: Date.now(), active: active < 0 ? null : active, documents, tabs: entries }
}

/** A restored document whose file no longer matches the one its text was based on. */
export type DiskNotice = 'changed' | 'missing'
const notices = new WeakMap<SideState, { kind: DiskNotice; path: string | null; mtimeMs: number }>()
/** The notice stays valid only while the document is the one that was restored (not reloaded or saved since). */
export function diskNotice(doc: SideState): DiskNotice | null {
  const notice = notices.get(doc)
  return notice && notice.path === doc.path && notice.mtimeMs === doc.mtimeMs ? notice.kind : null
}
export function clearDiskNotice(doc: SideState): void { notices.delete(doc) }
export const noticeLabel = (doc: SideState): string => {
  const kind = diskNotice(doc)
  return kind === 'changed' ? ' · file changed on disk' : kind === 'missing' ? ' · file not found' : ''
}

export interface RestoreDeps {
  tabs: FileTabs
  view: DiffView
  readFile(path: string): Promise<FileData>
  /** Start watching a restored file; failures never stop the restore. */
  watch(doc: SideState): Promise<void>
}
export interface RestoreReport {
  tabs: number
  changed: string[]
  missing: string[]
  unreadable: string[]
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function restoreTabs(store: TabDraftStore, { tabs, view, readFile, watch }: RestoreDeps): Promise<RestoreReport> {
  const report: RestoreReport = { tabs: 0, changed: [], missing: [], unreadable: [] }
  if (!store.tabs.length) return report
  const docs = new Map<string, SideState>()
  const outcomes = new Map<string, { notice?: DiskNotice; unreadable?: string }>()
  await Promise.all(store.documents.map(async entry => {
    const existing = entry.path ? tabs.findDocument(entry.path) : undefined
    if (existing) { docs.set(entry.id, existing); return }
    const doc = view.createDocument()
    docs.set(entry.id, doc)
    const base = { path: entry.path ?? '', encoding: entry.encoding, bom: entry.bom, eol: entry.eol, size: entry.size, mtimeMs: entry.mtimeMs }
    if (entry.text !== null) {
      view.loadDocument(doc, { ...base, text: entry.text })
      if (entry.language) monaco.editor.setModelLanguage(doc.model, entry.language)
      // Never equal to a model version: the text stays "modified" until the user saves it.
      doc.savedVersion = -1
      if (!entry.path) return
      try {
        const file = await readFile(entry.path)
        outcomes.set(entry.id, file.size === entry.size && file.mtimeMs === entry.mtimeMs ? {} : { notice: 'changed' })
      } catch (error) { outcomes.set(entry.id, { notice: 'missing', unreadable: message(error) }) }
    } else if (entry.path) {
      try { view.loadDocument(doc, await readFile(entry.path)) }
      catch (error) { outcomes.set(entry.id, { unreadable: message(error) }) }
    }
  }))
  for (const entry of store.documents) {
    const outcome = outcomes.get(entry.id)
    const doc = docs.get(entry.id)!
    if (!outcome || !entry.path) continue
    if (outcome.notice) {
      notices.set(doc, { kind: outcome.notice, path: doc.path, mtimeMs: doc.mtimeMs })
      ;(outcome.notice === 'changed' ? report.changed : report.missing).push(entry.path)
    } else if (outcome.unreadable) report.unreadable.push(`${baseName(entry.path)} (${outcome.unreadable})`)
  }
  tabs.restore(store.tabs.map(tab => ({
    sides: { left: docs.get(tab.left)!, right: docs.get(tab.right)! },
    focused: tab.focused,
    options: tab.options,
    regexRules: tab.regexRules,
  })), store.active)
  report.tabs = store.tabs.length
  for (const doc of new Set(docs.values())) if (doc.path && !isVirtualPath(doc.path)) await watch(doc).catch(() => {})
  return report
}

export function describeRestore(report: RestoreReport): string {
  const parts = [`Restored ${report.tabs} tab${report.tabs === 1 ? '' : 's'} with unsaved changes`]
  if (report.changed.length) parts.push(`changed on disk since: ${report.changed.map(baseName).join(', ')}`)
  if (report.missing.length) parts.push(`file not found: ${report.missing.map(baseName).join(', ')}`)
  if (report.unreadable.length) parts.push(`could not reopen: ${report.unreadable.join(', ')}`)
  return parts.join(' — ')
}
