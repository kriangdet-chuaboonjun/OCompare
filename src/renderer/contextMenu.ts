import { toolbarIcon } from './folderChrome'

export type MenuEntry =
  | { separator: true }
  | { label: string; icon?: string; disabled?: boolean; action: () => void }

const MARGIN = 4
let closeCurrent: ((restore: boolean) => void) | null = null

/** Windows-style popup at the pointer; closes on outside click, Escape, blur, resize or scroll. */
export function showContextMenu(x: number, y: number, entries: MenuEntry[], title = 'Context menu'): HTMLElement {
  closeCurrent?.(false)
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', title)
  menu.tabIndex = -1
  const items: HTMLButtonElement[] = []
  for (const entry of entries) {
    if ('separator' in entry) {
      const line = document.createElement('div')
      line.className = 'context-separator'
      line.setAttribute('role', 'separator')
      menu.append(line)
      continue
    }
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'context-item'
    item.tabIndex = -1
    item.setAttribute('role', 'menuitem')
    if (entry.disabled) item.setAttribute('aria-disabled', 'true')
    const icon = document.createElement('span')
    icon.className = 'context-icon'
    if (entry.icon) icon.append(toolbarIcon(entry.icon))
    const label = document.createElement('span')
    label.textContent = entry.label
    item.append(icon, label)
    item.addEventListener('click', () => {
      if (entry.disabled) return
      close(false)
      entry.action()
    })
    item.addEventListener('pointermove', () => { if (!entry.disabled) item.focus({ preventScroll: true }) })
    items.push(item)
    menu.append(item)
  }
  const enabled = () => items.filter((item) => item.getAttribute('aria-disabled') !== 'true')
  const move = (step: number, fromEdge?: 'first' | 'last') => {
    const list = enabled()
    if (!list.length) return
    const current = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = fromEdge === 'first' ? 0 : fromEdge === 'last' ? list.length - 1
      : current < 0 ? (step > 0 ? 0 : list.length - 1) : (current + step + list.length) % list.length
    list[next].focus({ preventScroll: true })
  }
  menu.addEventListener('keydown', (event) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => move(1, 'first'),
      End: () => move(-1, 'last'),
      Escape: () => close(true),
      Tab: () => close(true),
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (document.activeElement instanceof HTMLButtonElement && menu.contains(document.activeElement)) document.activeElement.click()
    } else if (keys[event.key]) keys[event.key]()
    else return
    event.preventDefault()
    event.stopPropagation()
  })
  menu.addEventListener('contextmenu', (event) => event.preventDefault())

  const outside = (event: Event) => { if (!menu.contains(event.target as Node)) close(false) }
  const dismiss = () => close(false)
  function close(restore: boolean): void {
    if (closeCurrent !== close) return
    closeCurrent = null
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('blur', dismiss)
    window.removeEventListener('resize', dismiss)
    document.removeEventListener('scroll', outside, true)
    menu.remove()
    // Escape returns to the grid; pointer dismissal keeps whatever the user clicked.
    if (restore && previous?.isConnected) previous.focus({ preventScroll: true })
  }
  closeCurrent = close
  menu.style.visibility = 'hidden'
  document.body.append(menu)

  // Flip to the other side of the pointer instead of overflowing, as Windows does.
  const available = { width: window.innerWidth, height: window.innerHeight }
  menu.style.maxHeight = `${available.height - MARGIN * 2}px`
  const { width, height } = menu.getBoundingClientRect()
  const left = x + width + MARGIN > available.width ? x - width : x
  const top = y + height + MARGIN > available.height ? y - height : y
  menu.style.left = `${Math.max(MARGIN, Math.min(left, available.width - width - MARGIN))}px`
  menu.style.top = `${Math.max(MARGIN, Math.min(top, available.height - height - MARGIN))}px`
  menu.style.visibility = ''
  menu.focus({ preventScroll: true })
  document.addEventListener('pointerdown', outside, true)
  window.addEventListener('blur', dismiss)
  window.addEventListener('resize', dismiss)
  document.addEventListener('scroll', outside, true)
  return menu
}
