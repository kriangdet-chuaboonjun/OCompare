import type { InstallGuard } from './updater'

interface WorkspaceGate {
  busy(): boolean
  lock(value: boolean): void
  settle(): Promise<void>
  resolveUnsaved(): Promise<boolean>
}

/** Installation can bypass native close events, so resolve edits explicitly while frozen. */
export class WorkspaceInstallGuard implements InstallGuard {
  private locked = false
  private readonly workspace: WorkspaceGate
  constructor(workspace: WorkspaceGate) { this.workspace = workspace }
  async prepare(): Promise<boolean> {
    if (this.workspace.busy()) return false
    this.locked = true; this.workspace.lock(true)
    await this.workspace.settle()
    if (this.workspace.busy()) return false
    return await this.workspace.resolveUnsaved() && !this.workspace.busy()
  }
  release(): void {
    if (this.locked) { this.workspace.lock(false); this.locked = false }
  }
}
