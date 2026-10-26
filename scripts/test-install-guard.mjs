import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WorkspaceInstallGuard } from '../src/shared/installGuard.ts'

test('busy folder jobs are refused without locking or resolving edits', async () => {
  const events = []
  const guard = new WorkspaceInstallGuard({ busy: () => true, lock: v => events.push(v), settle: async () => {}, resolveUnsaved: async () => { throw new Error('must not prompt') } })
  assert.equal(await guard.prepare(), false); guard.release(); assert.deepEqual(events, [])
})
test('locks before draining pending actions and keeps the lock until explicit release', async () => {
  const events = []
  const guard = new WorkspaceInstallGuard({ busy: () => false, lock: v => events.push(v ? 'lock' : 'unlock'), settle: async () => { events.push('settle') }, resolveUnsaved: async () => { events.push('save'); return true } })
  assert.equal(await guard.prepare(), true); assert.deepEqual(events, ['lock', 'settle', 'save'])
  guard.release(); assert.deepEqual(events, ['lock', 'settle', 'save', 'unlock'])
})
test('a folder job started by an already pending action prevents installation', async () => {
  let busy = false, asked = false
  const guard = new WorkspaceInstallGuard({ busy: () => busy, lock: () => {}, settle: async () => { busy = true }, resolveUnsaved: async () => { asked = true; return true } })
  assert.equal(await guard.prepare(), false); assert.equal(asked, false); guard.release()
})
test('cancel, failed save and errors all release the workspace lock', async () => {
  for (const fail of [false, new Error('save failed')]) {
    const events = []
    const guard = new WorkspaceInstallGuard({ busy: () => false, lock: v => events.push(v), settle: async () => {}, resolveUnsaved: async () => { if (fail) throw fail; return false } })
    try { assert.equal(await guard.prepare(), false) } catch (error) { assert.equal(error, fail) } finally { guard.release() }
    assert.deepEqual(events, [true, false])
  }
})
