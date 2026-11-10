const paths: Record<string, string> = {
  close: 'M6 6l12 12M18 6 6 18',
  settings: 'M18.75 8.79Q18.93 9.13 19.04 9.50L19.22 10.07Q19.34 10.44 20.05 10.49L21.18 10.56Q21.90 10.61 21.90 11.39L21.90 12.61Q21.90 13.39 21.18 13.44L20.05 13.51Q19.34 13.56 19.22 13.93L19.04 14.50Q18.93 14.87 18.75 15.21L18.47 15.74Q18.29 16.08 18.77 16.63L19.51 17.48Q19.99 18.02 19.44 18.57L18.57 19.44Q18.02 19.99 17.48 19.51L16.63 18.77Q16.08 18.29 15.74 18.47L15.21 18.75Q14.87 18.93 14.50 19.04L13.93 19.22Q13.56 19.34 13.51 20.05L13.44 21.18Q13.39 21.90 12.61 21.90L11.39 21.90Q10.61 21.90 10.56 21.18L10.49 20.05Q10.44 19.34 10.07 19.22L9.50 19.04Q9.13 18.93 8.79 18.75L8.26 18.47Q7.92 18.29 7.37 18.77L6.52 19.51Q5.98 19.99 5.43 19.44L4.56 18.57Q4.01 18.02 4.49 17.48L5.23 16.63Q5.71 16.08 5.53 15.74L5.25 15.21Q5.07 14.87 4.96 14.50L4.78 13.93Q4.66 13.56 3.95 13.51L2.82 13.44Q2.10 13.39 2.10 12.61L2.10 11.39Q2.10 10.61 2.82 10.56L3.95 10.49Q4.66 10.44 4.78 10.07L4.96 9.50Q5.07 9.13 5.25 8.79L5.53 8.26Q5.71 7.92 5.23 7.37L4.49 6.52Q4.01 5.98 4.56 5.43L5.43 4.56Q5.98 4.01 6.52 4.49L7.37 5.23Q7.92 5.71 8.26 5.53L8.79 5.25Q9.13 5.07 9.50 4.96L10.07 4.78Q10.44 4.66 10.49 3.95L10.56 2.82Q10.61 2.10 11.39 2.10L12.61 2.10Q13.39 2.10 13.44 2.82L13.51 3.95Q13.56 4.66 13.93 4.78L14.50 4.96Q14.87 5.07 15.21 5.25L15.74 5.53Q16.08 5.71 16.63 5.23L17.48 4.49Q18.02 4.01 18.57 4.56L19.44 5.43Q19.99 5.98 19.51 6.52L18.77 7.37Q18.29 7.92 18.47 8.26ZM15.1 12a3.1 3.1 0 1 0-6.2 0a3.1 3.1 0 1 0 6.2 0Z',
  check: 'M5 12l4 4L19 6',
  history: 'M3 12a9 9 0 1 0 3-7M3 3v5h5m4-1v6l4 2',
  compare: 'M4 6h7M4 12h7M4 18h7M15 6h5M15 12h5M15 18h5M13 3v18',
  watch: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z',
  home: 'M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10',
  sessions: 'M3 7h18v14H3V7Zm3 0V3h12v4',
  all: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  diffs: 'M4 8h16M4 16h16M15 3 9 21',
  same: 'M5 8h14M5 16h14',
  structure: 'M4 3v14h5M4 7h5M11 4h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 10h8a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z',
  minor: 'M3 9c3-5 6-5 9 0s6 5 9 0M3 15c3-5 6-5 9 0s6 5 9 0',
  rules: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6',
  copy: 'M10 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM4 8a1 1 0 0 0-1 1v10a2 2 0 0 0 2 2h10a1 1 0 0 0 1-1',
  expand: 'M4 6h16M4 18h16M8 10l4 4 4-4',
  collapse: 'M4 6h16M4 18h16M8 14l4-4 4 4',
  select: 'M3 4h7v7H3V4Zm11 2 3 3 5-6M3 15h7v7H3v-7m11 2 3 3 5-6',
  files: 'M14 2H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M9 12h7M9 15h5M2 7v13a2 2 0 0 0 2 2h11',
  folders: 'M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v1M3 7h4l2 3h11a1 1 0 0 1 1 1l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  context: 'M4 5h16M4 19h16M4 9h3v6H4V9Zm7 1h9m-9 4h9',
  wrap: 'M3 5h18M3 10h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4M3 20h4',
  copyRight: 'M4 4h7a2 2 0 0 1 2 2v3M4 4v14a2 2 0 0 0 2 2h7M10 14h11m-4-4 4 4-4 4',
  copyLeft: 'M20 4h-7a2 2 0 0 0-2 2v3M20 4v14a2 2 0 0 1-2 2h-7M14 14H3m4-4-4 4 4 4',
  next: 'M5 3h14M12 7v14m-5-5 5 5 5-5',
  previous: 'M5 21h14M12 17V3m-5 5 5-5 5 5',
  refresh: 'M20 8a9 9 0 1 0 0 8M20 3v6h-6',
  swap: 'M3 7h18l-4-4M21 17H3l4 4',
  cancel: 'M7 3h10l4 4v10l-4 4H7l-4-4V7l4-4Zm2 6 6 6m0-6-6 6',
  filters: 'M3 4h18l-7 8v8l-4-2v-6L3 4Z',
  peek: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  log: 'M4 4h16v16H4V4Zm3 4h10M7 12h10M7 16h6',
  more: 'M4 12h.01M12 12h.01M20 12h.01',
  ignore: 'M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v1M3 7h4l2 3h11a1 1 0 0 1 1 1l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM4 3l17 18',
}
/** Local vectors are reused by the toolbar and overflow commands. */
export function toolbarIcon(command: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('toolbar-icon')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[command] ?? paths.files)
  svg.append(path)
  return svg
}

/** Replace font glyphs with the same vectors used by folder commands, preserving labels and handlers. */
export function initializeToolbarIcons(): void {
  const commands: Record<string, string> = { rules: 'rules', structural: 'structure', history: 'history', compare: 'compare', viewAll: 'all', viewDiffs: 'diffs', viewContext: 'context', ignoreWs: 'minor', wrap: 'wrap', copyToRight: 'copyRight', copyToLeft: 'copyLeft', nextDiff: 'next', prevDiff: 'previous', swap: 'swap', reload: 'refresh' }
  document.querySelectorAll<HTMLButtonElement>('#file-tools button[data-cmd]').forEach(button => {
    const label = button.querySelector('span')!
    button.replaceChildren(toolbarIcon(commands[button.dataset.cmd!]), label)
    button.setAttribute('aria-label', label.textContent ?? '')
  })
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    const label = document.createElement('span'); label.textContent = button.textContent?.trim() ?? ''
    button.replaceChildren(toolbarIcon(button.dataset.mode!), label)
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
