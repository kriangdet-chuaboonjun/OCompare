import type * as monaco from 'monaco-editor'
import type { RegexRule } from '../shared/comparisonRules'
import type { DiffChange, DiffRange, RegexDiffResult } from './regexDiffCore'
// @ts-expect-error Internal Monaco classes must survive worker serialization.
import { DetailedLineRangeMapping, RangeMapping } from 'monaco-editor/editor/common/diff/rangeMapping.js'
// @ts-expect-error Monaco internal class used only by this compatibility adapter.
import { LineRange } from 'monaco-editor/editor/common/core/ranges/lineRange.js'
// @ts-expect-error Monaco internal class used only by this compatibility adapter.
import { Range } from 'monaco-editor/editor/common/core/range.js'

export interface NormalizedText { text: string; lines: { startColumns: number[]; endColumns: number[] }[] }
export interface NormalizedPair { left: NormalizedText; right: NormalizedText; applied: boolean; reason: string | null }
export type NormalizePair = (left: string, right: string, rules: RegexRule[]) => Promise<NormalizedPair>
interface Cancellation { readonly isCancellationRequested: boolean }

/** Internal provider contract pinned to Monaco 0.57; original models remain untouched. */
export class RegexDiffAdapter {
  private rules: RegexRule[] = []
  private listeners = new Set<() => void>()
  private generation = 0
  private worker: Worker | null = null
  private pending = new Map<number, { resolve: (result: RegexDiffResult) => void; reject: (error: Error) => void }>()
  private nextId = 0
  private disposed = false

  constructor(private normalizePair: NormalizePair, private onStatus: (message: string | null) => void = () => {}) {}

  readonly onDidChange = (listener: () => void): monaco.IDisposable => {
    this.listeners.add(listener)
    return { dispose: () => { this.listeners.delete(listener) } }
  }

  setRules(rules: RegexRule[]): void {
    this.rules = rules.map(rule => ({ ...rule }))
    this.generation++
    this.cancelWorker()
    this.listeners.forEach(listener => listener())
  }

  /** Monaco validates diffAlgorithm as a string; override its private factory instead.
   * Pass this as createDiffEditor's third argument before the first editor is created.
   */
  overrideServices(): monaco.editor.IEditorOverrideServices {
    return { diffProviderFactoryService: { createDiffProvider: () => ({
      computeDiff: this.computeDiff.bind(this), onDidChange: this.onDidChange,
      dispose: () => {},
    }) } }
  }

  async computeDiff(original: monaco.editor.ITextModel, modified: monaco.editor.ITextModel,
    options: Record<string, unknown>, cancellation: Cancellation): Promise<unknown> {
    const generation = this.generation
    const leftVersion = original.getVersionId(), rightVersion = modified.getVersionId()
    const stale = () => this.disposed || cancellation.isCancellationRequested || generation !== this.generation
      || original.isDisposed() || modified.isDisposed() || original.getVersionId() !== leftVersion || modified.getVersionId() !== rightVersion
    await new Promise(resolve => setTimeout(resolve, 120))
    if (stale()) return null
    let pair: NormalizedPair
    const left = original.getValue(), right = modified.getValue()
    try {
      pair = this.rules.some(rule => rule.enabled)
        ? await this.normalizePair(left, right, this.rules)
        : { left: { text: left, lines: [] }, right: { text: right, lines: [] }, applied: false, reason: null }
      if (stale()) return null
      this.onStatus(pair.reason)
    } catch (error) {
      if (stale()) return null
      this.onStatus(`Regex rules were not applied: ${String(error)}; showing original differences`)
      pair = { left: { text: left, lines: [] }, right: { text: right, lines: [] }, applied: false, reason: String(error) }
    }
    try {
      const result = await this.runWorker(pair, options)
      if (stale()) return null
      const range = (value: DiffRange) => new Range(value.startLineNumber, value.startColumn, value.endLineNumber, value.endColumn)
      const changes = result.changes.map((change: DiffChange) => new DetailedLineRangeMapping(
        new LineRange(change.original.startLineNumber, change.original.endLineNumberExclusive),
        new LineRange(change.modified.startLineNumber, change.modified.endLineNumberExclusive),
        change.innerChanges?.map(inner => new RangeMapping(range(inner.originalRange), range(inner.modifiedRange))),
      ))
      return { ...result, changes }
    } catch (error) {
      if (stale()) return null
      this.onStatus(`Comparison failed: ${String(error)}`)
      throw error
    }
  }

  private runWorker(pair: NormalizedPair, options: Record<string, unknown>): Promise<RegexDiffResult> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./regexDiff.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = event => {
        const item = this.pending.get(event.data.id)
        if (!item) return
        this.pending.delete(event.data.id)
        if (event.data.error) item.reject(new Error(event.data.error))
        else item.resolve(event.data.result)
      }
      this.worker.onerror = event => {
        for (const item of this.pending.values()) item.reject(new Error(event.message))
        this.pending.clear()
        this.worker?.terminate(); this.worker = null
      }
    }
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, pair, options })
    })
  }

  private cancelWorker(): void {
    this.worker?.terminate(); this.worker = null
    for (const item of this.pending.values()) item.reject(new Error('Comparison cancelled'))
    this.pending.clear()
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.cancelWorker()
    this.listeners.clear()
  }
}
