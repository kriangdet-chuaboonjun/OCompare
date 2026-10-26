export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

/** Native update handles own the verified download until installation or disposal. */
export interface AppUpdate {
  version: string
  body?: string
  download(progress: (event: DownloadEvent) => void): Promise<void>
  install(): Promise<void>
  close(): Promise<void>
}
export interface UpdaterApi { check(): Promise<AppUpdate | null> }
export interface InstallGuard {
  prepare(): Promise<boolean>
  release(): void
}
export interface UpdateState {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'preparing' | 'installing' | 'error'
  visible: boolean
  version: string
  notes: string
  message: string
  downloaded: number
  total?: number
  canInstall: boolean
}

function stableVersion(version: string): number[] | null {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.test(version)) return null
  const parts = version.split('+')[0].split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

/** Owns update state without coupling the UI to network, IPC, or process exit. */
export class UpdateController {
  state: UpdateState = { phase: 'idle', visible: false, version: '', notes: '', message: '', downloaded: 0, canInstall: false }
  private update: AppUpdate | null = null
  private downloaded = false
  private working = false
  private readonly api: UpdaterApi
  private readonly guard: InstallGuard
  private readonly changed: (state: UpdateState) => void
  readonly currentVersion: string

  constructor(currentVersion: string, api: UpdaterApi, guard: InstallGuard, changed: (state: UpdateState) => void) {
    this.currentVersion = currentVersion; this.api = api; this.guard = guard; this.changed = changed
  }
  private publish(change: Partial<UpdateState>): void {
    this.state = { ...this.state, ...change }; this.changed(this.state)
  }
  show(): void { this.publish({ visible: true }) }
  hide(): void { if (!this.working) this.publish({ visible: false }) }

  async check(manual: boolean): Promise<void> {
    if (manual) this.show()
    if (this.working) return
    this.working = true
    this.publish({ phase: 'checking', message: 'Checking for updates…', canInstall: false, version: '', notes: '', downloaded: 0, total: undefined })
    try {
      await this.update?.close(); this.update = null; this.downloaded = false
      const update = await this.api.check()
      const next = update ? stableVersion(update.version) : null
      const current = stableVersion(this.currentVersion)!
      const index = next?.findIndex((part, i) => part !== current[i]) ?? -1
      if (!update || !next || index < 0 || next[index] < current[index]) {
        await update?.close()
        this.publish({ phase: 'current', message: 'You are using the latest stable version.' })
        return
      }
      this.update = update
      this.publish({ phase: 'available', version: update.version, notes: update.body ?? '', canInstall: true, message: 'An update is available.' })
    } catch (error) {
      this.publish({ phase: 'error', message: `Could not check for updates: ${errorText(error)}` })
    } finally { this.working = false }
  }

  async install(): Promise<void> {
    if (this.working || !this.update) return
    this.working = true
    let guarded = false
    try {
      if (!this.downloaded) {
        this.publish({ phase: 'downloading', message: 'Downloading update…', canInstall: false, downloaded: 0, total: undefined })
        await this.update.download(event => {
          if (event.event === 'Started') this.publish({ total: event.data.contentLength })
          if (event.event === 'Progress') this.publish({ downloaded: this.state.downloaded + event.data.chunkLength })
        })
        this.downloaded = true
      }
      this.publish({ phase: 'preparing', message: 'Preparing to install…', canInstall: false })
      guarded = true
      if (!await this.guard.prepare()) {
        this.publish({ phase: 'ready', message: 'Installation postponed. Save your work and stop any folder jobs, then try again.', canInstall: true })
        return
      }
      this.publish({ phase: 'installing', message: 'Installing update… OCompare will close and reopen.' })
      await this.update.install()
    } catch (error) {
      this.publish({ phase: 'error', message: `Update failed: ${errorText(error)}`, canInstall: true })
    } finally {
      if (guarded) this.guard.release()
      this.working = false
    }
  }
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
