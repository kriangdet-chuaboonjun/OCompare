import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

/** Stream curl progress without placing the GitHub credential in argv, files, or logs. */
export async function uploadFile({ url, file, token, onProgress = () => {}, timeoutSeconds = 1800 }) {
  const size = (await stat(file)).size
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('Invalid GitHub credential format')
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--config', '-', '--http1.1', '--request', 'POST', '--header', 'Content-Type: application/octet-stream',
      '--data-binary', `@${file}`, '--connect-timeout', '15', '--max-time', String(timeoutSeconds),
      '--speed-limit', '1', '--speed-time', '300', '--show-error', '--progress-meter', '--fail-with-body',
      '--write-out', '\nUPLOAD_STATUS:%{http_code}', url,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', pendingProgress = '', lastReported = -1, lastReportTime = 0
    const report = percent => {
      const now = Date.now()
      if (percent !== lastReported && (percent === 100 || now - lastReportTime >= 10_000)) {
        lastReported = percent; lastReportTime = now; onProgress(percent, size)
      }
    }
    const stop = () => child.kill()
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    child.on('error', error => reject(new Error(`Cannot start upload transport: ${error.code ?? 'unknown error'}`)))
    child.stdout.on('data', data => {
      stdout += data.toString()
      if (stdout.length > 2 * 1024 * 1024) child.kill()
    })
    child.stderr.on('data', data => {
      pendingProgress += data.toString()
      const lines = pendingProgress.split(/[\r\n]/); pendingProgress = lines.pop() ?? ''
      for (const line of lines) {
        const match = /^\s*\d+\s+\S+\s+\d+\s+\S+\s+(\d+)\s/.exec(line)
        if (match) report(Math.min(100, Number(match[1])))
      }
      if (pendingProgress.length > 8192) pendingProgress = ''
    })
    child.on('close', code => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
      const marker = stdout.lastIndexOf('\nUPLOAD_STATUS:')
      const status = Number(stdout.slice(marker + '\nUPLOAD_STATUS:'.length))
      if (code !== 0 || marker < 0 || status !== 201) {
        reject(new Error(`Upload ${basename(file)} failed (curl ${code ?? 'interrupted'}, HTTP ${Number.isInteger(status) ? status : 'unknown'}); draft retained`))
        return
      }
      try {
        const asset = JSON.parse(stdout.slice(0, marker))
        if (asset.state !== 'uploaded' || asset.name !== basename(file) || asset.size !== size) throw new Error('incomplete asset')
        report(100); resolve(asset)
      } catch { reject(new Error(`Invalid upload response for ${basename(file)}; draft retained`)) }
    })
    // Config is supplied only on stdin. curl does not follow upload redirects.
    child.stdin.on('error', () => {})
    child.stdin.end(`header = ${JSON.stringify(`Authorization: Bearer ${token}`)}\n`)
  })
}

/** Reuse verified complete assets; remove only unfinished placeholders in the selected draft. */
export async function syncDraftAssets(release, files, api) {
  if (!release.draft) throw new Error('Only draft releases can be synchronized')
  const assets = await api.listAssets()
  const expected = new Set(files.map(file => basename(file)))
  if (assets.some(asset => !expected.has(asset.name))) throw new Error('Draft contains unexpected assets; inspect it before resuming')
  const pending = []
  for (const file of files) {
    const matches = assets.filter(asset => asset.name === basename(file))
    if (matches.length > 1) throw new Error(`Duplicate draft assets: ${basename(file)}`)
    const asset = matches[0]
    if (asset?.state === 'uploaded') await api.verify(asset, file)
    else {
      if (asset && asset.state !== 'starter') throw new Error(`Unexpected asset state: ${asset.name}`)
      pending.push({ file, asset })
    }
  }
  // Two concurrent uploads reduce per-file waiting while keeping network usage bounded.
  let next = 0, failure
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
    while (!failure && next < pending.length) {
      const { file, asset } = pending[next++]
      try {
        if (asset) await api.removeIncomplete(asset)
        await api.upload(file)
      } catch (error) { failure ??= error }
    }
  }))
  if (failure) throw failure
  const uploaded = await api.listAssets()
  if (uploaded.length !== files.length) throw new Error('Draft asset inventory differs from local release')
  for (const file of files) {
    const asset = uploaded.find(asset => asset.name === basename(file) && asset.state === 'uploaded')
    if (!asset) throw new Error(`Missing uploaded file: ${basename(file)}`)
    await api.verify(asset, file)
  }
}
