import type { Eol, RegexRule, Side } from './types'

/**
 * One document of the Files workspace. `text` is present only when it has unsaved edits;
 * a clean file is read again from `path`, and an empty untitled side has neither.
 * A file open in several tabs is one entry that every tab refers to by `id`.
 */
export interface DraftDocument {
  id: string
  path: string | null
  text: string | null
  encoding: string
  bom: boolean
  eol: Eol
  language: string | null
  /** Size and modified time the text was based on; compared with the disk to detect outside changes. */
  size: number
  mtimeMs: number
}

export interface DraftTab {
  left: string
  right: string
  focused: Side
  options: { viewMode: 'all' | 'diffs' | 'context'; ignoreWs: boolean; wrap: boolean }
  regexRules: RegexRule[]
}

export interface TabDraftStore {
  version: 1
  savedAtMs: number
  /** Index into `tabs` of the tab that was active, or null when it was not recoverable. */
  active: number | null
  documents: DraftDocument[]
  tabs: DraftTab[]
}

/** Rust owns the file; every write replaces the previous store atomically. */
export interface TabDraftApi {
  load(): Promise<TabDraftStore>
  save(store: TabDraftStore): Promise<void>
  clear(): Promise<void>
}
