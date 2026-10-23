export type Eol = 'LF' | 'CRLF'
export type { RegexRule } from './comparisonRules'

export interface FileData {
  path: string
  text: string
  /** ชื่อ encoding เดิม เช่น utf-8, utf-16le, cp874/windows-874 */
  encoding: string
  bom: boolean
  eol: Eol
  size: number
  mtimeMs: number
}

export interface FileStat {
  size: number
  mtimeMs: number
}

export type Side = 'left' | 'right'

export interface OCompareApi {
  openDialog(): Promise<string | null>
  saveDialog(defaultPath?: string): Promise<string | null>
  readFile(path: string): Promise<FileData>
  saveFile(path: string, text: string, encoding: string, bom: boolean): Promise<FileStat>
  watchFile(documentId: string, path: string | null): Promise<void>
  onFileChanged(cb: (documentId: string) => void): void
  getStartupFiles(): Promise<string[]>
  setDirty(dirty: boolean): void
}
