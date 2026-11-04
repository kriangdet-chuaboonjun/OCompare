import { toolbarIcon } from './folderChrome'
import './settings.css'

/** Keep settings separate from comparison tabs and hand updates to the existing dialog. */
export function initializeSettings(version: string): void {
  const open = document.getElementById('settings-open') as HTMLButtonElement
  const close = document.getElementById('settings-close') as HTMLButtonElement
  const dialog = document.getElementById('settings-dialog') as HTMLDialogElement
  const updates = document.getElementById('check-updates') as HTMLButtonElement
  open.append(toolbarIcon('settings'))
  close.append(toolbarIcon('close'))
  document.getElementById('settings-version')!.textContent = `v${version}`
  open.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal()
  })
  close.addEventListener('click', () => dialog.close())
  // Close Settings before the updater's existing click handler opens Software update.
  updates.addEventListener('click', () => dialog.close())
}
