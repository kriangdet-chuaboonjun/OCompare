import type { OCompareApi } from '../src/shared/types'
import type { FolderApi, FolderProgress } from '../src/shared/folders'

declare global {
  interface Window {
    testConfirm: boolean
    testDirty: boolean
    compareDelayMs: number
    /** Path the Save dialog returns (null cancels it). */
    testSavePath: string | null
    /** Answer to the "try again" prompt shown when recovery data cannot be stored. */
    testRetry: boolean
    /** Messages shown by that prompt. */
    testRetryMessages: string[]
    /** Runs while that prompt is open (a test can fix the fault before the retry). */
    testRetryHook?: (message: string) => unknown
    /** Runs the app's close request; resolves true when the window would close. */
    __ocompareClose?: () => Promise<boolean>
  }
}
window.testConfirm = false
window.testDirty = false
window.compareDelayMs = 0
window.testSavePath = null
window.testRetry = false
window.testRetryMessages = []
const watchedFiles = new Map<string, string>()
const fileChangedListeners = new Set<(documentId: string) => void>()
export function emitFileChanged(path: string): void {
  for (const [id, watchedPath] of watchedFiles) if (watchedPath === path) fileChangedListeners.forEach(listener => listener(id))
}
/** ?startup=files&left=..&right=.. or ?startup=folders&left=..&right=.. stands in for an Explorer launch. */
export const getStartupComparison = async (): Promise<{ mode: 'files' | 'folders'; paths: string[] } | null> => {
  const query = new URLSearchParams(location.search)
  const mode = query.get('startup')
  if (mode !== 'files' && mode !== 'folders') return null
  return { mode, paths: ['left', 'right'].map(key => query.get(key)).filter((path): path is string => Boolean(path)) }
}

async function transport<T>(action: string, args: object): Promise<T> {
  const response = await fetch(`/__folder_test/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const result = await response.json()
  if (result.error) throw new Error(result.error.message ?? result.error)
  return result.data
}

// เฉพาะ test harness: filesystem มาจาก Rust จริง; native dialogs จำลองคำตอบเพราะ headless ไม่มี dialog
export const api: OCompareApi = {
  openDialog: async () => null,
  saveDialog: async () => window.testSavePath,
  readFile: (path) => transport('workspace', { action: 'readFile', path }),
  saveFile: (path, text, encoding, bom) => transport('workspace', { action: 'saveFile', path, text, encoding, bom }),
  watchFile: async (id, path) => { if (path) watchedFiles.set(id, path); else watchedFiles.delete(id) },
  onFileChanged: listener => { fileChangedListeners.add(listener) },
  getStartupFiles: async () => [],
  setDirty: (dirty) => {
    window.testDirty = dirty
  },
}
// One poller drains the shared Rust queue and fans out to every tab; tabs filter by tabId.
const changedListeners = new Set<(event: import('../src/shared/folders').FolderWatchEvent) => void>()
let polling = false
function pollWatchEvents(): void {
  if (polling) return
  polling = true
  const timer = setInterval(() => {
    if (!changedListeners.size) { clearInterval(timer); polling = false; return }
    void transport<import('../src/shared/folders').FolderWatchEvent[]>('workspace', { action: 'watchEvents' })
      .then(events => events.forEach(event => changedListeners.forEach(listener => listener(event)))).catch(() => {})
  }, 150)
}
const progressListeners = new Set<(progress: FolderProgress) => void>()
export const folderApi: FolderApi = {
  watchFolders: (tabId, leftPath, rightPath) => transport('workspace', { action: 'watchFolders', tabId, leftPath, rightPath }),
  stopWatching: tabId => transport('workspace', { action: 'stopWatch', tabId }),
  onChanged: async callback => {
    changedListeners.add(callback)
    pollWatchEvents()
    return () => { changedListeners.delete(callback) }
  },
  openDirectory: async () => null,
  compare: async (leftPath, rightPath, requestId, options) => {
    progressListeners.forEach(listener => listener({ requestId, visited: 0 }))
    const result = await transport<Awaited<ReturnType<FolderApi['compare']>>>('workspace', {
      action: 'compare',
      leftPath,
      rightPath,
      requestId,
      options,
    })
    const delay = window.compareDelayMs
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    return result
  },
  cancel: (requestId) => transport('workspace', { action: 'cancel', requestId }),
  onProgress: async (callback) => {
    progressListeners.add(callback)
    return () => { progressListeners.delete(callback) }
  },
  loadSessions: () => transport('workspace', { action: 'loadSessions' }),
  saveSessions: (store) => transport('workspace', { action: 'saveSessions', store }),
  diskSpace: (path) => transport('workspace', { action: 'diskSpace', path }),
  pathKinds: (paths) => transport('workspace', { action: 'pathKinds', paths }),
  planCopy: (leftPath, rightPath, direction, paths, requestId, ignoredFolders) =>
    transport('workspace', { action: 'planCopy', leftPath, rightPath, direction, paths, requestId, ignoredFolders }),
  executeCopy: (planId, requestId) => transport('workspace', { action: 'executeCopy', planId, requestId }),
  discardCopy: (planId) => transport('workspace', { action: 'discardCopy', planId }),
  onCopyProgress: async () => () => {},
}
export function confirm(): Promise<boolean> {
  return Promise.resolve(window.testConfirm)
}
export async function setTitle(): Promise<void> {}
export async function initializePlatform(onDrop?: (event: DropEvent) => void, _onError?: (message: string) => void, canClose?: () => boolean | Promise<boolean>): Promise<void> {
  window.__ocompareClose = async () => (canClose ? canClose() : true)
  // Lets UI tests deliver the native drag-drop events the browser cannot produce.
  ;(window as unknown as { __ocompareDrop?: unknown }).__ocompareDrop = onDrop
}
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
export interface DropEvent {
  type: 'enter' | 'over' | 'drop' | 'leave'
  paths: string[]
  x: number
}
export const comparisonRulesApi = {
  validate: (rules: import('../src/shared/comparisonRules').RegexRule[]) => transport<void>('workspace', { action: 'validateRules', rules }),
  normalizePair: (left: string, right: string, rules: import('../src/shared/comparisonRules').RegexRule[]) => transport<import('../src/shared/comparisonRules').NormalizedPair>('workspace', { action: 'normalizePair', left, right, rules }),
}
export const structuralApi: import('../src/shared/structural').StructuralApi = {
  canonicalize: (text, format) => transport<string>('workspace', { action: 'canonicalizeStructural', text, format }),
}
export const tabDraftApi: import('../src/shared/tabDrafts').TabDraftApi = {
  load: () => transport('workspace', { action: 'loadTabDrafts' }),
  save: store => transport('workspace', { action: 'saveTabDrafts', store }),
  clear: () => transport('workspace', { action: 'clearTabDrafts' }),
}
export async function confirmRetry(message: string): Promise<boolean> {
  window.testRetryMessages.push(message)
  await window.testRetryHook?.(message)
  return window.testRetry
}
export const backupApi = {
  list: (path: string) => transport<import('../src/renderer/backupHistory').BackupEntry[]>('workspace', { action: 'listHistory', path }),
  snapshot: (path: string, snapshotId: string) => transport<import('../src/shared/types').FileData>('workspace', { action: 'snapshot', path, snapshotId }),
  restore: (path: string, snapshotId: string) => transport<void>('workspace', { action: 'restore', path, snapshotId }),
}
