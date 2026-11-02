import type { StructuralFormat } from '../shared/structural'
import type { Side } from '../shared/types'

export type { StructuralFormat }
export type VirtualKind = 'History' | 'Structural'
interface SideText { path: string | null; text: string }

const byExtension: Record<string, StructuralFormat> = { json: 'json', xml: 'xml', config: 'xml', csproj: 'xml', csv: 'csv', tsv: 'csv' }

/** Monaco has no CSV grammar, so derived CSV views are plain text. */
export const editorLanguage = (format: StructuralFormat): string => (format === 'csv' ? 'plaintext' : format)

const extensionOf = (path: string): string => path.split(/[\\/]/).pop()!.split('.').slice(1).pop()?.toLowerCase() ?? ''

function sniff(text: string): StructuralFormat | null {
  const first = text.trimStart()[0]
  return first === '{' || first === '[' ? 'json' : first === '<' ? 'xml' : null
}

/**
 * Pick the format for a pair: extension first, then the text itself. A side without a path
 * (an Untitled editor) takes the other side's format; a saved file whose type is unknown does not.
 */
export function detectFormat(left: SideText, right: SideText): { format: StructuralFormat } | { error: string } {
  const resolve = ({ path, text }: SideText): StructuralFormat | 'unknown' | 'inherit' =>
    (path && byExtension[extensionOf(path)]) || sniff(text) || (path ? 'unknown' : 'inherit')
  const [a, b] = [resolve(left), resolve(right)]
  if (a === 'unknown' || b === 'unknown') return { error: 'Structural compare supports JSON, XML and CSV files; one side has another file type' }
  if (a === 'inherit' && b === 'inherit') return { error: 'Structural compare could not tell the format; open a JSON, XML or CSV file, or paste JSON or XML text' }
  if (a !== 'inherit' && b !== 'inherit' && a !== b) return { error: `The two sides are different formats (${a} and ${b})` }
  return { format: (a === 'inherit' ? b : a) as StructuralFormat }
}

/** Identity of a derived document: side plus the full source path, so same-named files never share a model. */
export function structuralPath(format: StructuralFormat, side: Side, source: { path: string | null; id: string }): string {
  const origin = source.path ? source.path.replace(/\\/g, '/') : `untitled-${source.id}/Untitled`
  return `structural://${format}/${side}/${origin}`
}

export function virtualKind(path: string | null | undefined): VirtualKind | null {
  if (path?.startsWith('history://')) return 'History'
  if (path?.startsWith('structural://')) return 'Structural'
  return null
}

export const isVirtualPath = (path: string | null | undefined): boolean => virtualKind(path) !== null
