/** Formats the Rust core can rewrite into canonical text (serde lowercase names). */
export type StructuralFormat = 'json' | 'xml' | 'csv'

/** Rust rewrites text into a formatting-insensitive canonical form; rejects with a displayable message. */
export interface StructuralApi {
  canonicalize(text: string, format: StructuralFormat): Promise<string>
}
