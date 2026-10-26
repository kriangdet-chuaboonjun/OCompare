import type { OCompareApi } from '../src/shared/types'
import type { FolderApi, FolderProgress } from '../src/shared/folders'

declare global {
  interface Window {
    testConfirm: boolean
    testDirty: boolean
    compareDelayMs: number
  }
}
window.testConfirm = false
window.testDirty = false
window.compareDelayMs = 0
const watchedFiles = new Map<string, string>()
const fileChangedListeners = new Set<(documentId: string) => void>()
export function emitFileChanged(path: string): void {
  for (const [id, watchedPath] of watchedFiles) if (watchedPath === path) fileChangedListeners.forEach(listener => listener(id))
}
export const getStartupComparison = async () => null

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
  saveDialog: async () => null,
  readFile: (path) => transport('workspace', { action: 'readFile', path }),
  saveFile: (path, text, encoding, bom) => transport('workspace', { action: 'saveFile', path, text, encoding, bom }),
  watchFile: async (id, path) => { if (path) watchedFiles.set(id, path); else watchedFiles.delete(id) },
  onFileChanged: listener => { fileChangedListeners.add(listener) },
  getStartupFiles: async () => [],
  setDirty: (dirty) => {
    window.testDirty = dirty
  },
}
let progressCallback: ((progress: FolderProgress) => void) | null = null
export const folderApi: FolderApi = {
  watchFolders: (leftPath, rightPath) => transport('workspace', { action: 'watchFolders', leftPath, rightPath }),
  stopWatching: () => transport('workspace', { action: 'stopWatch' }),
  onChanged: async callback => {
    let pending = false
    const timer = setInterval(() => {
      if (pending) return
      pending = true
      void transport<import('../src/shared/folders').FolderWatchEvent[]>('workspace', { action: 'watchEvents' })
        .then(events => events.forEach(callback)).catch(() => {}).finally(() => { pending = false })
    }, 150)
    return () => clearInterval(timer)
  },
  openDirectory: async () => null,
  compare: async (leftPath, rightPath, requestId, options) => {
    progressCallback?.({ requestId, visited: 0 })
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
    progressCallback = callback
    return () => {
      progressCallback = null
    }
  },
  loadSessions: () => transport('workspace', { action: 'loadSessions' }),
  saveSessions: (store) => transport('workspace', { action: 'saveSessions', store }),
  diskSpace: (path) => transport('workspace', { action: 'diskSpace', path }),
  planCopy: (leftPath, rightPath, direction, paths, requestId) =>
    transport('workspace', { action: 'planCopy', leftPath, rightPath, direction, paths, requestId }),
  executeCopy: (planId, requestId) => transport('workspace', { action: 'executeCopy', planId, requestId }),
  discardCopy: (planId) => transport('workspace', { action: 'discardCopy', planId }),
  onCopyProgress: async () => () => {},
}
export function confirm(): Promise<boolean> {
  return Promise.resolve(window.testConfirm)
}
export async function setTitle(): Promise<void> {}
export async function initializePlatform(): Promise<void> {}
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
export const backupApi = {
  list: (path: string) => transport<import('../src/renderer/backupHistory').BackupEntry[]>('workspace', { action: 'listHistory', path }),
  snapshot: (path: string, snapshotId: string) => transport<import('../src/shared/types').FileData>('workspace', { action: 'snapshot', path, snapshotId }),
  restore: (path: string, snapshotId: string) => transport<void>('workspace', { action: 'restore', path, snapshotId }),
}
