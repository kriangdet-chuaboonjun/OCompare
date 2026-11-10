import './backupHistory.css'
import type { CompareHistoryEntry } from '../shared/compareHistory'
import { describeResult } from './compareHistory'

export interface BackupEntry {
  id: string
  path: string
  createdAtMs: number
  size: number
  sha256: string
  reason: string
}

export interface HistoryDependencies {
  /** Saved versions of one file, newest first. */
  list(path: string): Promise<BackupEntry[]>
  /** Saved versions of every file, newest first. */
  listAll(): Promise<BackupEntry[]>
  /** Recorded comparisons (oldest first) and a way to follow new ones while the dialog is open. */
  runs(): readonly CompareHistoryEntry[]
  onRunsChange(listener: () => void): () => void
  /** Set when the comparison history could not be read. */
  runsError(): string | null
  compare(path: string, id: string): Promise<void>
  restore(path: string, id: string): Promise<void>
  confirm(message: string): Promise<boolean>
  isDirty(path: string): boolean
  onRestored(path: string): Promise<void> | void
  /** Reopen a recorded comparison (files, pasted text or folders). */
  openRun(entry: CompareHistoryEntry): Promise<void>
}

/** The backup catalog keeps Windows verbatim paths (\\?\C:\…); show and compare the ordinary form. */
export function plainPath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`
  return path.startsWith('\\\\?\\') ? path.slice(4) : path
}
const plain = (entries: BackupEntry[]): BackupEntry[] => entries.map(entry => ({ ...entry, path: plainPath(entry.path) }))

type Row =
  | { key: string; at: number; type: 'run'; run: CompareHistoryEntry }
  | { key: string; at: number; type: 'version'; version: BackupEntry }
type Filter = 'all' | 'runs' | 'versions'

const runType = (run: CompareHistoryEntry) => (run.kind === 'file' ? 'Compare · File' : 'Compare · Folder')

/**
 * One timeline of everything OCompare remembers: every completed comparison and every saved
 * version of a file (taken before Save, Copy or Restore). `path` limits the view to that file's
 * saved versions, as the old per-file History did; "Show all history" lifts the limit.
 */
export async function openHistory(path: string | null, dependencies: HistoryDependencies): Promise<void> {
  if (document.querySelector('.backup-history[open]')) return
  let scope = path
  let versions = plain(await (scope ? dependencies.list(scope) : dependencies.listAll()))
  if (document.querySelector('.backup-history[open]')) return
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const dialog = document.createElement('dialog')
  dialog.className = 'folder-dialog backup-history'
  const heading = document.createElement('h2')
  heading.id = 'backup-history-heading'
  heading.textContent = 'History'
  dialog.setAttribute('aria-labelledby', heading.id)
  const body = document.createElement('div')
  body.className = 'folder-dialog-body'
  const note = document.createElement('p')
  note.className = 'backup-history-note'
  const controls = document.createElement('div')
  controls.className = 'history-controls'
  const filterSelect = document.createElement('select')
  filterSelect.setAttribute('aria-label', 'Show')
  for (const [value, label] of [['all', 'All'], ['runs', 'Comparisons'], ['versions', 'Saved versions']] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    filterSelect.append(option)
  }
  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = 'Filter by path'
  search.setAttribute('aria-label', 'Filter by path')
  search.spellcheck = false
  const showAll = document.createElement('button')
  showAll.type = 'button'
  showAll.textContent = 'Show all history'
  controls.append(filterSelect, search, showAll)
  const list = document.createElement('div')
  list.className = 'backup-history-list'
  const message = document.createElement('p')
  message.className = 'backup-history-message'
  message.setAttribute('role', 'alert')
  const footer = document.createElement('div')
  footer.className = 'folder-dialog-footer'
  const button = (label: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    return b
  }
  const compare = button('Compare with current')
  const restore = button('Restore')
  const open = button('Open')
  const close = button('Close')
  footer.append(compare, restore, open, close)
  body.append(note, controls, list, message)
  dialog.append(heading, body, footer)
  let selected: Row | undefined
  let busy = false

  const filter = (): Filter => filterSelect.value as Filter
  const rows = (): Row[] => {
    const wanted = search.value.trim().toLowerCase()
    const result: Row[] = []
    if (!scope && filter() !== 'versions')
      for (const run of dependencies.runs()) result.push({ key: `run:${run.id}`, at: run.createdAtMs, type: 'run', run })
    if (filter() !== 'runs')
      for (const version of versions) result.push({ key: `version:${version.id}`, at: version.createdAtMs, type: 'version', version })
    return result
      .filter(row => !wanted || (row.type === 'run' ? `${row.run.leftPath} ${row.run.rightPath}` : row.version.path).toLowerCase().includes(wanted))
      .sort((a, b) => b.at - a.at)
  }

  const updateActions = () => {
    const version = selected?.type === 'version' ? selected.version : undefined
    compare.disabled = busy || !version
    restore.disabled = busy || !version || dependencies.isDirty(version.path)
    restore.title = version && dependencies.isDirty(version.path) ? 'Save or discard unsaved changes in every tab before restoring this file.' : ''
    open.disabled = busy || selected?.type !== 'run'
    close.disabled = busy
    filterSelect.disabled = busy || Boolean(scope)
    search.disabled = busy
    showAll.hidden = !scope
    showAll.disabled = busy
    list.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = busy })
  }

  const render = () => {
    const shown = rows()
    selected = shown.find(row => row.key === selected?.key) ?? shown[0]
    list.replaceChildren()
    note.textContent = scope
      ? `Saved versions of ${scope}. Original bytes saved before Save, Copy or Restore; up to 20 versions per file, 1 GB total.`
      : 'Every completed comparison and every saved version (original bytes saved before Save, Copy or Restore).'
    if (shown.length === 0) {
      const empty = document.createElement('p')
      empty.textContent = scope ? 'No saved versions for this file yet.' : 'Nothing recorded yet.'
      list.append(empty)
    } else {
      const table = document.createElement('table')
      const head = table.createTHead().insertRow()
      for (const label of ['', 'Date / time', 'Type', 'Left', 'Right', 'Result']) {
        const cell = document.createElement('th')
        cell.scope = 'col'
        cell.textContent = label
        head.append(cell)
      }
      const tbody = table.createTBody()
      for (const row of shown) {
        const tr = tbody.insertRow()
        tr.dataset.key = row.key
        tr.dataset.type = row.type
        const radio = document.createElement('input')
        radio.type = 'radio'
        radio.name = 'history-row'
        radio.value = row.key
        radio.checked = row === selected
        const when = new Date(row.at).toLocaleString()
        const cells = row.type === 'run'
          ? [runType(row.run), row.run.leftPath, row.run.rightPath, describeResult(row.run)]
          : ['Saved version', row.version.path, '', `${row.version.reason} · ${row.version.size.toLocaleString()} B`]
        radio.setAttribute('aria-label', `${when}, ${cells[0]}, ${cells[1]}${cells[2] ? ` and ${cells[2]}` : ''}, ${cells[3]}`)
        radio.addEventListener('change', () => { selected = row; updateActions() })
        tr.insertCell().append(radio)
        tr.insertCell().textContent = when
        cells.forEach((text, index) => {
          const cell = tr.insertCell()
          cell.textContent = text
          if (index === 1 || index === 2) { cell.title = text; cell.className = 'history-path' }
        })
        if (row.type === 'version') tr.title = `SHA-256: ${row.version.sha256}`
        else if (row.run.kind === 'folder') tr.title = `${row.run.result.files} files · ${row.run.result.directories} folders`
        tr.addEventListener('click', event => {
          if (busy || event.target === radio) return
          radio.checked = true
          selected = row
          radio.focus()
          updateActions()
        })
      }
      list.append(table)
    }
    updateActions()
  }

  const perform = async (action: () => Promise<void>) => {
    if (busy) return
    busy = true
    message.textContent = ''
    updateActions()
    try { await action() }
    catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error)
    } finally {
      busy = false
      updateActions()
    }
  }

  compare.addEventListener('click', () => {
    const row = selected
    if (row?.type !== 'version') return
    void perform(async () => {
      await dependencies.compare(row.version.path, row.version.id)
      dialog.close()
    })
  })
  restore.addEventListener('click', () => {
    const row = selected
    if (row?.type !== 'version') return
    const { version } = row
    void perform(async () => {
      // Recheck after selection and after native confirmation: another tab may have changed.
      if (dependencies.isDirty(version.path)) throw new Error('Save or discard unsaved changes in every tab before restoring this file.')
      if (!await dependencies.confirm(`Restore the version saved ${new Date(version.createdAtMs).toLocaleString()} to:\n${version.path}\n\nThe current file will be backed up first.`)) return
      if (dependencies.isDirty(version.path)) throw new Error('This file now has unsaved changes. Restore canceled.')
      await dependencies.restore(version.path, version.id)
      await dependencies.onRestored(version.path)
      versions = plain(await (scope ? dependencies.list(scope) : dependencies.listAll()))
      render()
      message.textContent = 'Version restored. The previous file is available in History.'
    })
  })
  open.addEventListener('click', () => {
    const row = selected
    if (row?.type !== 'run') return
    void perform(async () => {
      await dependencies.openRun(row.run)
      dialog.close()
    })
  })
  showAll.addEventListener('click', () => {
    void perform(async () => {
      versions = plain(await dependencies.listAll())
      scope = null
      render()
    })
  })
  filterSelect.addEventListener('change', render)
  search.addEventListener('input', render)
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
  const stopFollowing = dependencies.onRunsChange(render)
  dialog.addEventListener('close', () => { stopFollowing(); dialog.remove(); previousFocus?.focus() }, { once: true })
  const unreadable = dependencies.runsError()
  if (unreadable) message.textContent = `Compare history could not be read: ${unreadable}`
  render()
  document.body.append(dialog)
  dialog.showModal()
  ;(list.querySelector<HTMLInputElement>('input') ?? close).focus()
}
