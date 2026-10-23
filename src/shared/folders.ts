export type FolderStatus =
  | 'identical'
  | 'minor'
  | 'different'
  | 'left-only'
  | 'right-only'
  | 'error'
  | 'skipped'
export interface EntryMetadata {
  path: string
  name: string
  kind: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  sizePartial?: boolean
}
export interface FolderEntry {
  relativePath: string
  kind: EntryMetadata['kind']
  left: EntryMetadata | null
  right: EntryMetadata | null
  status: FolderStatus
  error: string | null
  minorReason?: string | null
}
export interface FolderSummary {
  files: number
  directories: number
  identical: number
  minor: number
  different: number
  leftOnly: number
  rightOnly: number
  errors: number
  skipped: number
}
export interface FolderComparison {
  requestId: string
  leftPath: string
  rightPath: string
  entries: FolderEntry[]
  summary: FolderSummary
}
export interface FolderProgress {
  requestId: string
  visited: number
}
export interface FolderApi {
  watchFolders?(leftPath: string, rightPath: string): Promise<number>
  stopWatching?(): Promise<void>
  onChanged?(callback: (event: FolderWatchEvent) => void): Promise<() => void>
  openDirectory(): Promise<string | null>
  compare(
    leftPath: string,
    rightPath: string,
    requestId: string,
    options?: FolderCompareOptions,
  ): Promise<FolderComparison>
  cancel(requestId: string): Promise<void>
  onProgress(callback: (progress: FolderProgress) => void): Promise<() => void>
  loadSessions(): Promise<SessionStore>
  saveSessions(store: SessionStore): Promise<void>
  diskSpace(path: string): Promise<number>
  planCopy(
    leftPath: string,
    rightPath: string,
    direction: Side,
    paths: string[],
    requestId: string,
  ): Promise<CopyPlan>
  executeCopy(planId: string, requestId: string): Promise<CopyReport>
  discardCopy(planId: string): Promise<void>
  onCopyProgress(callback: (progress: CopyProgress) => void): Promise<() => void>
}

import type { Side } from './types'
export interface FolderCompareOptions {
  ignoreWhitespace: boolean
  ignoreEol: boolean
  regexRules?: import('./comparisonRules').RegexRule[]
}
export interface FolderWatchEvent { generation: number; error?: string | null }
export interface FolderViewOptions {
  include: string
  exclude: string
  structure: 'tree' | 'flat'
  peek: boolean
  showMinor: boolean
  statuses: FolderStatus[]
  sort: 'name' | 'size' | 'modified'
  sortSide: Side
  descending: boolean
  split: number
  columns: number[]
}
export interface FolderSession {
  id: string
  name: string
  leftPath: string
  rightPath: string
  rules: FolderCompareOptions
  view: FolderViewOptions
}
export interface SessionStore {
  version: 1
  sessions: FolderSession[]
  history: string[]
}
export interface CopyItem {
  relativePath: string
  source: string
  destination: string
  size: number
  action: 'create' | 'overwrite' | 'skip'
  reason: string | null
  directory: boolean
}
export interface CopyPlan {
  planId: string
  items: CopyItem[]
  bytes: number
}
export interface CopyOutcome {
  relativePath: string
  status: 'copied' | 'skipped' | 'failed'
  message: string
}
export interface CopyReport {
  items: CopyOutcome[]
  canceled: boolean
}
export interface CopyProgress {
  requestId: string
  completed: number
  total: number
  relativePath: string
}
