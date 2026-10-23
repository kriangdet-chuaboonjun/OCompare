import { computeRegexDiff } from './regexDiffCore'
import type { NormalizedPair } from './regexDiff'

self.onmessage = (event: MessageEvent<{ id: number; pair: NormalizedPair; options: Record<string, unknown> }>) => {
  const { id, pair, options } = event.data
  try { self.postMessage({ id, result: computeRegexDiff(pair, options) }) }
  catch (error) { self.postMessage({ id, error: String(error) }) }
}
