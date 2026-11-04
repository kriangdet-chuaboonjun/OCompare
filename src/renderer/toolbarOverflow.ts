import { toolbarIcon } from './folderChrome'
import { showContextMenu, type MenuEntry } from './contextMenu'

/** Keep original command buttons/handlers; expose only the commands that cannot fit. */
export function initializeToolbarOverflow(bar: HTMLElement): () => void {
  const more = document.createElement('button')
  more.id = 'toolbar-more'
  more.type = 'button'
  more.title = 'More commands'
  more.setAttribute('aria-label', 'More commands')
  more.setAttribute('aria-haspopup', 'menu')
  more.setAttribute('aria-expanded', 'false')
  more.append(toolbarIcon('more'))
  bar.insertBefore(more, bar.querySelector('#settings-open'))
  let hidden: HTMLButtonElement[] = []
  let popup: HTMLElement | null = null
  let frame = 0
  let disposed = false
  const dismiss = () => {
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  const priority = (button: HTMLButtonElement): number => {
    const command = button.dataset.folderCmd ?? button.dataset.cmd ?? ''
    if (button.classList.contains('folder-secondary') || ['rules', 'structural', 'history', 'swap', 'reload', 'refresh', 'peek', 'files', 'cancel'].includes(command)) return 2
    if (['all', 'diffs', 'same', 'viewAll', 'viewDiffs', 'viewContext'].includes(command)) return 4
    return 3
  }
  const layout = () => {
    frame = 0
    dismiss()
    bar.querySelectorAll('.toolbar-overflow-hidden').forEach(el => el.classList.remove('toolbar-overflow-hidden'))
    more.classList.add('toolbar-overflow-hidden')
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('#file-tools button, .folder-toolbar button')]
      .filter(button => !button.closest('[hidden]'))
    const tools = bar.querySelector<HTMLElement>('#file-tools:not([hidden]), #folder-tools:not([hidden]) .folder-toolbar:not([hidden])')
    const fits = () => bar.scrollWidth <= bar.clientWidth && (!tools || tools.scrollWidth <= tools.clientWidth)
    hidden = []
    if (fits()) return
    more.classList.remove('toolbar-overflow-hidden')
    // Stable order retains the user's command order within each priority tier.
    for (const button of [...buttons].sort((a, b) => priority(a) - priority(b))) {
      button.classList.add('toolbar-overflow-hidden')
      hidden.push(button)
      if (fits()) break
    }
    hidden = buttons.filter(button => hidden.includes(button))
    if (hidden.includes(document.activeElement as HTMLButtonElement)) more.focus({ preventScroll: true })
  }
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(layout) }
  more.addEventListener('click', () => {
    if (popup) { dismiss(); return }
    const entries: MenuEntry[] = hidden.map(button => ({
      label: button.getAttribute('aria-label') || button.textContent?.trim() || button.title,
      icon: button.querySelector('svg') ?? undefined,
      disabled: button.disabled,
      checked: button.hasAttribute('aria-pressed') ? button.getAttribute('aria-pressed') === 'true' : undefined,
      action: () => {
        more.focus({ preventScroll: true })
        if (button.isConnected && !button.disabled) button.click()
      },
    }))
    const rect = more.getBoundingClientRect()
    more.setAttribute('aria-expanded', 'true')
    popup = showContextMenu(rect.left, rect.bottom, entries, 'More commands', () => {
      popup = null
      more.setAttribute('aria-expanded', 'false')
    })
  })
  const resize = new ResizeObserver(schedule)
  resize.observe(bar)
  const changes = new MutationObserver(schedule)
  changes.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'aria-pressed', 'aria-label', 'title'] })
  // Font metrics can change after the first render even when the bar width is constant.
  void document.fonts.ready.then(schedule)
  schedule()
  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    resize.disconnect()
    changes.disconnect()
    dismiss()
    more.remove()
    bar.querySelectorAll('.toolbar-overflow-hidden').forEach(el => el.classList.remove('toolbar-overflow-hidden'))
  }
}
