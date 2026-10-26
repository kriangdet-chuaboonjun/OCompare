import './monacoSetup'
import './tabs.css'
import { FileTabs, documentDirty, documentKey, type FileTab } from './fileTabs'
import { RegexDiffAdapter } from './regexDiff'
import { openComparisonRules } from './comparisonRules'
import { openBackupHistory } from './backupHistory'
import { unsavedChoice } from './unsavedDialog'
import { mountUpdater } from './updateDialog'
import { updaterApi } from './updateNative'
import { WorkspaceInstallGuard } from '../shared/installGuard'
import * as monaco from 'monaco-editor'
import type { FileData, Side } from '../shared/types'
import type { FolderEntry } from '../shared/folders'
import { api, folderApi, comparisonRulesApi, backupApi, confirm, getStartupComparison, initializePlatform, setTitle, toError, type DropEvent } from './platform'
import { FolderController } from './folderController'
import { DiffView, type ViewMode, type SideState } from './diffView'
import { allLanguages } from './language'
import { defineThemes, initializeTheme } from './theme'
import { installCopyArrow } from './copyArrow'
import { initializeToolbarIcons } from './folderChrome'
import logoUrl from '../../assets/O_compare_toolbar.png'

declare global {
  /** package.json version, injected by Vite */
  const __APP_VERSION__: string
}

const SIDES: Side[] = ['left', 'right']

const regexAdapter = new RegexDiffAdapter(comparisonRulesApi.normalizePair, message => { if (message) status(message) })
const view = new DiffView(document.getElementById('editor')!, regexAdapter.overrideServices())
// Defining themes initializes Monaco services: install our diff factory first.
defineThemes()
initializeTheme()
export const tabs = new FileTabs(view)
installCopyArrow(view, document.getElementById('editor')!, (msg) => status(msg))
// Handle for scripted testing over DevTools (dev builds only)
if (import.meta.env.DEV) Object.assign(window, { __ocompare: view })

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const head = (side: Side) => $<HTMLElement>(`.side-head[data-side="${side}"]`)
const status = (msg: string) => ($<HTMLElement>('#st-msg').textContent = msg)
let mode: 'files' | 'folders' = 'files'
let installationLocked = false
const pendingActions = new Set<Promise<unknown>>()
const folders = new FolderController(document.getElementById('folder-panel')!, folderApi, openFolderEntry, () => {
  renderHeaders()
  renderStatus()
}, () => getAllDirtyPaths())
folders.onHistory = showHistory
folders.onRegexRules = async () => {
  const rules = await openComparisonRules({ rules: folders.rules.regexRules ?? [], ...comparisonRulesApi })
  if (rules) { folders.rules = { ...folders.rules, regexRules: rules }; folders.markStale('Rules changed — press Refresh') }
}
/** ป้องกัน unhandled rejection จาก native dialogs, events และ commands */
const run = (action: () => void | Promise<unknown>): void => {
  if (installationLocked) return
  try {
    const task = Promise.resolve(action()).catch((error) => status(toError(error).message)).finally(() => pendingActions.delete(task))
    pendingActions.add(task)
  }
  catch (error) { status(toError(error).message) }
}

