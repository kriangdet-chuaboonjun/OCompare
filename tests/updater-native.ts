import type { UpdaterApi } from '../src/shared/updater'

// Native install exits Windows processes; only this external boundary is substituted.
declare global { interface Window { updateDownloads: number; updateInstalls: number } }
window.updateDownloads = 0; window.updateInstalls = 0
export const updaterApi: UpdaterApi = {
  async check() {
    return {
      version: '99.0.0', body: 'Integration test release',
      async download(progress) {
        window.updateDownloads++
        progress({ event: 'Started', data: { contentLength: 100 } })
        progress({ event: 'Progress', data: { chunkLength: 100 } })
        progress({ event: 'Finished' })
      },
      async install() { window.updateInstalls++ },
      async close() {},
    }
  },
}
