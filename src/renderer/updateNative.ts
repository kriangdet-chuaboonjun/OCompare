import type { UpdaterApi } from '../shared/updater'

/** The plugin validates HTTPS metadata and verifies the signature before returning a download. */
export const updaterApi: UpdaterApi = {
  async check() {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 30_000 })
    if (!update) return null
    return {
      version: update.version, body: update.body,
      download: progress => update.download(progress, { timeout: 120_000 }),
      install: () => update.install({ restartAfterInstall: true }),
      close: () => update.close(),
    }
  },
}
