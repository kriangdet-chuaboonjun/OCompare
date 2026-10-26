import type {
  CopyPlan,
  FolderApi,
  FolderCompareOptions,
  FolderComparison,
  FolderEntry,
  FolderSession,
} from '../shared/folders'
import type { Side } from '../shared/types'
import { FolderView } from './folderView'
import { actionButton, commandMenu, showDialog } from './folderChrome'
import { addIgnoredFolders, normalizeIgnoredFolders } from './folderModel'
import type { SessionStorage } from './folderSessions'

/** Rules shared by every folder tab: only one copy runs, and never beside a comparison. */
export interface FolderGuard {
  compareBlocked(self: FolderController): string | null
  copyBlocked(self: FolderController): string | null
}

/** Coordinates native jobs; only the current request can replace visible results. */
export class FolderController {
  readonly view: FolderView
  roots: Record<Side, string> = { left: '', right: '' }
  result: FolderComparison | null = null
  rules: FolderCompareOptions = { ignoreWhitespace: true, ignoreEol: true, ignoredFolders: [] }
  private current: string | null = null
  private phase: 'scan' | 'plan' | 'copy' | null = null
  private off: Array<() => void> = []
  private ready: Promise<void>
  private unsubscribeSessions: () => void
  private disposed = false
  private actionsSuspended = false
  private pendingActions = new Set<Promise<unknown>>()
  private watchGeneration = 0
  private watchRoots = ''
  private watchRequest = 0
  private watchQueue: Promise<void> = Promise.resolve()
  private changeEpoch = 0
  private stale = false
  private watching = true
  onHistory: (path: string) => Promise<void> = async () => {}
  onRegexRules: () => Promise<void> = async () => {}

