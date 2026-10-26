import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { releaseInfo, validateRelease } from './release-artifacts.mjs'

const info = await releaseInfo(); await validateRelease()
const executable = resolve('src-tauri/target/debug/examples/verify-update.exe')
const setup = join(info.directory, info.names[1]), signature = join(info.directory, info.names[2])
const verify = (artifact, sig, config = 'src-tauri/tauri.conf.json') => spawnSync(executable, [config, artifact, sig], { encoding: 'utf8', windowsHide: true })
const temp = await mkdtemp(join(tmpdir(), 'ocompare-signature-'))
try {
  assert.equal(verify(setup, signature).status, 0, 'actual release signature must verify')
  const mismatchedConfig = join(temp, 'version-mismatch.json')
  const differentVersion = info.version === '0.0.0' ? '0.0.1' : '0.0.0'
  await writeFile(mismatchedConfig, JSON.stringify({ ...info.config, version: differentVersion }))
  assert.notEqual(verify(setup, signature, mismatchedConfig).status, 0, 'valid signature for another release version must fail')
  const corrupted = join(temp, 'corrupted.exe'), bytes = await readFile(setup); bytes[bytes.length - 1] ^= 1
  await writeFile(corrupted, bytes)
  assert.notEqual(verify(corrupted, signature).status, 0, 'modified installer must fail signature verification')
  const invalid = join(temp, 'invalid.sig'); await writeFile(invalid, Buffer.from('invalid signature').toString('base64'))
  assert.notEqual(verify(setup, invalid).status, 0, 'malformed signature must fail')
  console.log('PASS: signed installer verified; mismatched signed version, modified installer and invalid signature rejected')
} finally { await rm(temp, { recursive: true, force: true }) }
