import type {
  EntryMetadata,
  FolderComparison,
  FolderEntry,
  FolderStatus,
  FolderViewOptions,
} from '../shared/folders'
import type { Side } from '../shared/types'
import { createFileIcon } from './fileIcon'
import { allStatuses, defaultViewOptions, matchesName, projectRows, type ProjectedRow } from './folderModel'
import { actionButton, commandMenu, showDialog, toolbarIcon } from './folderChrome'

const ROW_HEIGHT = 24
export const statusLabels: Record<FolderStatus, string> = {
  identical: 'Identical',
  minor: 'Minor',
  different: 'Different',
  'left-only': 'Left only',
  'right-only': 'Right only',
  error: 'Error',
  skipped: 'Skipped',
}
const symbols: Record<FolderStatus, string> = {
  identical: '=',
  minor: '≈',
  different: '≠',
  'left-only': '←',
  'right-only': '→',
  error: '!',
  skipped: '↗',
}
const commands = [
  ['all', 'All'],
  ['diffs', 'Diffs'],
  ['same', 'Same'],
  ['structure', 'Structure'],
  ['minor', 'Minor'],
  ['rules', 'Rules'],
  ['copy', 'Copy'],
  ['expand', 'Expand'],
  ['collapse', 'Collapse'],
  ['select', 'Select'],
  ['files', 'Files'],
  ['refresh', 'Refresh'],
  ['watch', 'Watch'],
  ['history', 'History'],
  ['swap', 'Swap'],
  ['cancel', 'Stop'],
  ['filters', 'Filters'],
  ['peek', 'Peek'],
  ['log', 'Log'],
] as const
const statusPresets: Record<string, FolderStatus[]> = {
  all: [...allStatuses],
  diffs: ['different', 'minor', 'left-only', 'right-only'],
  same: ['identical'],
}
export interface FolderActions {
  pick(side: Side): void
  rootChanged(side: Side, value: string): void
  command(command: string): void
  open(entry: FolderEntry): void
  viewChanged(): void
}

/** Both panes share one virtual projection and one selection model. */
export class FolderView {
  options = defaultViewOptions()
  activeSide: Side = 'left'
  private result: FolderComparison | null = null
  private rows: ProjectedRow[] = []
  private collapsed = new Set<string>()
  private selected = new Set<string>()
  private focused = ''
  private anchor = ''
  private scroll: HTMLElement
  private canvas: HTMLElement
  private empty: HTMLElement
  private frame = 0
  private observer: ResizeObserver
  private busy = false
  private copyAllowed = false
  private logLines: string[] = []
  private logFrame = 0
  private toolbar: HTMLElement

