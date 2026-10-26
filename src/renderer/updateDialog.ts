import { UpdateController, type InstallGuard, type UpdaterApi, type UpdateState } from '../shared/updater'
import './updates.css'

/** Release notes are untrusted remote text and must never be rendered as HTML. */
export function mountUpdater(currentVersion: string, api: UpdaterApi, guard: InstallGuard): UpdateController {
  const button = document.getElementById('check-updates') as HTMLButtonElement
  const badge = document.getElementById('update-available') as HTMLButtonElement
  const dialog = document.createElement('dialog'); dialog.className = 'update-dialog'
  dialog.setAttribute('aria-label', 'Software update')
  const heading = document.createElement('h2'); heading.textContent = 'Software update'
  const versions = document.createElement('p')
  const notes = document.createElement('pre'); notes.className = 'update-notes'
  const notice = document.createElement('p'); notice.className = 'update-notice'
  notice.textContent = 'Updates use Windows Setup and may request administrator permission. If you are running a portable copy, this installs OCompare into Windows. Save your work before installation; OCompare will close and reopen.'
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite')
  const progress = document.createElement('progress'); progress.setAttribute('aria-label', 'Update download progress')
  const actions = document.createElement('div'); actions.className = 'update-actions'
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Later'
  const check = document.createElement('button'); check.type = 'button'; check.textContent = 'Check again'
  const install = document.createElement('button'); install.type = 'button'; install.className = 'update-primary'
  actions.append(close, check, install); dialog.append(heading, versions, notes, notice, message, progress, actions)
  document.body.append(dialog)
  const controller = new UpdateController(currentVersion, api, guard, render)

  function render(state: UpdateState): void {
    const busy = ['checking', 'downloading', 'preparing', 'installing'].includes(state.phase)
    versions.textContent = `Current version: ${currentVersion}${state.version ? ` · New version: ${state.version}` : ''}`
    notes.textContent = state.notes; notes.hidden = !state.notes
    message.textContent = state.message
    progress.hidden = state.phase !== 'downloading'
    if (state.total && state.total > 0) { progress.max = state.total; progress.value = state.downloaded }
    else progress.removeAttribute('value')
    badge.hidden = !state.version
    badge.textContent = state.version ? `Update ${state.version} available` : 'Update available'
    close.disabled = busy; check.disabled = busy; install.disabled = busy
    install.hidden = !state.canInstall && !['downloading', 'preparing', 'installing'].includes(state.phase)
    install.textContent = state.phase === 'ready' ? 'Install update' : state.phase === 'error' ? 'Retry update' : 'Download and install'
    button.disabled = busy
    if (state.visible && !dialog.open) { dialog.showModal(); close.focus() }
    if (!state.visible && dialog.open) dialog.close()
  }
  close.addEventListener('click', () => controller.hide())
  dialog.addEventListener('cancel', event => { event.preventDefault(); controller.hide() })
  check.addEventListener('click', () => { void controller.check(true) })
  install.addEventListener('click', () => { void controller.install() })
  button.addEventListener('click', () => { void controller.check(true) })
  badge.addEventListener('click', () => controller.show())
  render(controller.state)
  return controller
}
