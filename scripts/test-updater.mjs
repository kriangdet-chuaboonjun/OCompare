import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UpdateController } from '../src/shared/updater.ts'

// Native downloads and process exit are external side effects: inject only this boundary.
function fixture(options = {}) {
  const events = [], states = []
  let downloads = 0, installs = 0, checks = 0, releases = 0
  const update = {
    version: options.version ?? '0.4.6', body: 'Fix comparison issues',
    async download(progress) {
      downloads++; events.push('download')
      progress({ event: 'Started', data: { contentLength: 100 } })
      progress({ event: 'Progress', data: { chunkLength: 25 } })
      if (options.downloadError) throw new Error(options.downloadError)
      progress({ event: 'Progress', data: { chunkLength: 75 } })
      progress({ event: 'Finished' })
    },
    async install() { installs++; events.push('install'); if (options.installError) throw new Error(options.installError) },
    async close() { releases++ },
  }
  const controller = new UpdateController('0.4.5', {
    async check() { checks++; if (options.checkError) throw new Error(options.checkError); return options.none ? null : update },
  }, {
    async prepare() { events.push('prepare'); await options.prepare?.(); return options.allowed !== false },
    release() { events.push('unlock') },
  }, state => states.push({ ...state }))
  return { controller, events, states, counts: () => ({ downloads, installs, checks, releases }) }
}

test('startup check offers a newer stable version without downloading', async () => {
  const f = fixture(); await f.controller.check(false)
  assert.equal(f.controller.state.phase, 'available'); assert.equal(f.controller.state.visible, false)
  assert.equal(f.controller.state.version, '0.4.6'); assert.equal(f.counts().downloads, 0)
  f.controller.show(); assert.equal(f.controller.state.visible, true)
})
test('equal, older, prerelease and malformed versions are never offered', async () => {
  for (const version of ['0.4.5', '0.4.4', '0.4.6-beta.1', 'not-a-version']) {
    const f = fixture({ version }); await f.controller.check(true)
    assert.equal(f.controller.state.phase, 'current', version); await f.controller.install()
    assert.equal(f.counts().installs, 0)
  }
})
test('no update and check errors stay quiet automatically but manual checks are visible', async () => {
  for (const options of [{ none: true }, { checkError: 'timeout' }, { checkError: 'invalid JSON' }]) {
    const f = fixture(options); await f.controller.check(false)
    assert.equal(f.controller.state.visible, false); assert.equal(f.counts().downloads, 0)
    await f.controller.check(true); assert.equal(f.controller.state.visible, true)
    assert.equal(f.controller.state.phase, options.none ? 'current' : 'error')
  }
})
test('duplicate checks and install clicks cannot start parallel operations', async () => {
  let resume; const waiting = new Promise(resolve => { resume = resolve })
  const f = fixture({ prepare: () => waiting }); await Promise.all([f.controller.check(true), f.controller.check(true)])
  assert.equal(f.counts().checks, 1)
  const task = f.controller.install(); await Promise.resolve(); await f.controller.install(); resume(); await task
  assert.equal(f.counts().downloads, 1); assert.equal(f.counts().installs, 1)
  assert.deepEqual(f.events, ['download', 'prepare', 'install', 'unlock'])
  assert(f.states.some(s => s.downloaded === 25 && s.total === 100))
})
test('a cancelled/failed save or busy folder job never invokes native install', async () => {
  const f = fixture({ allowed: false }); await f.controller.check(true); await f.controller.install()
  assert.equal(f.counts().installs, 0); assert.equal(f.controller.state.phase, 'ready')
  assert.deepEqual(f.events, ['download', 'prepare', 'unlock'])
  await f.controller.install(); assert.equal(f.counts().downloads, 1)
})
test('download signature/network failure never prepares or closes the workspace', async () => {
  const f = fixture({ downloadError: 'signature verification failed' })
  await f.controller.check(true); await f.controller.install()
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.counts().installs, 0)
  assert.deepEqual(f.events, ['download']); assert.match(f.controller.state.message, /signature/)
})
test('installation errors release workspace lock and allow retry', async () => {
  const f = fixture({ installError: 'UAC declined' }); await f.controller.check(true); await f.controller.install()
  assert.equal(f.controller.state.phase, 'error'); assert.equal(f.events.at(-1), 'unlock')
  await f.controller.install(); assert.equal(f.counts().downloads, 1); assert.equal(f.counts().installs, 2)
})
