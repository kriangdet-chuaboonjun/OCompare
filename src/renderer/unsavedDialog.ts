/** Three explicit choices; Escape and backdrop dismissal always cancel. */
export async function unsavedChoice(label: string): Promise<'save' | 'discard' | 'cancel'> {
  const dialog = document.createElement('dialog')
  dialog.className = 'unsaved-dialog'
  dialog.setAttribute('aria-label', 'Unsaved changes')
  const heading = document.createElement('h2'); heading.textContent = 'Unsaved changes'
  const message = document.createElement('p'); message.textContent = `Save changes to ${label}?`
  const actions = document.createElement('div'); actions.className = 'unsaved-actions'
  dialog.append(heading, message, actions)
  return new Promise(resolve => {
    let settled = false
    const finish = (choice: 'save' | 'discard' | 'cancel') => {
      if (settled) return
      settled = true; dialog.close(); dialog.remove(); resolve(choice)
    }
    for (const [choice, text] of [['cancel', 'Cancel'], ['discard', 'Discard'], ['save', 'Save']] as const) {
      const button = document.createElement('button'); button.textContent = text; button.type = 'button'
      button.addEventListener('click', () => finish(choice)); actions.append(button)
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel') })
    document.body.append(dialog); dialog.showModal(); (actions.lastElementChild as HTMLButtonElement).focus()
  })
}