// ---------- toolbar state ----------
const tabStrip = document.createElement('div')
tabStrip.id = 'file-tabs'
tabStrip.setAttribute('role', 'tablist')
tabStrip.setAttribute('aria-label', 'File comparisons')
document.getElementById('panes-head')!.before(tabStrip)
let tabSignature = ''
function renderTabs(): void {
  const signature = JSON.stringify(tabs.tabs.map(tab => [tab.id, tab === tabs.active, ...SIDES.map(side => [tab.sides[side].path, documentDirty(tab.sides[side])])]))
  if (signature === tabSignature) return
  tabSignature = signature; tabStrip.replaceChildren()
  for (const tab of tabs.tabs) {
    const item = document.createElement('div'); item.className = `file-tab${tab === tabs.active ? ' active' : ''}`
    const label = document.createElement('button'); label.className = 'file-tab-label'; label.type = 'button'; label.setAttribute('role', 'tab'); label.setAttribute('aria-selected', String(tab === tabs.active)); label.tabIndex = tab === tabs.active ? 0 : -1
    label.id = `file-${tab.id}`
    label.setAttribute('aria-controls', 'editor')
    label.addEventListener('keydown', event => {
      const index = tabs.tabs.indexOf(tab)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.tabs.length - 1
        : event.key === 'ArrowLeft' ? (index + tabs.tabs.length - 1) % tabs.tabs.length
          : event.key === 'ArrowRight' ? (index + 1) % tabs.tabs.length : -1
      if (next < 0) return
      event.preventDefault()
      // Activation redraws tabs and focuses Monaco; arrow navigation stays on the tab.
      const target = tabs.tabs[next]
      tabs.activate(target.id)
      document.getElementById(`file-${target.id}`)?.focus()
    })
    if (tab === tabs.active) {
      const panel = document.getElementById('editor')!
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', label.id)
    }
    const names = SIDES.map(side => {
      const path = tab.sides[side].path
      return `${path?.split(/[\\/]/).pop() || 'Untitled'}${path?.startsWith('history://') ? ' [History]' : ''}`
    })
    label.textContent = `${SIDES.some(side => documentDirty(tab.sides[side])) ? '● ' : ''}${names.join(' ↔ ')}`
    label.title = SIDES.map(side => tab.sides[side].path || 'Untitled').join(' ↔ ')
    label.addEventListener('click', () => tabs.activate(tab.id))
    const close = document.createElement('button'); close.type = 'button'; close.className = 'file-tab-close'; close.textContent = '×'; close.title = 'Close comparison (Ctrl+W)'; close.setAttribute('aria-label', `Close ${names.join(' and ')}`); close.addEventListener('click', () => run(() => closeTab(tab)))
    item.append(label, close); tabStrip.append(item)
  }
  const add = document.createElement('button'); add.id = 'tab-add'; add.type = 'button'; add.textContent = '+'; add.title = 'New comparison (Ctrl+T)'; add.setAttribute('aria-label', 'New comparison'); add.addEventListener('click', () => tabs.create()); tabStrip.append(add)
}
let regexSignature = ''
tabs.onChange(() => {
  const signature = JSON.stringify([tabs.active.id, tabs.active.regexRules])
  if (signature !== regexSignature) { regexSignature = signature; regexAdapter.setRules(tabs.active.regexRules) }
  refreshToggles(); renderTabs(); renderHeaders(); renderStatus(); window.dispatchEvent(new Event('tabs:changed'))
})
tabs.onRelease = doc => { run(() => api.watchFile(doc.id, null)) }
export const getAllDirtyPaths = (): string[] => tabs.dirtyPaths()
export const getSelectedHistoryPath = (): string | null => view.sides[view.focusedSide].path
export const getActiveTab = (): FileTab => tabs.active

function refreshToggles(): void {
  const { viewMode, ignoreWs, wrap } = tabs.active.options
  const active: Record<string, boolean> = {
    viewAll: viewMode === 'all',
    viewDiffs: viewMode === 'diffs',
    viewContext: viewMode === 'context',
    ignoreWs,
    wrap
  }
  document.querySelectorAll<HTMLButtonElement>('#toolbar button.toggle').forEach((b) => {
    b.classList.toggle('active', !!active[b.dataset.cmd!])
    b.setAttribute('aria-pressed', String(!!active[b.dataset.cmd!]))
  })
}

// ---------- header / status rendering ----------
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString('th-TH') : '')
const fmtSize = (n: number) => (n ? `${n.toLocaleString()} bytes` : '')

