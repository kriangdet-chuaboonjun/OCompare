import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { packageRelease, validateRelease } from './release-artifacts.mjs'

test('packages immutable release links and validates every checksum before publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ocompare-release-'))
  try {
    await mkdir(join(root, 'src-tauri/target/release/installer'), { recursive: true })
    await mkdir(join(root, 'src-tauri/explorer'), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.4.5' }))
    await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.4.5', plugins: { updater: { pubkey: 'test-public-key' } } }))
    await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.4.5"\n')
    await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [0.4.5] - 2026-10-26\n\n- Online updates.\n')
    await writeFile(join(root, 'src-tauri/target/release/o-compare-rust.exe'), 'portable fixture')
    const setup = join(root, 'src-tauri/target/release/installer/OCompare-0.4.5-x64-setup.exe')
    await writeFile(setup, 'setup fixture'); await writeFile(setup + '.sig', 'signature-fixture')
    await packageRelease(root)
    const manifest = JSON.parse(await readFile(join(root, 'release/latest.json'), 'utf8'))
    assert.equal(manifest.version, '0.4.5')
    assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/kriangdet-chuaboonjun/OCompare/releases/download/v0.4.5/OCompare-0.4.5-x64-setup.exe')
    assert.equal(manifest.platforms['windows-x86_64'].signature, 'signature-fixture')
    assert.match(manifest.notes, /Online updates/)
    const files = await validateRelease(root)
    assert.equal(files.length, 5)
    await writeFile(join(root, 'release/OCompare-0.4.5-x64-setup.exe'), 'corrupted')
    await assert.rejects(validateRelease(root), /checksum/i)
    await writeFile(join(root, 'release/OCompare-0.4.5-x64-setup.exe'), 'setup fixture')
    manifest.platforms['windows-x86_64'].url = 'https://example.com/substituted.exe'
    const encoded = JSON.stringify(manifest)
    await writeFile(join(root, 'release/latest.json'), encoded)
    let sums = await readFile(join(root, 'release/SHA256SUMS.txt'), 'utf8')
    sums = sums.replace(/^[a-f0-9]+  latest.json$/m, `${createHash('sha256').update(encoded).digest('hex')}  latest.json`)
    await writeFile(join(root, 'release/SHA256SUMS.txt'), sums)
    await assert.rejects(validateRelease(root), /manifest/i)
    await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.4.4"\n')
    await assert.rejects(packageRelease(root), /version/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})
