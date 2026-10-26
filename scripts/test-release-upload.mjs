import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { syncDraftAssets, uploadFile } from './release-upload.mjs'

test('help works outside the project and unknown flags stop before release operations', () => {
  const script = fileURLToPath(new URL('./publish-release.mjs', import.meta.url))
  const help = spawnSync(process.execPath, [script, '--help'], { cwd: tmpdir(), encoding: 'utf8', windowsHide: true })
  assert.equal(help.status, 0); assert.match(help.stdout, /--resume-draft/)
  const invalid = spawnSync(process.execPath, [script, '--publsih'], { cwd: tmpdir(), encoding: 'utf8', windowsHide: true })
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Unknown option/)
})

test('resume verifies complete files and retries only missing/incomplete uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ocompare-upload-'))
  try {
    const files = ['portable.exe', 'setup.exe', 'latest.json'].map(name => join(root, name))
    for (const file of files) await writeFile(file, `bytes for ${basename(file)}`)
    const assets = [{ id: 1, name: 'portable.exe', state: 'uploaded' }, { id: 2, name: 'setup.exe', state: 'starter' }]
    const uploaded = [], removed = [], checked = []
    const api = {
      async listAssets() { return [...assets] },
      async verify(asset, file) { checked.push(asset.name); assert.equal(await readFile(file, 'utf8'), `bytes for ${asset.name}`) },
      async removeIncomplete(asset) { removed.push(asset.name); assets.splice(assets.findIndex(a => a.id === asset.id), 1) },
      async upload(file) { const name = basename(file); uploaded.push(name); assets.push({ id: assets.length + 10, name, state: 'uploaded' }) },
    }
    await assert.rejects(syncDraftAssets({ draft: false }, files, api), /draft/i)
    await syncDraftAssets({ draft: true }, files, api)
    assert.deepEqual(removed, ['setup.exe'])
    assert.deepEqual(uploaded.sort(), ['latest.json', 'setup.exe'])
    assert(checked.includes('portable.exe')); assert(checked.includes('setup.exe')); assert(checked.includes('latest.json'))
    uploaded.length = 0; removed.length = 0
    await syncDraftAssets({ draft: true }, files, api)
    assert.deepEqual(uploaded, []); assert.deepEqual(removed, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('mismatched complete assets stop resume before any upload or removal', async () => {
  const mutations = []
  const api = {
    async listAssets() { return [{ id: 1, name: 'setup.exe', state: 'uploaded' }] },
    async verify() { throw new Error('Uploaded bytes differ') },
    async removeIncomplete() { mutations.push('remove') }, async upload() { mutations.push('upload') },
  }
  await assert.rejects(syncDraftAssets({ draft: true }, ['setup.exe', 'latest.json'], api), /bytes differ/)
  assert.deepEqual(mutations, [])
})

test('failed uploads cannot complete the draft synchronization', async () => {
  const api = {
    async listAssets() { return [] }, async verify() {}, async removeIncomplete() {},
    async upload() { throw new Error('connection lost') },
  }
  await assert.rejects(syncDraftAssets({ draft: true }, ['setup.exe'], api), /connection lost/)
})

test('curl uploads real bytes, reports progress, and keeps credentials out of errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ocompare-curl-'))
  const bytes = Buffer.alloc(128 * 1024, 0x42), file = join(root, 'fixture.exe')
  await writeFile(file, bytes)
  let received
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    received = Buffer.concat(chunks)
    assert.equal(request.headers.authorization, 'Bearer test-credential-do-not-log')
    if (request.url === '/hang') return
    response.writeHead(request.url === '/fail' ? 502 : 201, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id: 42, name: 'fixture.exe', state: 'uploaded', size: received.length }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const progress = []
    const asset = await uploadFile({ url, file, token: 'test-credential-do-not-log', onProgress: value => progress.push(value) })
    assert.equal(asset.id, 42); assert.deepEqual(received, bytes); assert(progress.includes(100))
    await assert.rejects(uploadFile({ url: url + '/fail', file, token: 'test-credential-do-not-log' }), error => !error.message.includes('test-credential') && /502/.test(error.message))
    await assert.rejects(uploadFile({ url: url + '/hang', file, token: 'test-credential-do-not-log', timeoutSeconds: 1 }), /curl 28/)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }
})

test('uploads run with at most two active requests', async () => {
  const assets = []; let active = 0, maximum = 0
  await syncDraftAssets({ draft: true }, ['a.exe', 'b.exe', 'c.exe', 'latest.json', 'SHA256SUMS.txt'], {
    async listAssets() { return [...assets] }, async verify() {}, async removeIncomplete() {},
    async upload(file) {
      active++; maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      assets.push({ id: assets.length + 1, name: file, state: 'uploaded' }); active--
    },
  })
  assert.equal(maximum, 2)
})