function renderHeaders(): void {
  for (const side of SIDES) {
    const s = view.sides[side]
    const h = head(side)
    const dirty = view.isDirty(side)
    const pathInput = $<HTMLInputElement>('.path', h)
    const snapshot = Boolean(s.path?.startsWith('history://'))
    pathInput.readOnly = snapshot
    if (document.activeElement !== pathInput) pathInput.value = snapshot ? `${s.path!.split('/').pop()} [History — read-only]` : s.path ?? ''
    $<HTMLElement>('.dirty', h).textContent = dirty ? '● modified' : ''
    $<HTMLElement>('.mtime', h).textContent = fmtDate(s.mtimeMs)
    $<HTMLElement>('.size', h).textContent = fmtSize(s.size)
    $<HTMLSelectElement>('.lang', h).value = s.model.getLanguageId()
    $<HTMLElement>('.enc', h).textContent = (s.encoding + (s.bom ? ' BOM' : '')).toUpperCase()
    $<HTMLElement>('.eol', h).textContent = view.eolOf(side) === 'CRLF' ? 'PC' : 'UNIX'
    $<HTMLButtonElement>('.save', h).disabled = !dirty || Boolean(s.path?.startsWith('history://'))
  }
  renderTabs()
  const anyDirty = tabs.documents().some(documentDirty)
  api.setDirty(anyDirty)
  const title = `OCompare v${__APP_VERSION__}`
  document.title = title
  run(() => setTitle(title))
}

function renderStatus(): void {
  if (mode === 'folders') {
    const summary = folders.result?.summary
    $<HTMLElement>('#st-diffs').textContent = summary ? `${summary.files} files · ${summary.directories} folders` : 'Folder Comparison'
    $<HTMLElement>('#st-pos').textContent = summary ? `${summary.errors} errors · ${summary.skipped} skipped` : ''
    return
  }
  const n = view.diffCount()
  const regex = tabs.active.regexRules.some(rule => rule.enabled)
  $<HTMLElement>('#st-diffs').textContent = (n === 0 ? regex ? 'No differences under rules' : 'Identical' : `${n} difference section(s)`) + (regex ? ' · Regex' : '')
  const pos = view.editorFor(view.focusedSide).getPosition()
  $<HTMLElement>('#st-pos').textContent = pos ? `${view.focusedSide === 'left' ? 'Left' : 'Right'}  ${pos.lineNumber}:${pos.column}` : ''
}

view.onChange(() => {
  renderHeaders()
  renderStatus()
})

// ---------- file operations ----------
const loadRequests = new WeakMap<SideState, number>()

function setMode(next: 'files' | 'folders'): void {
  mode = next
  status('')
  for (const id of ['file-tools', 'file-tabs', 'panes-head', 'editor']) document.getElementById(id)!.hidden = next !== 'files'
  document.getElementById('folder-panel')!.hidden = next !== 'folders'
    document.getElementById('folder-tools')!.hidden = next !== 'folders'
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === next)
    button.setAttribute('aria-pressed', String(button.dataset.mode === next))
  })
  renderHeaders()
  renderStatus()
  if (next === 'files') view.editor.layout()
  else folders.view.focus()
}

/** Folder comparisons open a separate tab without disturbing edited comparisons. */
async function openFolderEntry(entry: FolderEntry): Promise<void> {
  if ([entry.left, entry.right].some(info => info && info.kind !== 'file')) throw new Error('Select a pair of regular text files')
  const existing = tabs.findPair(entry.left?.path ?? null, entry.right?.path ?? null)
  if (existing) { tabs.activate(existing.id); setMode('files'); return }
  const files = await Promise.all(SIDES.map(async side => {
    const info = entry[side]
    const file: FileData = info ? await api.readFile(info.path) : { path: '', text: '', encoding: 'utf-8', bom: false, eol: 'LF', size: 0, mtimeMs: 0 }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(file.text)) throw new Error('Binary files can be compared in Folders, but cannot be opened as text')
    return file
  }))
  const duplicate = tabs.findPair(files[0].path, files[1].path)
  const tab = duplicate ?? tabs.create()
  if (!duplicate) tab.regexRules = structuredClone(folders.rules.regexRules ?? [])
  if (!duplicate) for (const [index, side] of SIDES.entries()) await watchDocument(tabs.replace(tab, side, files[index]))
  else tabs.activate(tab.id)
  setMode('files')
  status(`Opened ${entry.relativePath}`)
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
  if (folders.busy) { status('Use Stop and wait for the folder job before switching modes.'); return }
  setMode(button.dataset.mode as 'files' | 'folders')
}))
window.addEventListener('pagehide', () => folders.dispose(), { once: true })
async function watchDocument(doc: SideState): Promise<void> { if (!doc.path?.startsWith('history://')) await api.watchFile(doc.id, doc.path) }

