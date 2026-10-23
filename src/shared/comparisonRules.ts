/** Regex rules are evaluated by Rust; editable Monaco source models stay untouched. */
export interface RegexRule { id: string; pattern: string; enabled: boolean }
export interface NormalizedText {
  text: string
  lines: Array<{ startColumns: number[]; endColumns: number[] }>
}
export interface NormalizedPair {
  left: NormalizedText
  right: NormalizedText
  applied: boolean
  reason: string | null
}
