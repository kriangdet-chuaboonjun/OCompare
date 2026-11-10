import type { CompareHistoryApi, CompareHistoryEntry, HistoryTexts, NewCompareHistoryEntry } from '../shared/compareHistory'

/**
 * One store for the whole app (every Files tab and Folder tab). Records are appended
 * in order through Rust; the in-memory list only gains an entry after it was persisted,
 * so what the History dialog shows is what survives a restart.
 */
export class CompareHistoryStore {
  entries: CompareHistoryEntry[] = []
  usable = true
  loadError: unknown = null
  readonly ready: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(entries: readonly CompareHistoryEntry[]) => void>()

  constructor(
    private api: CompareHistoryApi,
    private newId: () => string = () => crypto.randomUUID(),
    private now: () => number = () => Date.now(),
  ) {
    this.ready = api
      .list()
      .then((file) => { this.entries = file.entries })
      .catch((error) => { this.usable = false; this.loadError = error })
  }

  onChange(listener: (entries: readonly CompareHistoryEntry[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Rejects when the entry could not be saved; callers tell the user and carry on. */
  record(entry: NewCompareHistoryEntry, texts?: HistoryTexts): Promise<void> {
    const full = { ...entry, id: this.newId(), createdAtMs: this.now() } as CompareHistoryEntry
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        await this.ready
        await this.api.append(full, texts)
        this.entries = [...this.entries, full]
        this.listeners.forEach((listener) => listener(this.entries))
      })
    this.queue = task
    return task
  }

  readSnapshot(id: string, side: 'left' | 'right'): Promise<string> { return this.api.readSnapshot(id, side) }

  settle(): Promise<unknown> { return this.queue.catch(() => {}) }
}

/** One-line outcome of a recorded run, e.g. "Different" or "Same 2 · Different 1 · Left only 1". */
export function describeResult(entry: CompareHistoryEntry): string {
  if (entry.kind === 'file') {
    const { status, rulesApplied } = entry.result
    if (status === 'different') return 'Different'
    return rulesApplied ? 'Identical (under rules)' : 'Identical'
  }
  const r = entry.result
  const parts = [`Same ${r.identical + r.minor}`, `Different ${r.different}`, `Left only ${r.leftOnly}`, `Right only ${r.rightOnly}`]
  if (r.errors > 0) parts.push(`Errors ${r.errors}`)
  if (r.skipped > 0) parts.push(`Skipped ${r.skipped}`)
  return parts.join(' · ')
}

export function describeHistoryError(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error)
  return `Compare history could not be saved: ${message}`
}