/** Async reads are bound to the original tab and side; switching tabs is harmless. */
async function loadFile(side: Side, path: string, tab: FileTab = tabs.active, ask = true): Promise<void> {
  const state = tab.sides[side]
  if (ask && !await resolveUnsaved([state])) return
  const request = (loadRequests.get(state) ?? 0) + 1
  const version = state.model.getAlternativeVersionId()
  loadRequests.set(state, request)
  try {
    const file = await api.readFile(path)
    if (!tabs.tabs.includes(tab) || loadRequests.get(state) !== request || tab.sides[side] !== state) return
    if (state.model.getAlternativeVersionId() !== version) throw new Error('The document changed while reading. Please open the file again.')
    if (tabs.findDocument(file.path) === state) { view.loadDocument(state, file); await watchDocument(state) }
    else await watchDocument(tabs.replace(tab, side, file))
    status(`Opened ${file.path}`)
  } catch (error) { status(`Cannot open ${path}: ${toError(error).message}`) }
}

async function openFile(side: Side): Promise<void> {
  const tab = tabs.active
  const path = await api.openDialog()
  if (path && tabs.tabs.includes(tab)) await loadFile(side, path, tab)
}

/** Save the captured document, including while another tab becomes active. */
const pendingSaves = new Map<SideState, Promise<boolean>>()
const reservedSavePaths = new Map<string, SideState>()
async function saveDocument(doc: SideState): Promise<boolean> {
  const pending = pendingSaves.get(doc)
  if (pending) return pending
  const task = performSave(doc).finally(() => pendingSaves.delete(doc))
  pendingSaves.set(doc, task)
  return task
}
async function performSave(doc: SideState): Promise<boolean> {
  const originalPath = doc.path
  if (originalPath?.startsWith('history://')) { status('History snapshots are read-only'); return false }
  let path = originalPath
  if (!path) { path = await api.saveDialog(); if (!path) return false }
  if (doc.model.isDisposed()) return false
  const other = tabs.findDocument(path)
  if (other && other !== doc) { status('That file is already open. Save to a different path.'); return false }
  const key = documentKey(path)
  if (reservedSavePaths.has(key) && reservedSavePaths.get(key) !== doc) { status('That file is being saved by another document'); return false }
  reservedSavePaths.set(key, doc)
  const version = doc.model.getAlternativeVersionId()
  const text = doc.model.getValue(monaco.editor.EndOfLinePreference.TextDefined)
  try {
    const stat = await api.saveFile(path, text, doc.encoding, doc.bom)
    if (!doc.model.isDisposed() && doc.path === originalPath) {
      doc.path = path
      view.markDocumentSaved(doc, stat.size, stat.mtimeMs, version)
      await watchDocument(doc)
    }
    status(`Saved ${path}`)
    return !doc.model.isDisposed() && !documentDirty(doc)
  } catch (error) { status(`Save failed: ${toError(error).message}`); return false }
  finally { reservedSavePaths.delete(key) }
}
async function saveFile(side: Side): Promise<boolean> { return saveDocument(view.sides[side]) }

