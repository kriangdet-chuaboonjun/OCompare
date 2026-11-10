import type { FolderSummary } from './folders'

/** Result of one completed Files comparison. */
export interface FileHistoryResult {
  status: 'identical' | 'different'
  /** Number of difference sections Monaco found (after regex rules / whitespace options). */
  changeCount?: number
  /** True when at least one regex rule was enabled, so "identical" means identical under rules. */
  rulesApplied?: boolean
}

export type FolderHistoryResult = Pick<
  FolderSummary,
  'files' | 'directories' | 'identical' | 'minor' | 'different' | 'leftOnly' | 'rightOnly' | 'errors' | 'skipped'
>

/** Label stored as the path of a side that was pasted text rather than a file. */
export const PASTED_TEXT = 'Pasted text'

interface HistoryBase {
  id: string
  createdAtMs: number
  /** A file path, or PASTED_TEXT when `leftText` is set. */
  leftPath: string
  rightPath: string
  /** The side was text with no file; its content is kept as a snapshot and can be read back. */
  leftText?: boolean
  rightText?: boolean
}
export type CompareHistoryEntry =
  | (HistoryBase & { kind: 'file'; result: FileHistoryResult })
  | (HistoryBase & { kind: 'folder'; result: FolderHistoryResult })

/** A new entry as produced by the compare hooks; id and time are assigned by the store. */
export type NewCompareHistoryEntry =
  | { kind: 'file'; leftPath: string; rightPath: string; leftText?: boolean; rightText?: boolean; result: FileHistoryResult }
  | { kind: 'folder'; leftPath: string; rightPath: string; result: FolderHistoryResult }

/** Content of the pasted sides, stored with the entry. Present exactly for the sides flagged as text. */
export interface HistoryTexts {
  leftText?: string
  rightText?: string
}

export interface CompareHistoryFile {
  version: 1
  entries: CompareHistoryEntry[]
}

export interface CompareHistoryApi {
  list(): Promise<CompareHistoryFile>
  append(entry: CompareHistoryEntry, texts?: HistoryTexts): Promise<void>
  readSnapshot(id: string, side: 'left' | 'right'): Promise<string>
}