  constructor(
    private host: HTMLElement,
    private actions: FolderActions,
  ) {
    host.innerHTML = `<div class="folder-toolbar" role="toolbar" aria-label="Folder commands"></div>
      <div class="folder-paths">${(['left', 'right'] as const).map((side) => `<div class="folder-pathbar"><input data-root="${side}" aria-label="${side === 'left' ? 'Left' : 'Right'} folder" list="folder-history" spellcheck="false"><button data-pick="${side}" title="Choose ${side} folder" aria-label="Browse ${side} folder">…</button><button data-up="${side}" title="Parent directory" aria-label="Parent ${side} folder">↑</button></div>`).join('')}<datalist id="folder-history"></datalist></div>
      <div class="folder-filterbar"><label>Filters: <input data-include aria-label="Include patterns" value="*.*" spellcheck="false"></label><span class="folder-progress" role="status" aria-live="polite">Choose two folders to compare</span><button data-folder-cmd="compare">Compare</button></div>
      <div id="folder-comparison-grid" class="folder-scroll" role="treegrid" aria-label="Folder comparison" aria-colcount="7" aria-multiselectable="true" tabindex="0"><div class="folder-grid-header" role="row" aria-rowindex="1"></div><div class="folder-canvas"></div><div class="folder-empty">Choose two folders, then click Compare.</div></div>
      <div class="folder-log-wrap"><div class="folder-log-resizer" role="separator" aria-label="Resize log" aria-orientation="horizontal" aria-controls="folder-comparison-log" aria-valuemin="40" aria-valuemax="400" aria-valuenow="90" tabindex="0"></div><div id="folder-comparison-log" class="folder-log" role="log" aria-label="Comparison log"></div></div>
      <div class="folder-summary" aria-live="polite">No comparison yet</div><div class="folder-bottom"><span data-selection>0 selected</span><span data-space="left">Left free: —</span><span data-elapsed></span><span data-space="right">Right free: —</span></div>`
    const toolbar = host.querySelector('.folder-toolbar')!
    this.toolbar = toolbar as HTMLElement
    document.getElementById('folder-tools')!.append(toolbar)
    for (const [cmd, label] of commands) {
      const b = actionButton(label, () => this.dispatch(cmd))
      b.prepend(toolbarIcon(cmd))
      b.dataset.folderCmd = cmd
      b.title = label
      b.setAttribute('aria-label', label)
      if (['rules', 'expand', 'collapse', 'select', 'log', 'watch', 'history'].includes(cmd))
        b.classList.add('folder-secondary')
      toolbar.append(b)
    }
    const more = actionButton('More', () =>
      commandMenu(
        'More commands',
        commands
          .filter(([c]) => ['rules', 'expand', 'collapse', 'select', 'log', 'watch', 'history'].includes(c))
          .map(([c, l]) => [l, () => this.dispatch(c)]),
      ),
    )
    more.prepend(toolbarIcon('more'))
    more.className = 'folder-more'
    toolbar.append(more)
    this.scroll = host.querySelector('.folder-scroll')!
    this.canvas = host.querySelector('.folder-canvas')!
    this.empty = host.querySelector('.folder-empty')!
    host
      .querySelectorAll<HTMLButtonElement>('[data-pick]')
      .forEach((b) => (b.onclick = () => actions.pick(b.dataset.pick as Side)))
    host.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(
      (b) =>
        (b.onclick = () => {
          const side = b.dataset.up as Side,
            input = host.querySelector<HTMLInputElement>(`[data-root="${side}"]`)!
          const value = input.value.replace(/[\\/]+$/, '')
          const slash = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
          if (slash >= 0) actions.rootChanged(side, value.slice(0, slash + 1))
        }),
    )
    host.querySelectorAll<HTMLInputElement>('[data-root]').forEach((input) => {
      input.oninput = () => actions.rootChanged(input.dataset.root as Side, input.value)
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          actions.command('compare')
        }
      }
    })
    host.querySelector<HTMLButtonElement>('[data-folder-cmd="compare"]')!.onclick = () =>
      actions.command('compare')
    host.querySelector<HTMLInputElement>('[data-include]')!.onchange = (e) => {
      this.options.include = (e.target as HTMLInputElement).value
      this.updateRows(true)
    }
    this.scroll.onscroll = () => this.schedule()
    this.scroll.onkeydown = (e) => this.onKey(e)
    this.scroll.oncontextmenu = (e) => {
      e.preventDefault()
      commandMenu('Selected items', [
        ['Open files', () => this.dispatch('files')],
        ['Copy…', () => this.dispatch('copy')],
        ['Select…', () => this.dispatch('select')],
        ['Expand', () => this.dispatch('expand')],
        ['Collapse', () => this.dispatch('collapse')],
        ['Refresh', () => this.dispatch('refresh')],
      ])
    }
    this.observer = new ResizeObserver(() => { this.resizeAccessibility(); this.schedule() })
    this.observer.observe(this.scroll)
    const resize = host.querySelector<HTMLElement>('.folder-log-resizer')!
    this.drag(resize, (e) => {
      host.querySelector<HTMLElement>('.folder-log')!.style.height =
        `${Math.max(40, Math.min(400, host.getBoundingClientRect().bottom - e.clientY - 65))}px`
      this.resizeAccessibility()
    })
    resize.onkeydown = (e) => {
      if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        const log = host.querySelector<HTMLElement>('.folder-log')!
        log.style.height = `${Math.max(40, Math.min(400, log.offsetHeight + (e.key === 'ArrowUp' ? 16 : -16)))}px`
        this.resizeAccessibility()
        this.actions.viewChanged()
        e.preventDefault()
      }
    }
    this.headers()
    this.setBusy(false)
  }
  private drag(el: HTMLElement, move: (e: PointerEvent) => void): void {
    let pointer: number | null = null
    const finish = () => {
      const previous = pointer
      pointer = null
      el.onpointermove = null
      el.onpointerup = null
      window.removeEventListener('blur', finish)
      if (previous !== null) {
        if (el.hasPointerCapture(previous)) el.releasePointerCapture(previous)
        this.actions.viewChanged()
      }
    }
    el.onpointerdown = (e) => {
      if (pointer !== null || !e.isPrimary) return
      e.preventDefault()
      e.stopPropagation()
      pointer = e.pointerId
      el.setPointerCapture(e.pointerId)
      el.onpointermove = event => { if (event.pointerId === pointer) move(event) }
      el.onpointerup = event => { if (event.pointerId === pointer) finish() }
      window.addEventListener('blur', finish)
    }
    el.onpointercancel = finish
    el.onlostpointercapture = finish
  }
  private headers(): void {
    const header = this.host.querySelector<HTMLElement>('.folder-grid-header')!
    header.replaceChildren()
    for (const side of ['left', 'right'] as const) {
      if (side === 'right') {
        const divider = document.createElement('div')
        divider.className = 'folder-divider'
        divider.title = 'Drag to resize panes'
        divider.setAttribute('role', 'separator')
        divider.setAttribute('aria-label', 'Resize comparison panes')
        divider.setAttribute('aria-orientation', 'vertical')
        divider.setAttribute('aria-controls', 'folder-comparison-grid')
        divider.setAttribute('aria-valuemin', '25')
        divider.setAttribute('aria-valuemax', '75')
        divider.tabIndex = 0
        this.drag(divider, (e) => {
          const rect = this.scroll.getBoundingClientRect()
          this.options.split = Math.max(25, Math.min(75, ((e.clientX - rect.left) / rect.width) * 100))
          this.layout()
        })
        divider.onkeydown = (e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault()
            this.options.split = Math.max(
              25,
              Math.min(75, this.options.split + (e.key === 'ArrowLeft' ? -1 : 1)),
            )
            this.layout()
            this.actions.viewChanged()
          }
        }
        const statusHeader = document.createElement('div')
        statusHeader.className = 'folder-status'
        statusHeader.setAttribute('role', 'columnheader')
        statusHeader.setAttribute('aria-colindex', '4')
        statusHeader.setAttribute('aria-label', 'Comparison status')
        statusHeader.append(divider)
        header.append(statusHeader)
      }
      const cell = document.createElement('div')
      cell.className = 'folder-side'
      cell.setAttribute('role', 'presentation')
      for (const [i, key] of (['name', 'size', 'modified'] as const).entries()) {
        const col = document.createElement('div')
        col.className = 'folder-column'
        col.setAttribute('role', 'columnheader')
        col.setAttribute('aria-colindex', String((side === 'left' ? 1 : 5) + i))
        col.setAttribute('aria-sort', this.options.sort === key && this.options.sortSide === side
          ? this.options.descending ? 'descending' : 'ascending' : 'none')
        const b = actionButton(
          `${key === 'name' ? 'Name' : key === 'size' ? 'Size' : 'Modified'}${this.options.sort === key && this.options.sortSide === side ? (this.options.descending ? ' ▾' : ' ▴') : ''}`,
          () => {
            const hadFocus = document.activeElement === b
            this.options.descending =
              this.options.sort === key && this.options.sortSide === side ? !this.options.descending : false
            this.options.sort = key
            this.options.sortSide = side
            this.headers()
            this.updateRows()
            // Rebuilding the headers removes the button that initiated the sort.
            if (hadFocus)
              this.host.querySelector<HTMLButtonElement>(`button[aria-label="Sort ${side} ${key}"]`)?.focus()
            this.actions.viewChanged()
          },
        )
        b.setAttribute('aria-label', `Sort ${side} ${key}`)
        col.append(b)
        {
          const h = document.createElement('span')
          h.className = 'folder-column-resizer'
          h.title = `Resize ${side} ${key}`
          h.tabIndex = 0
          h.dataset.resizeSide = side
          h.dataset.resizeColumn = String(i)
          h.setAttribute('role', 'separator')
          h.setAttribute('aria-label', h.title)
          h.setAttribute('aria-orientation', 'vertical')
          h.setAttribute('aria-controls', 'folder-comparison-grid')
          let start = 0,
            size = 0,
            date = 0
          const offset = side === 'left' ? 0 : 2
          h.addEventListener('pointerdown', (e) => {
            if (!e.isPrimary) return
            start = e.clientX
            size = this.options.columns[offset]
            date = this.options.columns[offset + 1]
          })
          // Keyboard and pointer resize share the same clamping and paired-column contract.
          const resizeColumn = (delta: number, size: number, date: number) => {
            const clamp = (n: number) => Math.max(55, Math.min(320, n))
            if (i === 0) this.options.columns[offset] = clamp(size - delta)
            else if (i === 1) {
              const adjusted = Math.max(55 - size, date - 320, Math.min(320 - size, date - 55, delta))
              this.options.columns[offset] = clamp(size + adjusted)
              this.options.columns[offset + 1] = clamp(date - adjusted)
            } else this.options.columns[offset + 1] = clamp(date + delta)
            this.layout()
          }
          this.drag(h, (e) => resizeColumn(e.clientX - start, size, date))
          h.onkeydown = e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
            e.preventDefault()
            resizeColumn(e.key === 'ArrowRight' ? 8 : -8, this.options.columns[offset], this.options.columns[offset + 1])
            this.actions.viewChanged()
          }
          col.append(h)
        }
        cell.append(col)
      }
      header.append(cell)
    }
    this.layout()
  }
  private layout(): void {
    this.host.style.setProperty('--folder-left', `${this.options.split}%`)
    this.host.style.setProperty('--folder-right', `${100 - this.options.split}%`)
    this.options.columns.forEach((v, i) => this.host.style.setProperty(`--folder-col-${i}`, `${v}px`))
    this.host.style.setProperty(
      '--folder-min-left',
      `${Math.max(320, 70 + this.options.columns[0] + this.options.columns[1])}px`,
    )
    this.host.style.setProperty(
      '--folder-min-right',
      `${Math.max(320, 70 + this.options.columns[2] + this.options.columns[3])}px`,
    )
    this.resizeAccessibility()
    // Derive the selected preset from the actual filter, including restored/custom options.
    for (const [command, statuses] of Object.entries(statusPresets)) {
      const selected = statuses.length === this.options.statuses.length &&
        statuses.every(status => this.options.statuses.includes(status))
      this.toolbar.querySelector(`[data-folder-cmd="${command}"]`)
        ?.setAttribute('aria-pressed', String(selected))
    }
    for (const c of ['minor', 'peek', 'structure'])
      this.toolbar
        .querySelector(`[data-folder-cmd="${c}"]`)
        ?.setAttribute(
          'aria-pressed',
          String(
            c === 'minor'
              ? this.options.showMinor
              : c === 'peek'
                ? this.options.peek
                : this.options.structure === 'tree',
          ),
        )
  }
  /** Expose the current size after pointer, keyboard, restored settings, or layout changes. */
  private resizeAccessibility(): void {
    const divider = this.host.querySelector('.folder-divider')
    divider?.setAttribute('aria-valuenow', String(this.options.split))
    divider?.setAttribute('aria-valuetext', `${Math.round(this.options.split)}% left`)
    const log = this.host.querySelector<HTMLElement>('.folder-log')
    const logHeight = log ? parseFloat(log.style.height) || log.offsetHeight || 90 : 90
    this.host.querySelector('.folder-log-resizer')?.setAttribute('aria-valuenow', String(logHeight))
    this.host.querySelectorAll<HTMLElement>('.folder-column-resizer').forEach(handle => {
      const index = Number(handle.dataset.resizeColumn)
      const offset = handle.dataset.resizeSide === 'left' ? 0 : 2
      const column = handle.closest<HTMLElement>('.folder-column')!
      const value = index === 0 ? Math.round(column.getBoundingClientRect().width)
        : this.options.columns[offset + index - 1]
      const maximum = index === 0 ? Math.max(value, Math.round(column.parentElement!.getBoundingClientRect().width) - 110) : 320
      handle.setAttribute('aria-valuemin', String(index === 0 ? 70 : 55))
      handle.setAttribute('aria-valuemax', String(maximum))
      handle.setAttribute('aria-valuenow', String(Math.max(index === 0 ? 70 : 55, value)))
      handle.setAttribute('aria-valuetext', `${Math.max(index === 0 ? 70 : 55, value)} pixels`)
    })
  }
  private dispatch(cmd: string): void {
    if ((this.busy && !['cancel', 'log'].includes(cmd)) || (cmd === 'copy' && !this.copyAllowed)) return
    if (Object.hasOwn(statusPresets, cmd)) {
      this.options.statuses = [...statusPresets[cmd]]
      this.updateRows(true)
    } else if (cmd === 'structure') {
      this.options.structure = this.options.structure === 'tree' ? 'flat' : 'tree'
      this.updateRows(true)
    } else if (cmd === 'minor' || cmd === 'peek') {
      if (cmd === 'minor') this.options.showMinor = !this.options.showMinor
      else this.options.peek = !this.options.peek
      this.updateRows(true)
    } else if (cmd === 'filters') this.filters()
    else if (cmd === 'expand' || cmd === 'collapse')
      commandMenu(cmd === 'expand' ? 'Expand folders' : 'Collapse folders', [
        ['Selected folders', () => this.fold(cmd === 'collapse', false)],
        ['All folders', () => this.fold(cmd === 'collapse', true)],
      ])
    else if (cmd === 'select')
      commandMenu('Select items', [
        ['Select all visible', () => this.selectAll()],
        [
          'Clear selection',
          () => {
            this.selected.clear()
            this.draw()
          },
        ],
        [
          'Invert selection',
          () => {
            for (const { entry } of this.rows)
              this.selected.has(entry.relativePath)
                ? this.selected.delete(entry.relativePath)
                : this.selected.add(entry.relativePath)
            this.draw()
          },
        ],
        ...allStatuses.map(
          (s) =>
            [
              statusLabels[s],
              () => {
                this.selected = new Set(
                  this.rows.filter((r) => r.entry.status === s).map((r) => r.entry.relativePath),
                )
                this.draw()
              },
            ] as [string, () => void],
        ),
      ])
    else if (cmd === 'files') {
      const selected = this.selectedEntries()
      if (selected.length === 1) this.actions.open(selected[0])
    } else if (cmd === 'log') {
      const log = this.host.querySelector<HTMLElement>('.folder-log-wrap')!
      log.hidden = !log.hidden
    } else this.actions.command(cmd)
    this.layout()
  }
  private filters(): void {
    const d = showDialog('Filters'),
      include = document.createElement('input'),
      exclude = document.createElement('input')
    include.value = this.options.include
    exclude.value = this.options.exclude
    for (const [label, input] of [
      ['Include patterns', include],
      ['Exclude patterns', exclude],
    ] as const) {
      const field = document.createElement('label')
      field.textContent = label
      input.setAttribute('aria-label', label)
      field.append(input)
      d.body.append(field)
    }
    const help = document.createElement('p')
    help.textContent = 'Separate masks with ;  Include: *.cs;*.sql  Exclude: bin/**;obj/**;.git/**'
    d.body.append(help)
    const statuses = new Set(this.options.statuses)
    for (const status of allStatuses) {
      const label = document.createElement('label')
      label.className = 'folder-check'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = statuses.has(status)
      input.dataset.filter = status
      input.onchange = () => (input.checked ? statuses.add(status) : statuses.delete(status))
      label.append(input, statusLabels[status])
      d.body.append(label)
    }
    d.footer.append(
      actionButton('Cancel', d.close),
      actionButton('Apply', () => {
        this.options.include = include.value
        this.options.exclude = exclude.value
        this.options.statuses = [...statuses]
        this.host.querySelector<HTMLInputElement>('[data-include]')!.value = include.value
        this.updateRows(true)
        d.close()
      }),
    )
  }
  private fold(collapse: boolean, all: boolean): void {
    for (const e of this.result?.entries ?? [])
      if (e.kind === 'directory' && (all || this.selected.has(e.relativePath)))
        collapse ? this.collapsed.add(e.relativePath) : this.collapsed.delete(e.relativePath)
    this.updateRows()
  }
  private selectAll(): void {
    this.selected = new Set(this.rows.map((r) => r.entry.relativePath))
    this.draw()
  }
  selectedEntries(): FolderEntry[] {
    return (this.result?.entries ?? []).filter((e) => this.selected.has(e.relativePath))
  }
  copyPaths(): string[] {
    const selected = new Set(this.selectedEntries().map((e) => e.relativePath))
    return (this.result?.entries ?? [])
      .filter((e) => {
        let path = e.relativePath,
          chosen = selected.has(path)
        while (!chosen && path.includes('/')) {
          path = path.slice(0, path.lastIndexOf('/'))
          chosen = selected.has(path)
        }
        return chosen && matchesName(e.relativePath, this.options.include, this.options.exclude)
      })
      .map((e) => e.relativePath)
  }
  setRoots(left: string, right: string): void {
    for (const [side, path] of [
      ['left', left],
      ['right', right],
    ])
      this.host.querySelector<HTMLInputElement>(`[data-root="${side}"]`)!.value = path
  }
  setHistory(paths: string[]): void {
    this.host.querySelector('datalist')!.replaceChildren(
      ...paths.map((p) => {
        const o = document.createElement('option')
        o.value = p
        return o
      }),
    )
  }
  setOptions(options: FolderViewOptions): void {
    this.options = structuredClone(options)
    this.host.querySelector<HTMLInputElement>('[data-include]')!.value = options.include
    this.headers()
    this.updateRows(true)
  }
  setCopyAllowed(allowed: boolean): void {
    this.copyAllowed = allowed
    this.buttons()
  }
  setWatching(watching: boolean): void {
    this.toolbar.querySelector('[data-folder-cmd="watch"]')?.setAttribute('aria-pressed', String(watching))
  }
  setBusy(busy: boolean): void {
    this.busy = busy
    this.host.querySelectorAll<HTMLInputElement>('[data-root]').forEach((input) => (input.disabled = busy))
    this.scroll.setAttribute('aria-busy', String(busy))
    this.buttons()
  }
  private buttons(): void {
    const buttons = [...this.host.querySelectorAll<HTMLButtonElement>('[data-folder-cmd]'), ...this.toolbar.querySelectorAll<HTMLButtonElement>('[data-folder-cmd]')]
    buttons.forEach((b) => {
      const c = b.dataset.folderCmd!
      b.disabled =
        c === 'cancel'
          ? !this.busy
          : c === 'copy'
            ? this.busy || !this.copyAllowed || !this.selected.size
            : c === 'files' || c === 'history'
              ? this.busy || this.selected.size !== 1
              : this.busy && c !== 'log'
      b.title = b.disabled
        ? c === 'copy'
          ? 'Compare current roots and select items before copying'
          : c === 'files'
            ? 'Select one file pair'
            : 'Unavailable while a job is running'
        : (b.getAttribute('aria-label') ?? c)
    })
  }
  message(text: string): void {
    this.host.querySelector('.folder-progress')!.textContent = text
  }
  log(text: string): void {
    this.logLines.push(`${new Date().toLocaleTimeString()}  ${text}`)
    if (this.logLines.length > 1000) this.logLines.shift()
    if (!this.logFrame)
      this.logFrame = requestAnimationFrame(() => {
        this.logFrame = 0
        const log = this.host.querySelector<HTMLElement>('.folder-log')!
        log.textContent = this.logLines.join('\n')
        log.scrollTop = log.scrollHeight
      })
  }
  setSpace(side: Side, bytes: number | null, error = ''): void {
    const el = this.host.querySelector<HTMLElement>(`[data-space="${side}"]`)!
    el.textContent = `${side === 'left' ? 'Left' : 'Right'} free: ${bytes === null ? '—' : (bytes / 1024 ** 3).toFixed(2) + ' GiB'}`
    el.title = error
  }
  setElapsed(ms: number): void {
    this.host.querySelector('[data-elapsed]')!.textContent = `${(ms / 1000).toFixed(2)} s`
  }
  setResult(result: FolderComparison, preserve = false): void {
    this.result = result
    if (!preserve) {
      this.collapsed.clear()
      this.scroll.scrollTop = 0
      this.selected.clear()
    } else {
      const paths = new Set(result.entries.map((e) => e.relativePath))
      this.selected = new Set([...this.selected].filter((p) => paths.has(p)))
    }
    const s = result.summary
    this.host.querySelector('.folder-summary')!.textContent =
      `${s.files.toLocaleString()} files · ${s.directories.toLocaleString()} folders | Identical ${s.identical} · Minor ${s.minor ?? 0} · Different ${s.different} · Left only ${s.leftOnly} · Right only ${s.rightOnly} · Errors ${s.errors} · Skipped ${s.skipped}`
    this.updateRows()
  }
  private updateRows(filterChanged = false): void {
    this.rows = projectRows(this.result?.entries ?? [], this.options, this.collapsed)
    if (filterChanged) {
      const visible = new Set(this.rows.map((r) => r.entry.relativePath))
      this.selected = new Set([...this.selected].filter((p) => visible.has(p)))
      this.actions.viewChanged()
    }
    if (!this.rows.some((r) => r.entry.relativePath === this.focused))
      this.focused = this.rows[0]?.entry.relativePath ?? ''
    this.canvas.style.height = `${this.rows.length * ROW_HEIGHT}px`
    this.scroll.setAttribute('aria-rowcount', String(this.rows.length + 1))
    this.empty.hidden = this.rows.length > 0
    this.empty.textContent = !this.result
      ? 'Choose two folders, then click Compare.'
      : !this.result.entries.length
        ? 'Both folders are empty.'
        : 'No items match the selected filters.'
    this.layout()
    this.draw()
  }
  private schedule(): void {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        this.draw()
      })
  }
  private draw(): void {
    const start = Math.max(0, Math.floor(this.scroll.scrollTop / ROW_HEIGHT) - 8),
      end = Math.min(
        this.rows.length,
        start + Math.ceil((this.scroll.clientHeight || 600) / ROW_HEIGHT) + 18,
      ),
      fragment = document.createDocumentFragment()
    for (let i = start; i < end; i++) {
      const { entry, hidden } = this.rows[i],
        row = document.createElement('div')
      row.className = `folder-row status-${entry.status}`
      row.classList.toggle('selected', this.selected.has(entry.relativePath))
      row.classList.toggle('peek-hidden', hidden)
      row.classList.toggle('focused', this.focused === entry.relativePath)
      row.dataset.path = entry.relativePath
      row.id = `folder-row-${i}`
      row.setAttribute('role', 'row')
      row.setAttribute('aria-rowindex', String(i + 2))
      row.setAttribute(
        'aria-level',
        String(this.options.structure === 'flat' ? 1 : entry.relativePath.split('/').length),
      )
      row.setAttribute('aria-selected', String(this.selected.has(entry.relativePath)))
      if (entry.kind === 'directory')
        row.setAttribute('aria-expanded', String(!this.collapsed.has(entry.relativePath)))
      row.style.top = `${i * ROW_HEIGHT}px`
      row.title = entry.error ?? entry.minorReason ?? entry.relativePath
      const status = document.createElement('div')
      status.className = 'folder-status'
      status.setAttribute('role', 'gridcell')
      status.setAttribute('aria-colindex', '4')
      status.textContent = symbols[entry.status]
      status.title = statusLabels[entry.status]
      status.setAttribute('aria-label', statusLabels[entry.status])
      row.append(this.sideCell(entry, entry.left, 'left'), status, this.sideCell(entry, entry.right, 'right'))
      row.onclick = (e) => {
        this.activeSide =
          ((e.target as HTMLElement).closest<HTMLElement>('[data-side]')?.dataset.side as Side) ??
          this.activeSide
        this.select(entry.relativePath, e.ctrlKey || e.metaKey, e.shiftKey)
        this.scroll.focus({ preventScroll: true })
      }
      row.ondblclick = () => this.activate(entry)
      row.oncontextmenu = () => {
        if (!this.selected.has(entry.relativePath)) this.select(entry.relativePath, false, false)
      }
      fragment.append(row)
    }
    this.canvas.replaceChildren(fragment)
    const index = this.rows.findIndex((r) => r.entry.relativePath === this.focused)
    if (index >= start && index < end)
      this.scroll.setAttribute('aria-activedescendant', `folder-row-${index}`)
    else this.scroll.removeAttribute('aria-activedescendant')
    let left = 0,
      right = 0
    for (const e of this.result?.entries ?? []) {
      let path = e.relativePath,
        chosen = this.selected.has(path)
      while (!chosen && path.includes('/')) {
        path = path.slice(0, path.lastIndexOf('/'))
        chosen = this.selected.has(path)
      }
      if (!chosen) continue
      if (e.left?.kind === 'file') left += e.left.size
      if (e.right?.kind === 'file') right += e.right.size
    }
    this.host.querySelector('[data-selection]')!.textContent =
      `${this.result?.entries.length ?? 0} total · ${this.rows.length} shown · ${this.selected.size} selected · Left ${left.toLocaleString()} B / Right ${right.toLocaleString()} B`
    this.buttons()
  }
  private sideCell(entry: FolderEntry, info: EntryMetadata | null, side: Side): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'folder-side'
    cell.dataset.side = side
    cell.setAttribute('role', 'presentation')
    const name = document.createElement('span')
    name.className = 'folder-name'
    const depth =
      this.options.structure === 'flat' ? 0 : Math.min(entry.relativePath.split('/').length - 1, 30)
    name.style.paddingLeft = `${depth * 16 + 4}px`
    name.style.setProperty('--tree-depth', String(depth))
    name.classList.toggle('has-parent', depth > 0)
    if (info) {
      if (info.kind === 'directory') {
        const button = actionButton('', () => {
          this.focused = entry.relativePath
          this.toggle(entry)
          this.scroll.focus({ preventScroll: true })
        })
        button.className = 'folder-expander'
        button.tabIndex = -1
        button.onclick = (e) => e.stopPropagation()
        button.ondblclick = (e) => e.stopPropagation()
        const collapsed = this.collapsed.has(entry.relativePath)
        button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${entry.relativePath}`)
        button.setAttribute('aria-expanded', String(!collapsed))
        const icon = toolbarIcon('sessions')
        icon
          .querySelector('path')!
          .setAttribute('d', collapsed ? 'M3 7V4h6l3 3h9v13H3V7Z' : 'M3 19V4h6l3 3h8v4M3 20l3-9h16l-3 9H3Z')
        button.append(icon)
        name.append(button)
      } else {
        const icon = document.createElement('span')
        icon.className = 'folder-file-icon'
        icon.append(createFileIcon(info.name, info.kind === 'symlink'))
        name.append(icon)
      }
      const label = document.createElement('span')
      label.textContent = this.options.structure === 'flat' ? entry.relativePath : info.name
      name.append(label)
      name.title = info.path
    }
    const size = document.createElement('span')
    size.className = 'folder-size'
    size.textContent = info ? `${info.sizePartial ? '≥ ' : ''}${info.size.toLocaleString()}` : ''
    size.title = info?.sizePartial ? 'Partial size: some descendants could not be read' : 'Bytes'
    const date = document.createElement('span')
    date.className = 'folder-date'
    date.textContent = info?.mtimeMs ? new Date(info.mtimeMs).toLocaleString('en-GB') : ''
    ;[name, size, date].forEach((value, index) => {
      value.setAttribute('role', 'gridcell')
      value.setAttribute('aria-colindex', String((side === 'left' ? 1 : 5) + index))
    })
    cell.append(name, size, date)
    return cell
  }
  private select(path: string, ctrl: boolean, shift: boolean): void {
    if (shift && this.anchor) {
      const a = this.rows.findIndex((r) => r.entry.relativePath === this.anchor),
        b = this.rows.findIndex((r) => r.entry.relativePath === path)
      if (!ctrl) this.selected.clear()
      for (let i = Math.max(0, Math.min(a, b)); i <= Math.max(a, b); i++)
        this.selected.add(this.rows[i].entry.relativePath)
    } else {
      if (!ctrl) this.selected.clear()
      if (ctrl && this.selected.has(path)) this.selected.delete(path)
      else this.selected.add(path)
      this.anchor = path
    }
    this.focused = path
    this.draw()
  }
  private toggle(entry: FolderEntry): void {
    this.collapsed.has(entry.relativePath)
      ? this.collapsed.delete(entry.relativePath)
      : this.collapsed.add(entry.relativePath)
    this.updateRows()
  }
  private activate(entry: FolderEntry): void {
    if (entry.kind === 'directory') this.toggle(entry)
    else this.actions.open(entry)
  }
  private onKey(e: KeyboardEvent): void {
    // Header buttons and separators handle their own keys, independently of row navigation.
    if (e.target instanceof Element && e.target.closest('.folder-grid-header')) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      this.selectAll()
      return
    }
    const index = this.rows.findIndex((r) => r.entry.relativePath === this.focused),
      entry = this.rows[index]?.entry
    if (!entry) return
    let next = index
    if (e.key === 'ArrowDown') next = Math.min(this.rows.length - 1, index + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = this.rows.length - 1
    else if (e.key === 'Enter') this.activate(entry)
    else if (e.key === 'ArrowRight' && entry.kind === 'directory' && this.collapsed.has(entry.relativePath))
      this.toggle(entry)
    else if (e.key === 'ArrowLeft') {
      if (entry.kind === 'directory' && !this.collapsed.has(entry.relativePath)) this.toggle(entry)
      else {
        const slash = entry.relativePath.lastIndexOf('/')
        if (slash >= 0)
          next = this.rows.findIndex((r) => r.entry.relativePath === entry.relativePath.slice(0, slash))
      }
    } else if (e.key === ' ') this.select(entry.relativePath, true, false)
    else return
    if (next >= 0 && (next !== index || ['Home', 'End'].includes(e.key)))
      this.select(this.rows[next].entry.relativePath, e.ctrlKey, e.shiftKey)
    const current = this.rows.findIndex((r) => r.entry.relativePath === this.focused)
    if (current * ROW_HEIGHT < this.scroll.scrollTop) this.scroll.scrollTop = current * ROW_HEIGHT
    else if ((current + 2) * ROW_HEIGHT > this.scroll.scrollTop + this.scroll.clientHeight)
      this.scroll.scrollTop = (current + 2) * ROW_HEIGHT - this.scroll.clientHeight
    e.preventDefault()
  }
  focus(): void {
    this.scroll.focus()
    this.resizeAccessibility()
    this.schedule()
  }
  dispose(): void {
    this.observer.disconnect()
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.logFrame)
  }
}