  constructor(
    host: HTMLElement,
    private service: FolderApi,
    readonly tabId: string,
    private sessions: SessionStorage,
    private guard: FolderGuard,
    private openPair: (entry: FolderEntry) => Promise<void>,
    private changed: () => void,
    private dirtyPaths: () => string[] = () => [],
  ) {
    this.view = new FolderView(host, {
      pick: (side) => this.safe(() => this.pick(side)),
      rootChanged: (side, value) => this.setRoot(side, value),
      command: (command) => this.safe(() => this.command(command)),
      open: (entry) =>
        this.safe(async () => {
          if (entry.status === 'error' || entry.status === 'skipped')
            throw new Error(entry.error ?? 'This item cannot be opened')
          await openPair(entry)
        }),
      viewChanged: () => {},
      ignoreFolders: (paths) => this.safe(() => this.ignoreFolders(paths)),
      manageIgnored: () => this.safe(() => this.rulesDialog()),
    })
    this.view.setWatching(true)
    this.ready = Promise.all([
      service.onProgress((p) => {
        if (p.requestId === this.current)
          this.view.message(`Scanning… ${p.visited.toLocaleString()} entries checked`)
      }),
      service.onCopyProgress((p) => {
        if (p.requestId === this.current)
          this.view.message(`Copying ${p.completed}/${p.total}: ${p.relativePath}`)
      }),
      service.onChanged?.((event) => {
        if (event.tabId !== this.tabId || event.generation !== this.watchGeneration || this.disposed) return
        this.markStale(event.error ? `Folder watcher: ${event.error} — press Refresh` : 'Folders changed — press Refresh')
      }) ?? Promise.resolve(() => {}),
    ]).then((list) => {
      if (this.disposed) list.forEach((off) => off())
      else this.off = list
    })
    void this.ready.catch((e) => this.error(e))
    this.unsubscribeSessions = sessions.onChange((store) => this.view.setHistory(store.history))
    void sessions.ready.then(() => {
      if (sessions.usable) this.view.setHistory(sessions.store.history)
      else this.error(sessions.loadError)
    })
  }
  private safe(work: () => Promise<unknown> | void): void {
    if (this.actionsSuspended) return
    try {
      const task = Promise.resolve(work()).catch((e) => this.error(e)).finally(() => this.pendingActions.delete(task))
      this.pendingActions.add(task)
    } catch (e) {
      this.error(e)
    }
  }
  private error(e: unknown): void {
    const text = typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e)
    this.view.message(text)
    this.view.log(`Error: ${text}`)
  }
  get busy(): boolean {
    return this.current !== null
  }
  /** Files are being written: the tab cannot be closed until the copy has stopped. */
  get copyRunning(): boolean {
    return this.phase === 'copy'
  }
  /** Planning or running a copy; other tabs may be viewed but cannot start jobs meanwhile. */
  get copying(): boolean {
    return this.phase === 'plan' || this.phase === 'copy'
  }
  /** Freeze new commands while pending native dialogs and writes drain before an update. */
  suspendActions(value: boolean): void { this.actionsSuspended = value }
  async settleActions(): Promise<void> {
    await Promise.all([...this.pendingActions])
  }
  private async command(command: string): Promise<void> {
    if (command === 'compare' || command === 'refresh') await this.compare()
    else if (command === 'cancel') this.cancel()
    else if (command === 'swap') {
      const { left, right } = this.roots
      this.setRoot('left', right)
      this.setRoot('right', left)
      await this.compare()
    } else if (command === 'home' || command === 'sessions') await this.openSessions()
    else if (command === 'rules') this.rulesDialog()
    else if (command === 'watch') {
      this.watching = !this.watching
      this.view.setWatching(this.watching)
      await this.configureWatch()
      this.view.message(this.watching ? 'Folder watching enabled — press Refresh' : 'Folder watching disabled')
    }
    else if (command === 'history') {
      const entry = this.view.selectedEntries()[0]
      const info = entry?.[this.view.activeSide] ?? entry?.left ?? entry?.right
      if (!info || info.kind !== 'file') throw new Error('Select a regular file to view History')
      await this.onHistory(info.path)
    }
    else if (command === 'copy')
      commandMenu('Copy direction', [
        ['Left → Right', () => this.safe(() => this.copy('left'))],
        ['Right → Left', () => this.safe(() => this.copy('right'))],
      ])
  }
  setRoot(side: Side, value: string): void {
    if (this.phase === 'copy') {
      this.view.message('Stop the current copy before changing roots')
      return
    }
    this.cancel(false)
    this.watchRoots = ''
    this.watchGeneration = 0
    this.watchRequest++
    this.watchQueue = this.watchQueue.catch(() => {}).then(async () => { await this.service.stopWatching?.(this.tabId) })
    this.stale = true
    this.roots[side] = value
    this.view.setRoots(this.roots.left, this.roots.right)
    this.view.setCopyAllowed(false)
    for (const button of document.querySelectorAll<HTMLButtonElement>('.folder-dialog button')) {
      if (button.textContent === 'Copy now') { button.disabled = true; button.title = 'Folders changed — cancel this preview and press Refresh' }
    }
    this.view.setSpace(side, null)
    this.view.message(
      this.result
        ? 'Folders changed — click Compare. Previous results are shown below.'
        : 'Choose two folders, then click Compare',
    )
    this.changed()
  }
  /** Stale results may be inspected but can never execute an old copy preview. */
  markStale(message = 'Folders changed — press Refresh'): void {
    this.changeEpoch++
    this.stale = true
    this.view.setCopyAllowed(false)
    for (const button of document.querySelectorAll<HTMLButtonElement>('.folder-dialog button')) {
      if (button.textContent === 'Copy now') { button.disabled = true; button.title = 'Folders changed — cancel this preview and press Refresh' }
    }
    this.view.log(message)
    if (this.phase !== 'copy' && this.phase !== 'scan') this.view.message(message)
  }
  private configureWatch(): Promise<void> {
    const key = this.watching ? JSON.stringify(this.roots) : ''
    if (key === this.watchRoots) return this.watchQueue
    this.watchRoots = key
    const request = ++this.watchRequest
    this.watchGeneration = 0
    this.watchQueue = this.watchQueue.catch(() => {}).then(async () => {
      if (request !== this.watchRequest || this.disposed) return
      await this.service.stopWatching?.(this.tabId)
      if (!key || !this.roots.left || !this.roots.right) return
      const generation = await this.service.watchFolders?.(this.tabId, this.roots.left, this.roots.right)
      if (request === this.watchRequest && !this.disposed) this.watchGeneration = generation ?? 0
    }).catch(e => { this.watchRoots = ''; this.markStale(`Folder watcher unavailable — press Refresh: ${String(e)}`) })
    return this.watchQueue
  }
  async pick(side: Side): Promise<void> {
    const path = await this.service.openDirectory()
    if (path !== null && !this.disposed) this.setRoot(side, path)
  }
  cancel(showMessage = true): void {
    const id = this.current
    if (id) {
      void this.service.cancel(id).catch((e) => this.error(e))
      if (this.phase === 'copy') {
        this.view.message('Stopping copy… completed files will be kept')
        return
      }
    }
    this.current = null
    this.phase = null
    this.view.setBusy(false)
    if (showMessage) {
      this.view.message('Canceled. Previous results are kept.')
      this.view.log('Canceled; previous results kept')
    }
  }
  async compare(): Promise<void> {
    if (this.actionsSuspended) return
    if (this.phase === 'copy') return
    const blocked = this.guard.compareBlocked(this)
    if (blocked) {
      this.view.message(blocked)
      return
    }
    const left = this.roots.left.trim(),
      right = this.roots.right.trim()
    if (!left || !right) {
      this.view.message('Choose both left and right folders first')
      return
    }
    const preserve = Boolean(
      this.result &&
        this.result.leftPath.toLowerCase() === left.toLowerCase() &&
        this.result.rightPath.toLowerCase() === right.toLowerCase(),
    )
    this.cancel(false)
    const id = crypto.randomUUID()
    this.current = id
    this.phase = 'scan'
    this.view.setBusy(true)
    this.view.setCopyAllowed(false)
    this.view.message('Scanning… Previous results are kept until this comparison finishes.')
    this.view.log(`Compare: ${left} ↔ ${right}`)
    const start = performance.now()
    try {
      await this.ready
      await this.configureWatch()
      if (this.current !== id || this.disposed) return
      const epoch = this.changeEpoch
      const result = await this.service.compare(left, right, id, this.rules)
      if (this.current !== id || this.disposed) return
      this.result = result
      this.view.setResult(result, preserve)
      this.stale = epoch !== this.changeEpoch
      this.view.setCopyAllowed(!this.stale)
      this.view.setElapsed(performance.now() - start)
      this.view.message(this.stale ? 'Folders changed during comparison — press Refresh' : 'Comparison complete')
      this.view.log(
        `Compared ${result.entries.length.toLocaleString()} items in ${((performance.now() - start) / 1000).toFixed(2)} s`,
      )
      this.changed()
      for (const side of ['left', 'right'] as const)
        void this.service
          .diskSpace(this.roots[side])
          .then((bytes) => {
            if (this.result === result && this.roots.left === left && this.roots.right === right)
              this.view.setSpace(side, bytes)
          })
          .catch((e) => {
            if (this.result === result) this.view.setSpace(side, null, String(e))
            this.view.log(`Disk space: ${e}`)
          })
      await this.sessions.ready
      if (this.sessions.usable)
        await this.sessions.update((store) => ({
          ...store,
          history: [...new Set([left, right, ...store.history])].slice(0, 50),
        }))
    } catch (e) {
      if (this.current === id) this.error(e)
    } finally {
      if (this.current === id) {
        this.current = null
        this.phase = null
        this.view.setBusy(false)
      }
    }
  }
  private rulesDialog(): void {
    const d = showDialog('Comparison rules'),
      options = { ...this.rules },
      ignored = [...(this.rules.ignoredFolders ?? [])]
    for (const [key, label] of [
      ['ignoreWhitespace', 'Ignore spaces and tabs within lines'],
      ['ignoreEol', 'Ignore LF / CRLF differences'],
    ] as const) {
      const field = document.createElement('label')
      field.className = 'folder-check'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = options[key]
      input.onchange = () => {
        options[key] = input.checked
      }
      field.append(input, label)
      d.body.append(field)
    }
    const help = document.createElement('p')
    help.textContent =
      'Identical always means equal bytes. Minor checks text up to 10 MiB per file. Case, blank lines and final newline remain significant.'
    d.body.append(help)
    d.body.append(actionButton('Regex rules…', () => { d.close(); this.safe(() => this.onRegexRules()) }))
    const section = document.createElement('section'),
      heading = document.createElement('h3'),
      list = document.createElement('ul')
    section.className = 'folder-ignored'
    heading.textContent = 'Ignored folders'
    list.setAttribute('aria-label', 'Ignored folders')
    const renderIgnored = () => {
      list.replaceChildren(
        ...ignored.map((path) => {
          const item = document.createElement('li'),
            name = document.createElement('span'),
            remove = actionButton('Remove', () => {
              ignored.splice(ignored.indexOf(path), 1)
              renderIgnored()
            })
          name.textContent = path
          remove.setAttribute('aria-label', `Remove ignored folder ${path}`)
          item.append(name, remove)
          return item
        }),
      )
      if (!ignored.length) {
        const none = document.createElement('li')
        none.className = 'folder-ignored-empty'
        none.textContent = 'None. Right-click a folder and choose Ignore folder.'
        list.append(none)
      }
      clear.disabled = !ignored.length
    }
    const clear = actionButton('Clear all', () => {
      ignored.length = 0
      renderIgnored()
    })
    renderIgnored()
    section.append(heading, list, clear)
    d.body.append(section)
    d.footer.append(
      actionButton('Cancel', d.close),
      actionButton('Apply', () => {
        const ignoreChanged = JSON.stringify(ignored) !== JSON.stringify(this.rules.ignoredFolders ?? [])
        this.rules = { ...options, ignoredFolders: ignored }
        d.close()
        if (ignoreChanged) {
          this.applyIgnored('Ignore list changed')
          return
        }
        this.markStale('Rules changed — press Refresh')
        this.view.setCopyAllowed(false)
        this.view.message('Rules changed — click Compare')
      }),
    )
  }
  private async ignoreFolders(paths: string[]): Promise<void> {
    if (this.busy) return
    const before = this.rules.ignoredFolders ?? [],
      next = addIgnoredFolders(before, paths)
    if (next.length === before.length && next.every((path, index) => path === before[index])) return
    this.rules = { ...this.rules, ignoredFolders: next }
    this.view.log(`Ignored: ${paths.join(', ')}`)
    this.applyIgnored(`Ignored ${paths.length === 1 ? paths[0] : `${paths.length} folders`}`)
  }
  /** Old copy previews must not run against a different scan; compare again right away. */
  private applyIgnored(message: string): void {
    this.markStale(message)
    this.view.setCopyAllowed(false)
    void this.compare()
  }
  private async openSessions(): Promise<void> {
    await this.sessions.ready
    if (!this.sessions.usable)
      throw new Error(
        'Sessions file cannot be read. Original preserved; resolve the reported error before saving.',
      )
    const d = showDialog('Folder sessions'),
      list = document.createElement('select'),
      name = document.createElement('input')
    list.size = 8
    list.setAttribute('aria-label', 'Saved sessions')
    name.setAttribute('aria-label', 'Session name')
    name.placeholder = 'Session name'
    const render = () => {
      list.replaceChildren(
        ...this.sessions.store.sessions.map((s) => {
          const o = document.createElement('option')
          o.value = s.id
          o.textContent = s.name
          return o
        }),
      )
    }
    render()
    list.onchange = () => {
      name.value = this.sessions.store.sessions.find((s) => s.id === list.value)?.name ?? ''
    }
    d.body.append(list, name)
    const operation = (work: () => Promise<void>) =>
      this.safe(async () => {
        const buttons = [...d.footer.querySelectorAll('button')]
        buttons.forEach((button) => (button.disabled = true))
        try {
          await work()
          render()
        } finally {
          buttons.forEach((button) => (button.disabled = false))
        }
      })
    d.footer.append(
      actionButton('Close', d.close),
      actionButton('Open', () => {
        const s = this.sessions.store.sessions.find((s) => s.id === list.value)
        if (!s) return
        this.setRoot('left', s.leftPath)
        this.setRoot('right', s.rightPath)
        this.rules = { ...s.rules, ignoredFolders: normalizeIgnoredFolders(s.rules.ignoredFolders) }
        this.view.setOptions(s.view)
        this.view.message(`Session: ${s.name} — click Compare`)
        d.close()
      }),
      actionButton('Save current', () =>
        operation(async () => {
          if (!name.value.trim() || !this.roots.left.trim() || !this.roots.right.trim())
            throw new Error('Enter a session name and both folder paths')
          const s: FolderSession = {
            id: crypto.randomUUID(),
            name: name.value.trim(),
            leftPath: this.roots.left,
            rightPath: this.roots.right,
            rules: { ...this.rules },
            view: structuredClone(this.view.options),
          }
          await this.sessions.update((store) => ({ ...store, sessions: [...store.sessions, s] }))
          this.view.log(`Session saved: ${s.name}`)
        }),
      ),
      actionButton('Rename', () =>
        operation(async () => {
          if (!list.value || !name.value.trim()) throw new Error('Select a session and enter its name')
          const id = list.value,
            title = name.value.trim()
          await this.sessions.update((store) => ({
            ...store,
            sessions: store.sessions.map((s) => (s.id === id ? { ...s, name: title } : s)),
          }))
        }),
      ),
      actionButton('Delete', () =>
        operation(async () => {
          if (!list.value) return
          const id = list.value
          await this.sessions.update((store) => ({ ...store, sessions: store.sessions.filter((s) => s.id !== id) }))
        }),
      ),
    )
  }
  private blocked(plan: CopyPlan): string[] {
    const key = (s: string) =>
      s
        .replaceAll('/', '\\')
          .replace(/^\\\\\?\\UNC\\/i, '\\\\')
        .replace(/^\\\\\?\\/, '')
        .toLowerCase()
    const dirty = new Set(this.dirtyPaths().map(key))
    return plan.items
      .filter((i) => i.action !== 'skip' && dirty.has(key(i.destination)))
      .map((i) => i.relativePath)
  }
  private async preview(plan: CopyPlan): Promise<boolean> {
    const d = showDialog('Review copy plan'),
      summary = document.createElement('p')
    summary.textContent = `${plan.items.filter((i) => i.action === 'create').length} create · ${plan.items.filter((i) => i.action === 'overwrite').length} overwrite · ${plan.items.filter((i) => i.action === 'skip').length} skipped · ${plan.bytes.toLocaleString()} bytes. Existing files are backed up before overwrite; use History to restore.`
    d.body.append(summary)
    const table = document.createElement('div')
    table.className = 'copy-preview'
    for (const item of plan.items) {
      const row = document.createElement('div')
      row.className = `copy-${item.action}`
      const title = document.createElement('strong')
      title.textContent = `${item.action.toUpperCase()}  ${item.relativePath}  ${item.size.toLocaleString()} B`
      const detail = document.createElement('div')
      detail.textContent = `${item.source} → ${item.destination}${item.reason ? ' — ' + item.reason : ''}`
      row.append(title, detail)
      table.append(row)
    }
    d.body.append(table)
    return new Promise((resolve) => {
      let settled = false
      const finish = (accepted: boolean) => {
        if (settled) return
        settled = true
        resolve(accepted)
        d.close()
      }
      d.dialog.addEventListener(
        'close',
        () => {
          if (!settled) {
            settled = true
            resolve(false)
          }
        },
        { once: true },
      )
      d.footer.append(
        actionButton('Cancel', () => finish(false)),
        actionButton('Copy now', () => finish(true)),
      )
    })
  }
  private async copy(direction: Side): Promise<void> {
    if (this.busy || !this.result) return
    const blocked = this.guard.copyBlocked(this)
    if (blocked) throw new Error(blocked)
    if (this.stale) throw new Error('Folders changed — press Refresh before copying')
    const paths = this.view.copyPaths()
    if (!paths.length) throw new Error('Select files or folders matching the current name filters first')
    const left = this.roots.left,
      right = this.roots.right,
      id = crypto.randomUUID()
    this.current = id
    this.phase = 'plan'
    this.view.setBusy(true)
    this.view.message('Preparing copy preview…')
    this.view.log('Preparing copy preview')
    let plan: CopyPlan | null = null
    try {
      await this.ready
      plan = await this.service.planCopy(left, right, direction, paths, id, this.rules.ignoredFolders ?? [])
      if (this.current !== id || this.disposed) {
        await this.service.discardCopy(plan.planId)
        return
      }
      const blocked = this.blocked(plan)
      if (blocked.length)
        throw new Error(
          `Unsaved destination edits: ${blocked.join(', ')}. Save or discard those edits before copying.`,
        )
      this.view.setBusy(false)
      if (!(await this.preview(plan))) {
        await this.service.discardCopy(plan.planId)
        this.view.log('Copy preview canceled; no files changed')
        this.view.message('Copy canceled; no files changed')
        return
      }
      if (this.stale || this.current !== id || this.roots.left !== left || this.roots.right !== right)
        throw new Error('Folders changed; compare again before copying')
      if (this.blocked(plan).length) throw new Error('Destination has unsaved edits; copy canceled')
      this.phase = 'copy'
      this.view.setBusy(true)
      const start = performance.now()
      const report = await this.service.executeCopy(plan.planId, id)
      this.view.setElapsed(performance.now() - start)
      for (const item of report.items)
        this.view.log(`${item.status}: ${item.relativePath}${item.message ? ' — ' + item.message : ''}`)
      const text = `Copy ${report.canceled ? 'stopped' : 'complete'}: ${report.items.filter((i) => i.status === 'copied').length} copied, ${report.items.filter((i) => i.status === 'skipped').length} skipped, ${report.items.filter((i) => i.status === 'failed').length} failed`
      this.view.log(text)
      this.view.message(this.stale ? `${text}. Folders changed — press Refresh` : text)
      this.current = null
      this.phase = null
      this.view.setBusy(false)
      await this.compare()
      this.view.message(this.stale ? `${text}. Folders changed — press Refresh` : text)
    } finally {
      if (plan) await this.service.discardCopy(plan.planId)
      if (this.current === id) {
        this.current = null
        this.phase = null
        this.view.setBusy(false)
      }
    }
  }
  dispose(): void {
    this.disposed = true
    this.cancel(false)
    this.off.splice(0).forEach((off) => off())
    this.watchRequest++
    this.unsubscribeSessions()
    void this.service.stopWatching?.(this.tabId).catch(() => {})
    this.view.dispose()
  }
}