async function resolveUnsaved(documents: SideState[]): Promise<boolean> {
  for (const doc of new Set(documents)) {
    if (!documentDirty(doc)) continue
    const choice = await unsavedChoice(doc.path ?? 'Untitled')
    if (choice === 'cancel' || choice === 'save' && !await saveDocument(doc)) return false
  }
  return true
}
let closingTab = false
async function closeTab(tab: FileTab): Promise<void> {
  if (closingTab) return
  closingTab = true
  try {
    const lastRefs = SIDES.map(side => tab.sides[side]).filter(doc => !tabs.tabs.some(other => other !== tab && SIDES.some(side => other.sides[side] === doc)))
    if (await resolveUnsaved(lastRefs)) tabs.remove(tab.id)
  } finally { closingTab = false }
}

/** Reload matching shared models after an explicit restore, never overwrite edited text. */
export async function reloadPath(path: string): Promise<void> {
  if (path.startsWith('history://')) return
  const doc = tabs.findDocument(path)
  if (!doc || documentDirty(doc)) return
  const version = doc.model.getAlternativeVersionId()
  const request = (loadRequests.get(doc) ?? 0) + 1
  loadRequests.set(doc, request)
  const file = await api.readFile(path)
  if (loadRequests.get(doc) === request && !doc.model.isDisposed() && !documentDirty(doc) && doc.model.getAlternativeVersionId() === version) view.loadDocument(doc, file)
}
async function reload(): Promise<void> {
  const docs = [...new Set(SIDES.map(side => view.sides[side]))]
  for (const doc of docs) {
    if (!doc.path || doc.path.startsWith('history://') || !await resolveUnsaved([doc])) continue
    const version = doc.model.getAlternativeVersionId()
    const request = (loadRequests.get(doc) ?? 0) + 1
    loadRequests.set(doc, request)
    const file = await api.readFile(doc.path)
    if (loadRequests.get(doc) === request && !doc.model.isDisposed() && version === doc.model.getAlternativeVersionId()) view.loadDocument(doc, file)
  }
}

const deferredFileChanges = new Set<string>()
function fileChanged(documentId: string): void {
  if (installationLocked) { deferredFileChanges.add(documentId); return }
  run(async () => {
    const doc = tabs.documents().find(doc => doc.id === documentId)
    if (!doc?.path) return
    if (documentDirty(doc)) status(`${doc.path} changed on disk (you have unsaved edits; press Reload to discard them)`)
    else { await reloadPath(doc.path); status(`Reloaded ${doc.path} (changed on disk)`) }
  })
}
api.onFileChanged(fileChanged)

// ---------- commands ----------
const commands: Record<string, () => void | Promise<unknown>> = {
  viewAll: () => setView('all'),
  viewDiffs: () => setView('diffs'),
  viewContext: () => setView('context'),
  ignoreWs: () => {
    tabs.active.options.ignoreWs = !tabs.active.options.ignoreWs
    view.setIgnoreWhitespace(tabs.active.options.ignoreWs)
    refreshToggles()
  },
  wrap: () => {
    tabs.active.options.wrap = !tabs.active.options.wrap
    view.setWordWrap(tabs.active.options.wrap)
    refreshToggles()
  },
  copyToRight: () => copy('left'),
  copyToLeft: () => copy('right'),
  nextDiff: () => view.goToDiff('next'),
  prevDiff: () => view.goToDiff('previous'),
  swap: () => {
    tabs.swap()
  },
  reload: () => reload(),
  rules: async () => {
    const tab = tabs.active
    const rules = await openComparisonRules({ rules: tab.regexRules, ...comparisonRulesApi })
    if (rules && tabs.tabs.includes(tab)) { tab.regexRules = rules; tabs.changed() }
  },
  history: () => {
    const path = getSelectedHistoryPath()
    if (!path || path.startsWith('history://')) { status('Select a saved file to view History'); return }
    return showHistory(path)
  },
  save: () => saveFile(view.focusedSide)
}

