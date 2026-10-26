import type { FolderApi, SessionStore } from '../shared/folders'

/** One store for every folder tab: updates run in order on the latest data, so tabs never overwrite each other. */
export class SessionStorage {
  store: SessionStore = { version: 1, sessions: [], history: [] }
  usable = true
  loadError: unknown = null
  readonly ready: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(store: SessionStore) => void>()

  constructor(private api: Pick<FolderApi, 'loadSessions' | 'saveSessions'>) {
    this.ready = api
      .loadSessions()
      .then((store) => { this.store = store })
      .catch((error) => { this.usable = false; this.loadError = error })
  }

  onChange(listener: (store: SessionStore) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The mutator receives the newest store, whichever tab asked. */
  update(mutate: (store: SessionStore) => SessionStore): Promise<void> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const next = mutate(this.store)
        await this.api.saveSessions(next)
        this.store = next
        this.listeners.forEach((listener) => listener(next))
      })
    this.queue = task
    return task
  }

  settle(): Promise<unknown> { return this.queue.catch(() => {}) }
}
