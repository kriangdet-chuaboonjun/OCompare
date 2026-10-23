import * as monaco from 'monaco-editor'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toolbarIcon } from './folderChrome'

type Theme = 'light' | 'dark'
const STORAGE_KEY = 'ocompare-theme'

/** Use the selected app theme when constructing an editor, including after reload. */
export function editorTheme(): string {
  return document.documentElement.dataset.theme === 'dark' ? 'bc-dark' : 'bc-light'
}

/** Switch colors in place so models, selections, undo history and folder results survive. */
export function initializeTheme(): void {
  let theme: Theme = 'light'
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'dark') theme = 'dark'
  } catch { /* Storage may be disabled; Light remains the default. */ }
  const button = document.getElementById('theme-toggle') as HTMLButtonElement
  const apply = (): void => {
    document.documentElement.dataset.theme = theme
    monaco.editor.setTheme(editorTheme())
    const label = document.createElement('span')
    label.textContent = theme === 'dark' ? 'Dark' : 'Light'
    button.replaceChildren(toolbarIcon(theme === 'dark' ? 'moon' : 'sun'), label)
    button.setAttribute('aria-pressed', String(theme === 'dark'))
    button.title = `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`
    // Keep the Windows title bar in step; browser regression tests use the web surface.
    if (isTauri()) {
      void getCurrentWindow().setTheme(theme).catch(() => {
        document.getElementById('st-msg')!.textContent = 'App theme changed, but the window theme could not be updated.'
      })
    }
  }
  apply()
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'
    apply()
    try { localStorage.setItem(STORAGE_KEY, theme) }
    catch {
      document.getElementById('st-msg')!.textContent = 'Theme changed, but this device could not save your preference.'
    }
  })
}

// Beyond Compare-like palette: whole changed lines tinted, changed characters stronger red
export function defineThemes(): void {
  monaco.editor.defineTheme('bc-light', {
    base: 'vs',
    inherit: true,
    // Keep syntax distinct while readable on the strongest changed-character tint.
    rules: [
      { token: 'comment', foreground: '165B1C' },
      { token: 'number', foreground: '005653' },
      { token: 'string.sql', foreground: '922323' },
      { token: 'operator.sql', foreground: '484F58' },
      { token: 'predefined.sql', foreground: '7B237B' },
    ],
    colors: {
      'diffEditor.removedLineBackground': '#ffe3e3',
      'diffEditor.insertedLineBackground': '#ffe3e3',
      'diffEditor.removedTextBackground': '#ff9a9a99',
      'diffEditor.insertedTextBackground': '#ff9a9a99',
      'diffEditor.diagonalFill': '#c8c8c8',
      'diffEditorGutter.removedLineBackground': '#ffd0d0',
      'diffEditorGutter.insertedLineBackground': '#ffd0d0',
      'diffEditorOverview.removedForeground': '#ff4d4d',
      'diffEditorOverview.insertedForeground': '#ff4d4d',
      'diffEditor.unchangedRegionBackground': '#eef3fb',
      'editor.lineHighlightBackground': '#f0f5ff',
      // Beyond Compare-like solid blue selection, kept visible when the editor loses focus
      'editor.selectionBackground': '#99c9ef',
      'editor.inactiveSelectionBackground': '#b9d8f2',
      'editor.selectionHighlightBackground': '#99c9ef55'
    }
  })
  monaco.editor.defineTheme('bc-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'B8DFAA' },
      { token: 'keyword', foreground: 'A8D4FF' },
      { token: 'number', foreground: 'B8E3C1' },
      { token: 'delimiter', foreground: 'E4E8EF' },
      { token: 'string.sql', foreground: 'FFD0AA' },
      { token: 'operator.sql', foreground: 'E4E8EF' },
      { token: 'predefined.sql', foreground: 'E6B6FF' },
    ],
    colors: {
      'editor.background': '#1e2228',
      'editor.foreground': '#e4e8ef',
      'editorLineNumber.foreground': '#bac5d4',
      'diffEditor.removedLineBackground': '#542b32',
      'diffEditor.insertedLineBackground': '#542b32',
      'diffEditor.removedTextBackground': '#a8465666',
      'diffEditor.insertedTextBackground': '#a8465666',
      'diffEditor.diagonalFill': '#414955',
      'diffEditorGutter.removedLineBackground': '#6c3540',
      'diffEditorGutter.insertedLineBackground': '#6c3540',
      'diffEditorOverview.removedForeground': '#ff8794',
      'diffEditorOverview.insertedForeground': '#ff8794',
      'diffEditor.unchangedRegionBackground': '#272f3b',
      'editor.lineHighlightBackground': '#28313e',
      'editor.selectionBackground': '#285783',
      'editor.inactiveSelectionBackground': '#354f6a',
      'editor.selectionHighlightBackground': '#497ca655'
    }
  })
}