async function showHistory(path: string): Promise<void> {
  await openBackupHistory(path, {
    list: backupApi.list,
    confirm,
    isDirty: target => getAllDirtyPaths().some(p => documentKey(p) === documentKey(target)),
    restore: async (target, id) => {
      if (tabs.documents().some(doc => doc.path && documentKey(doc.path) === documentKey(target) && documentDirty(doc))) throw new Error('Save or discard edits before restoring')
      await backupApi.restore(target, id)
    },
    compare: async (target, id) => {
      const [snapshot, current] = await Promise.all([backupApi.snapshot(target, id), api.readFile(target)])
      const tab = tabs.findPair(snapshot.path, current.path) ?? tabs.create()
      tabs.replace(tab, 'left', snapshot); tabs.replace(tab, 'right', current)
      tabs.activate(tab.id); await watchDocument(tab.sides.right); setMode('files')
    },
    onRestored: async target => { await reloadPath(target); folders.markStale('File restored — press Refresh'); status(`Restored ${target}`) },
  })
}

function setView(mode: ViewMode): void {
  tabs.active.options.viewMode = mode
  view.setViewMode(mode)
  refreshToggles()
}

function copy(from: Side): void {
  if (!view.copy(from)) status('Select text or put the cursor inside a difference section first')
}

document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach((b) => {
  b.addEventListener('click', () => run(() => commands[b.dataset.cmd!]?.()))
})

// Keybindings inside both editors (Monaco swallows keys, so register there too)
const K = monaco.KeyMod
const C = monaco.KeyCode
for (const side of SIDES) {
  const ed = view.editorFor(side)
  ed.addCommand(K.CtrlCmd | C.KeyT, () => tabs.create())
  ed.addCommand(K.CtrlCmd | C.KeyW, () => run(() => closeTab(tabs.active)))
  ed.addCommand(K.CtrlCmd | C.Tab, () => cycleTab(1))
  ed.addCommand(K.CtrlCmd | K.Shift | C.Tab, () => cycleTab(-1))
  ed.addCommand(K.CtrlCmd | C.KeyS, () => run(() => saveFile(side)))
  ed.addCommand(C.F7, commands.nextDiff)
  ed.addCommand(K.Shift | C.F7, commands.prevDiff)
  ed.addCommand(K.CtrlCmd | C.KeyN, commands.nextDiff)
  ed.addCommand(K.CtrlCmd | C.KeyP, commands.prevDiff)
  ed.addCommand(K.Alt | C.RightArrow, commands.copyToRight)
  ed.addCommand(K.Alt | C.LeftArrow, commands.copyToLeft)
  ed.addCommand(C.F5, () => run(commands.reload))
}
function cycleTab(direction: number): void { const index = tabs.tabs.indexOf(tabs.active); tabs.activate(tabs.tabs[(index + direction + tabs.tabs.length) % tabs.tabs.length].id) }
window.addEventListener('keydown', (e) => {
  if (installationLocked) return
  if (document.querySelector('dialog[open]')) return
  if (mode === 'files' && e.ctrlKey && !e.altKey && !document.querySelector('dialog[open]')) {
    if (e.key.toLowerCase() === 't') { e.preventDefault(); tabs.create(); return }
    if (e.key.toLowerCase() === 'w') { e.preventDefault(); run(() => closeTab(tabs.active)); return }
    if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return }
  }
  if (mode === 'folders') {
    if (e.key === 'F5') { e.preventDefault(); run(() => folders.compare()) }
    return
  }
  if ((e.target as HTMLElement).closest('.monaco-editor')) return
  if (e.ctrlKey && e.key.toLowerCase() === 's') run(commands.save)
  else if (e.key === 'F5') run(commands.reload)
  else if (e.key === 'F7') (e.shiftKey ? commands.prevDiff : commands.nextDiff)()
  else return
  e.preventDefault()
})

