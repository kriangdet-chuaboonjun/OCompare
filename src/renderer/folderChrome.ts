/** Soft Rounded: a shared 24px family with open silhouettes and semantic accents. */
const paths: Record<string, string> = {
  close: 'M6 6l12 12M18 6 6 18',
  settings: 'M10 2h4l.6 2.5 2.1 1.2 2.5-.7 2 3.5-1.9 1.8v3.4l1.9 1.8-2 3.5-2.5-.7-2.1 1.2L14 22h-4l-.6-2.5-2.1-1.2-2.5.7-2-3.5 1.9-1.8v-3.4L2.8 8.5l2-3.5 2.5.7 2.1-1.2L10 2Z',
  check: 'M5 12l4 4L19 6',
  history: 'M4 8a8 8 0 1 1-.5 7M3 3v5h5M12 7v5l3 2',
  watch: 'M2 11s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6ZM14 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z',
  home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  sessions: 'M3 7h18v14H3V7Zm3 0V3h12v4',
  all: 'M5 6h14M5 12h14M5 18h14',
  diffs: 'M5 8h14M5 16h14M16 3 8 21',
  same: 'M5 8h14M5 16h14',
  structure: 'M10 3h4v4h-4V3ZM4 17h4v4H4v-4Zm12 0h4v4h-4v-4ZM12 7v5M6 17v-5h12v5',
  minor: 'M4 6h11M4 11h6M4 16h3',
  rules: 'M4 12h16M4 19h16M8 10v4m8 3v4',
  copy: 'M10 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM4 8a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h10a1 1 0 0 0 1-1',
  expand: 'M10 3h4v4h-4V3ZM3 17h4v4H3v-4Zm7 0h4v4h-4v-4Zm7 0h4v4h-4v-4ZM12 7v10M5 17v-5h14v5',
  collapse: 'M10 3h4v4h-4V3ZM3 17h4v4H3v-4Zm7 0h4v4h-4v-4Zm7 0h4v4h-4v-4ZM12 7v10M5 17v-5h14v5',
  select: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  files: 'M10 3h5l5 5v11a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM15 3v5h5M5 4H4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2',
  folders: 'M3 7V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  context: 'M4 5h16M4 19h16',
  wrap: 'M3 5h17M3 10h13a4 4 0 0 1 0 8H9m4-4-4 4 4 4M3 16h2',
  copyRight: 'M8 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M5 8h3m-3 8h3m8-8h3m-3 8h3',
  copyLeft: 'M8 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M5 8h3m-3 8h3m8-8h3m-3 8h3',
  next: 'M12 3v11m-4-4 4 4 4-4',
  previous: 'M12 14V3M8 7l4-4 4 4',
  refresh: 'M20 10a8 8 0 1 0-1 7M20 4v6h-6',
  swap: 'M3 7h17l-4-4M21 17H4l4 4',
  cancel: 'M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z',
  filters: 'M3 4h18l-7 8v8l-4-2v-6L3 4Z',
  peek: 'M10 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l4 4v3M14 3v4h4M8 7h3M8 11h4',
  log: 'M8 5h12M8 12h12M8 19h8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  ignore: 'M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v1M3 7h4l2 3h11a1 1 0 0 1 1 1l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM4 3l17 18',
  open: 'M3 10V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v1M3 10h18l-3 9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z',
  save: 'M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 3v5h8V3',
  parent: 'M3 7V6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
}


// The accent carries the action; silhouettes remain readable without color.
const accents: Record<string, string> = {
  settings: 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  watch: 'M21 19a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  minor: 'M19 4 10 20',
  rules: 'M12 2v5M9.6 3.3l4.8 2.4m-4.8 0 4.8-2.4M5 6h.01',
  context: 'M4 12h16',
  copyRight: 'M8 12h8m-4-4 4 4-4 4',
  copyLeft: 'M16 12H8m4-4-4 4 4 4',
  next: 'M6 20h12',
  previous: 'M6 20h12',
  select: 'M7 12l3 3 7-7',
  expand: 'M17 3l3 3 3-3',
  collapse: 'M17 6l3-3 3 3',
  cancel: 'M9 9h6v6H9V9Z',
  peek: 'M10 17s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4ZM17.5 17a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
  log: 'M3 5h.01M3 12h.01M3 19h.01',
  save: 'M12 11v7m-3-3 3 3 3-3',
  parent: 'M12 18v-7m-3 3 3-3 3 3',
}

/** Local vectors are reused by the toolbar and overflow commands. */
export function toolbarIcon(command: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.classList.add('toolbar-icon')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[command] ?? paths.files)
  svg.append(path)
  if (accents[command]) {
    const accent = document.createElementNS(svg.namespaceURI, 'path')
    accent.setAttribute('d', accents[command])
    accent.classList.add('icon-accent')
    if (['context', 'next', 'previous'].includes(command)) accent.setAttribute('stroke-width', '4')
    svg.append(accent)
  }
  return svg
}

/** Replace font glyphs with the same vectors used by folder commands, preserving labels and handlers. */
export function initializeToolbarIcons(): void {
  const commands: Record<string, string> = { rules: 'rules', structural: 'structure', history: 'history', viewAll: 'all', viewDiffs: 'diffs', viewContext: 'context', ignoreWs: 'minor', wrap: 'wrap', copyToRight: 'copyRight', copyToLeft: 'copyLeft', nextDiff: 'next', prevDiff: 'previous', swap: 'swap', reload: 'refresh' }
  document.querySelectorAll<HTMLButtonElement>('#file-tools button[data-cmd]').forEach(button => {
    const label = button.querySelector('span')!
    button.replaceChildren(toolbarIcon(commands[button.dataset.cmd!]), label)
    button.setAttribute('aria-label', label.textContent ?? '')
  })
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    const label = document.createElement('span'); label.textContent = button.textContent?.trim() ?? ''
    button.replaceChildren(toolbarIcon(button.dataset.mode!), label)
  })
  document.querySelectorAll<HTMLButtonElement>('.pathbar .open, .pathbar .save').forEach(button => {
    button.replaceChildren(toolbarIcon(button.classList.contains('save') ? 'save' : 'open'))
  })
}
export function showDialog(title: string) {
  const dialog = document.createElement('dialog')
  dialog.className = 'folder-dialog'
  const heading = document.createElement('h2')
  heading.textContent = title
  heading.id = `dialog-${crypto.randomUUID()}`
  dialog.setAttribute('aria-labelledby', heading.id)
  const body = document.createElement('div')
  body.className = 'folder-dialog-body'
  const footer = document.createElement('div')
  footer.className = 'folder-dialog-footer'
  dialog.append(heading, body, footer)
  document.body.append(dialog)
  const close = () => {
    dialog.close()
    dialog.remove()
  }
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
  dialog.showModal()
  return { dialog, body, footer, close }
}
export function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.textContent = label
  button.type = 'button'
  button.addEventListener('click', action)
  return button
}
export function commandMenu(title: string, items: Array<readonly [string, () => void]>): void {
  const d = showDialog(title)
  d.body.classList.add('folder-menu')
  for (const [label, action] of items)
    d.body.append(
      actionButton(label, () => {
        d.close()
        action()
      }),
    )
  d.footer.append(actionButton('Cancel', d.close))
}
