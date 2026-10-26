import type { FolderController, FolderGuard } from './folderController'
import type { SessionStorage } from './folderSessions'

export interface FolderTab {
  id: string
  controller: FolderController
  host: HTMLElement
}
export type FolderControllerFactory = (id: string, host: HTMLElement, guard: FolderGuard) => FolderController

let sequence = 0
const baseName = (path: string) => path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path.trim()

/** Tab label from the chosen folders; an untouched tab is "New folders". */
export function folderTabTitle(controller: FolderController): string {
  const { left, right } = controller.roots
  if (!left.trim() && !right.trim()) return 'New folders'
  return `${left.trim() ? baseName(left) : '…'} ↔ ${right.trim() ? baseName(right) : '…'}`
}

/**
 * Each tab owns a controller (pair, results, rules, ignores, log, watch) and its own hidden panel;
 * switching only changes visibility, so background comparisons keep running.
 */
export class FolderTabs implements FolderGuard {
  readonly tabs: FolderTab[] = []
  active!: FolderTab
  private listeners = new Set<() => void>()
  private strip = document.createElement('div')
  private signature = ''

  constructor(
    private panel: HTMLElement,
    private make: FolderControllerFactory,
    private sessions: SessionStorage,
    private status: (message: string) => void,
  ) {
    this.strip.id = 'folder-tabs'
    this.strip.setAttribute('role', 'tablist')
    this.strip.setAttribute('aria-label', 'Folder comparisons')
    panel.prepend(this.strip)
    this.create()
  }

  onChange(listener: () => void): void { this.listeners.add(listener) }
  changed(): void {
    this.render()
    this.listeners.forEach((listener) => listener())
  }

  get busy(): boolean { return this.tabs.some((tab) => tab.controller.busy) }
  get copying(): boolean { return this.tabs.some((tab) => tab.controller.copying) }

  compareBlocked(): string | null {
    return this.copying ? 'A copy is running — wait for it to finish before comparing' : null
  }
  copyBlocked(self: FolderController): string | null {
    return this.tabs.some((tab) => tab.controller !== self && tab.controller.busy)
      ? 'Another folder job is running — wait for it to finish before copying'
      : null
  }

  create(): FolderTab {
    const id = `folder-tab-${++sequence}`
    const host = document.createElement('div')
    host.className = 'folder-tab-panel'
    host.id = `${id}-panel`
    host.setAttribute('role', 'tabpanel')
    host.setAttribute('aria-labelledby', `${id}-label`)
    host.hidden = true
    this.panel.append(host)
    const tab: FolderTab = { id, host, controller: this.make(id, host, this) }
    this.tabs.push(tab)
    this.activate(id)
    return tab
  }

  activate(id: string): void {
    const next = this.tabs.find((tab) => tab.id === id)
    if (!next) return
    this.active = next
    for (const tab of this.tabs) tab.controller.view.setActive(tab === next)
    this.changed()
  }

  cycle(direction: number): void {
    const index = this.tabs.indexOf(this.active)
    this.activate(this.tabs[(index + direction + this.tabs.length) % this.tabs.length].id)
  }

  /** Closing cancels only this tab's job; a running copy must be stopped and finished first. */
  close(id: string): boolean {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return true
    const tab = this.tabs[index]
    if (tab.controller.copyRunning) {
      this.status('Stop the copy and wait for it to finish before closing this tab')
      return false
    }
    this.tabs.splice(index, 1)
    tab.controller.dispose()
    tab.host.remove()
    if (!this.tabs.length) this.create()
    else if (this.active === tab) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id)
    else this.changed()
    return true
  }

  markAllStale(message: string): void { this.tabs.forEach((tab) => tab.controller.markStale(message)) }
  suspendActions(value: boolean): void { this.tabs.forEach((tab) => tab.controller.suspendActions(value)) }
  async settleActions(): Promise<void> {
    await Promise.all([...this.tabs.map((tab) => tab.controller.settleActions()), this.sessions.settle()])
  }
  dispose(): void { this.tabs.forEach((tab) => tab.controller.dispose()) }

  private render(): void {
    const signature = JSON.stringify(this.tabs.map((tab) => [tab.id, tab === this.active, folderTabTitle(tab.controller)]))
    if (signature === this.signature) return
    this.signature = signature
    this.strip.replaceChildren()
    for (const tab of this.tabs) {
      const title = folderTabTitle(tab.controller),
        selected = tab === this.active,
        item = document.createElement('div'),
        label = document.createElement('button'),
        close = document.createElement('button')
      item.className = `file-tab${selected ? ' active' : ''}`
      label.type = 'button'
      label.className = 'file-tab-label'
      label.id = `${tab.id}-label`
      label.setAttribute('role', 'tab')
      label.setAttribute('aria-selected', String(selected))
      label.setAttribute('aria-controls', `${tab.id}-panel`)
      label.tabIndex = selected ? 0 : -1
      label.textContent = title
      label.title = [tab.controller.roots.left, tab.controller.roots.right].filter(Boolean).join(' ↔ ') || title
      label.addEventListener('click', () => this.activate(tab.id))
      label.addEventListener('keydown', (event) => {
        const index = this.tabs.indexOf(tab)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1
          : event.key === 'ArrowLeft' ? (index + this.tabs.length - 1) % this.tabs.length
            : event.key === 'ArrowRight' ? (index + 1) % this.tabs.length : -1
        if (next < 0) return
        event.preventDefault()
        const target = this.tabs[next]
        this.activate(target.id)
        document.getElementById(`${target.id}-label`)?.focus()
      })
      close.type = 'button'
      close.className = 'file-tab-close'
      close.textContent = '×'
      close.title = 'Close folder comparison (Ctrl+W)'
      close.setAttribute('aria-label', `Close ${title}`)
      close.addEventListener('click', () => this.close(tab.id))
      item.append(label, close)
      this.strip.append(item)
    }
    const add = document.createElement('button')
    add.id = 'folder-tab-add'
    add.type = 'button'
    add.textContent = '+'
    add.title = 'New folder comparison (Ctrl+T)'
    add.setAttribute('aria-label', 'New folder comparison')
    add.addEventListener('click', () => this.create())
    this.strip.append(add)
  }
}
