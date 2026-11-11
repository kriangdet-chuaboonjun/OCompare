import './backupHistory.css'

export interface BackupEntry {
  id: string
  path: string
  createdAtMs: number
  size: number
  sha256: string
  reason: string
}

export interface BackupHistoryDependencies {
  list(path: string): Promise<BackupEntry[]>
  compare(path: string, id: string): Promise<void>
  restore(path: string, id: string): Promise<void>
  confirm(message: string): Promise<boolean>
  isDirty(path: string): boolean
  onRestored(path: string): Promise<void> | void
}

/** Show opaque history versions; backend resolves and verifies every snapshot ID. */
export async function openBackupHistory(path: string, dependencies: BackupHistoryDependencies): Promise<void> {
  if (document.querySelector('.backup-history[open]')) return
  const entries = await dependencies.list(path)
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
  const target = document.createElement('p')
  target.className = 'backup-history-path'
  target.textContent = path
  const note = document.createElement('p')
  note.textContent = 'Original bytes saved before Save, Copy or Restore. Up to 20 versions per file, 1 GB total.'
  const list = document.createElement('div')
  list.className = 'backup-history-list'
  const message = document.createElement('p')
  message.className = 'backup-history-message'
  message.setAttribute('role', 'alert')
  const footer = document.createElement('div')
  footer.className = 'folder-dialog-footer'
  const compare = document.createElement('button')
  compare.type = 'button'
  compare.textContent = 'Compare with current'
  const restore = document.createElement('button')
  restore.type = 'button'
  restore.textContent = 'Restore'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  footer.append(compare, restore, close)
  body.append(target, note, list, message)
  dialog.append(heading, body, footer)
  let selected: BackupEntry | undefined
  let busy = false

  const updateActions = () => {
    compare.disabled = busy || !selected
    restore.disabled = busy || !selected || dependencies.isDirty(path)
    restore.title = dependencies.isDirty(path) ? 'Save or discard unsaved changes in every tab before restoring this file.' : ''
    close.disabled = busy
    list.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = busy })
  }

  const render = (versions: BackupEntry[]) => {
    list.replaceChildren()
    selected = versions[0]
    if (versions.length === 0) {
      const empty = document.createElement('p')
      empty.textContent = 'No saved versions for this file yet.'
      list.append(empty)
    } else {
      const table = document.createElement('table')
      const head = table.createTHead().insertRow()
      for (const label of ['', 'Saved', 'Reason', 'Size']) {
        const cell = document.createElement('th')
        cell.scope = 'col'
        cell.textContent = label
        head.append(cell)
      }
      const tbody = table.createTBody()
      versions.forEach((version, index) => {
        const row = tbody.insertRow()
        const radio = document.createElement('input')
        radio.type = 'radio'
        radio.name = 'backup-version'
        radio.value = version.id
        radio.checked = index === 0
        radio.setAttribute('aria-label', `${new Date(version.createdAtMs).toLocaleString()}, ${version.reason}, ${version.size} bytes`)
        radio.addEventListener('change', () => { selected = version; updateActions() })
        row.insertCell().append(radio)
        row.insertCell().textContent = new Date(version.createdAtMs).toLocaleString()
        row.insertCell().textContent = version.reason
        row.insertCell().textContent = `${version.size.toLocaleString()} B`
        row.title = `SHA-256: ${version.sha256}`
        row.addEventListener('click', event => {
          if (busy || event.target === radio) return
          radio.checked = true
          selected = version
          radio.focus()
          updateActions()
        })
      })
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
    const version = selected
    if (!version) return
    void perform(async () => {
      await dependencies.compare(path, version.id)
      dialog.close()
    })
  })
  restore.addEventListener('click', () => {
    const version = selected
    if (!version) return
    void perform(async () => {
      // Recheck after selection and after native confirmation: another tab may have changed.
      if (dependencies.isDirty(path)) throw new Error('Save or discard unsaved changes in every tab before restoring this file.')
      if (!await dependencies.confirm(`Restore the version saved ${new Date(version.createdAtMs).toLocaleString()} to:\n${path}\n\nThe current file will be backed up first.`)) return
      if (dependencies.isDirty(path)) throw new Error('This file now has unsaved changes. Restore canceled.')
      await dependencies.restore(path, version.id)
      await dependencies.onRestored(path)
      render(await dependencies.list(path))
      message.textContent = 'Version restored. The previous file is available in History.'
    })
  })
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
  dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus() }, { once: true })
  render(entries)
  document.body.append(dialog)
  dialog.showModal()
  ;(list.querySelector<HTMLInputElement>('input') ?? close).focus()
}