// ---------- path bars ----------
const languages = allLanguages()
for (const side of SIDES) {
  const h = head(side)
  $<HTMLButtonElement>('.open', h).addEventListener('click', () => run(() => openFile(side)))
  $<HTMLButtonElement>('.save', h).addEventListener('click', () => run(() => saveFile(side)))
  const input = $<HTMLInputElement>('.path', h)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) run(() => loadFile(side, input.value.trim()))
    if (e.key === 'Escape') {
      input.value = view.sides[side].path ?? ''
      input.blur()
    }
  })
  const select = $<HTMLSelectElement>('.lang', h)
  for (const l of languages) select.add(new Option(l.label, l.id))
  select.addEventListener('change', () => view.setLanguage(side, select.value))
}

// ---------- drag & drop ----------
function sideAt(x: number): Side {
  const r = document.getElementById('editor')!.getBoundingClientRect()
  return x < r.left + r.width / 2 ? 'left' : 'right'
}

/** ใช้ native file paths จาก Tauri แทน Electron webUtils */
function handleDrop(event: DropEvent): void {
  if (installationLocked) return
  if (mode === 'folders') return
  SIDES.forEach((side) => head(side).classList.toggle('drop-target',
    (event.type === 'enter' || event.type === 'over') && side === sideAt(event.x)))
  if (event.type !== 'drop') return
  if (event.paths.length >= 2) {
    const tab = tabs.active
    run(async () => {
      const docs = SIDES.map(side => tab.sides[side])
      if (!await resolveUnsaved(docs)) return
      const versions = docs.map(doc => doc.model.getAlternativeVersionId())
      const files = await Promise.all(event.paths.slice(0, 2).map(path => api.readFile(path)))
      if (!tabs.tabs.includes(tab) || SIDES.some((side, i) => tab.sides[side] !== docs[i] || docs[i].model.getAlternativeVersionId() !== versions[i])) return
      for (const [index, side] of SIDES.entries()) tabs.replace(tab, side, files[index])
      await Promise.all(SIDES.map(side => watchDocument(tab.sides[side])))
    })
  } else if (event.paths.length === 1) run(() => loadFile(sideAt(event.x), event.paths[0]))
}

// ---------- startup ----------
initializeToolbarIcons()
window.addEventListener('pagehide', () => regexAdapter.dispose(), { once: true })
$<HTMLImageElement>('#logo').src = logoUrl
refreshToggles()
renderHeaders()
renderStatus()
const updates = mountUpdater(__APP_VERSION__, updaterApi, new WorkspaceInstallGuard({
  busy: () => folders.busy,
  lock: locked => {
    installationLocked = locked
    folders.suspendActions(locked)
    view.suspendEditing(locked)
    for (const id of ['toolbar', 'file-tabs', 'panes-head', 'editor', 'folder-panel']) document.getElementById(id)!.inert = locked
    if (!locked) {
      const changed = [...deferredFileChanges]; deferredFileChanges.clear()
      changed.forEach(fileChanged)
      renderHeaders()
    }
  },
  settle: async () => {
    await Promise.all([...pendingActions, ...pendingSaves.values(), folders.settleActions()])
  },
  resolveUnsaved: () => resolveUnsaved(tabs.documents()),
}))
// Browser-only development/tests do not have native IPC and never contact the release service.
if ('__TAURI_INTERNALS__' in window) void updates.check(false)
run(async () => {
  await initializePlatform(handleDrop, status, async () => {
    if (installationLocked) return false
    if (!folders.busy) return resolveUnsaved(tabs.documents())
    status('A folder job is running. Use Stop and wait for completion before closing.')
    return false
  })
  const startup = await getStartupComparison()
  if (!startup) return
  if (startup.mode === 'folders') {
    folders.setRoot('left', startup.paths[0])
    folders.setRoot('right', startup.paths[1])
    setMode('folders')
    await folders.compare()
  } else {
    await Promise.all(SIDES.map((side, i) => startup.paths[i] ? loadFile(side, startup.paths[i]) : Promise.resolve()))
  }
})
