import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open, save, confirm as nativeConfirm } from '@tauri-apps/plugin-dialog'
import type { OCompareApi } from '../shared/types'
import type { RegexRule, NormalizedPair } from '../shared/comparisonRules'
import type { FolderApi, FolderProgress, CopyProgress } from '../shared/folders'

interface FileEvent { documentId: string; path: string; generation: number; error?: string }
export interface DropEvent { type: 'enter' | 'over' | 'drop' | 'leave'; paths: string[]; x: number }
const appWindow = getCurrentWindow()
const generations: Record<string, number> = {}
const requests: Record<string, number> = {}
const watchQueues: Record<string, Promise<void>> = {}
const fileListeners = new Set<(documentId: string) => void>()
const unlisten: UnlistenFn[] = []
let dirty = false
let lastTitle = ''
let closing = false
let disposed = false

/** ทำให้ Rust errors และ JS errors แสดงผ่าน status bar แบบเดียวกัน */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null && 'message' in value) return new Error(String(value.message))
  return new Error(String(value))
}

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(name, args) } catch (error) { throw toError(error) }
}

export const getStartupComparison = () => command<{ mode: 'files' | 'folders'; paths: string[] } | null>('get_startup_comparison')

export const api: OCompareApi = {
  openDialog: async () => {
    const path = await open({ multiple: false, directory: false })
    return typeof path === 'string' ? path : null
  },
  saveDialog: (defaultPath) => save({ defaultPath }),
  readFile: (path) => command('read_file', { path }),
  saveFile: (path, text, encoding, bom) => command('save_file', { path, text, encoding, bom }),
  watchFile: (side, path) => {
    const request = requests[side] = (requests[side] ?? 0) + 1
    generations[side] = 0
    const task = (watchQueues[side] ?? Promise.resolve()).catch(() => {}).then(async () => {
      const generation = await command<number>('watch_file', { documentId: side, path })
      if (request === requests[side]) generations[side] = generation
    })
    watchQueues[side] = task
    return task
  },
  onFileChanged: (cb) => { fileListeners.add(cb) },
  getStartupFiles: () => command('get_startup_files'),
  setDirty: (value) => { if (dirty !== value) dirty = value }
}

export const folderApi: FolderApi = {
  watchFolders: (tabId, leftPath, rightPath) => command('watch_folders', { tabId, leftPath, rightPath }),
  stopWatching: tabId => command('stop_folder_watch', { tabId }),
  onChanged: callback => listen('folder:changed', ({ payload }) => callback(payload as import('../shared/folders').FolderWatchEvent)),
  openDirectory: async () => {
    const path = await open({ directory: true, multiple: false })
    return typeof path === 'string' ? path : null
  },
  compare: (leftPath, rightPath, requestId, options) => command('compare_folders', { leftPath, rightPath, requestId, options }),
  cancel: (requestId) => command('cancel_folder_compare', { requestId }),
  onProgress: (callback) => listen<FolderProgress>('folder:progress', ({ payload }) => callback(payload)),
  loadSessions: () => command('load_folder_sessions'),
  saveSessions: store => command('save_folder_sessions', { store }),
  diskSpace: path => command('folder_disk_space', { path }),
  planCopy: (leftPath, rightPath, direction, paths, requestId, ignoredFolders) => command('plan_folder_copy', { leftPath, rightPath, direction, paths, requestId, ignoredFolders }),
  executeCopy: (planId, requestId) => command('execute_folder_copy', { planId, requestId }),
  discardCopy: planId => command('discard_folder_copy', { planId }),
  onCopyProgress: callback => listen<CopyProgress>('folder:copy-progress', ({ payload }) => callback(payload))
}

export function confirm(message: string): Promise<boolean> {
  return nativeConfirm(message, { title: 'OCompare', kind: 'warning' })
}

export async function setTitle(title: string): Promise<void> {
  if (title === lastTitle) return
  await appWindow.setTitle(title)
  lastTitle = title
}

/** ติดตั้ง native listeners ให้ครบก่อนเริ่มเปิดไฟล์จาก command line */
export async function initializePlatform(onDrop: (event: DropEvent) => void, onError: (message: string) => void, canClose?: () => boolean | Promise<boolean>): Promise<void> {
  try {
    unlisten.push(await listen<FileEvent>('file:changed', ({ payload }) => {
      if (payload.generation !== generations[payload.documentId]) return
      if (payload.error) { onError(`File watcher failed: ${payload.error}`); return }
      fileListeners.forEach((cb) => cb(payload.documentId))
    }))
    unlisten.push(await appWindow.onCloseRequested(async (event) => {
      event.preventDefault()
      if (closing) return
      closing = true
      try {
        if (canClose) { if (await canClose()) await appWindow.destroy(); return }
        if (!dirty) { await appWindow.destroy(); return }
        if (await nativeConfirm('There are unsaved changes. Close anyway?', {
          title: 'OCompare', kind: 'warning', okLabel: 'Discard changes', cancelLabel: 'Cancel'
        })) await appWindow.destroy()
      } catch (error) { onError(toError(error).message) }
      finally { closing = false }
    }))
    unlisten.push(await getCurrentWebview().onDragDropEvent(({ payload }) => {
      const x = 'position' in payload ? payload.position.x / window.devicePixelRatio : 0
      onDrop({ type: payload.type, paths: 'paths' in payload ? payload.paths : [], x })
    }))
    window.addEventListener('pagehide', disposePlatform, { once: true })
  } catch (error) {
    disposePlatform()
    throw toError(error)
  }
}

/** One Rust engine evaluates user expressions for both files and folders. */
export const comparisonRulesApi = {
  validate: (rules: RegexRule[]) => command<void>('validate_comparison_rules', { rules }),
  normalizePair: (left: string, right: string, rules: RegexRule[]) => command<NormalizedPair>('normalize_comparison_pair', { left, right, rules }),
}
export const backupApi = {
  list: (path: string) => command<import('./backupHistory').BackupEntry[]>('list_backup_history', { path }),
  snapshot: (path: string, id: string) => command<import('../shared/types').FileData>('read_backup_snapshot', { path, id }),
  restore: (path: string, id: string) => command<void>('restore_backup', { path, id }),
}

export function disposePlatform(): void {
  if (disposed) return
  disposed = true
  unlisten.splice(0).forEach((off) => off())
  fileListeners.clear()
}
