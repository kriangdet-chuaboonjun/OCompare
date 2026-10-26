import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseInfo, validateRelease, repository } from './release-artifacts.mjs'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

try {
  const info = await releaseInfo(), files = await validateRelease()
  const tag = `v${info.version}`
  const manifest = JSON.parse(await readFile(join(info.directory, 'latest.json'), 'utf8'))
  // Verify with the same minisign implementation used by Tauri, before upload.
  run('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/Cargo.toml', '--no-default-features', '--example', 'verify-update', '--', 'src-tauri/tauri.conf.json', files[1], files[2]])
  if (process.argv.includes('--dry-run')) {
    console.log(`Validated ${tag}: ${files.length} artifacts, checksums and updater signature. No upload performed.`)
  } else {
    const target = run('git', ['rev-parse', 'HEAD'])
    if (run('git', ['status', '--porcelain'])) throw new Error('Commit release changes before publishing')
    const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0]
    if (remote !== target) throw new Error('Push the tested release commit to origin/main before publishing')
    const repo = JSON.parse(run('gh', ['repo', 'view', repository, '--json', 'visibility']))
    if (repo.visibility !== 'PUBLIC') throw new Error('Release repository must be public')
    const releases = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat()
    if (releases.some(release => release.tag_name === tag)) throw new Error(`Release ${tag} already exists; it will not be overwritten`)
    const temp = await mkdtemp(join(tmpdir(), 'ocompare-publish-'))
    try {
      const notesFile = join(temp, 'notes.md'); await writeFile(notesFile, manifest.notes)
      run('gh', ['release', 'create', tag, ...files, '--repo', repository, '--target', target, '--title', `OCompare ${info.version}`, '--notes-file', notesFile, '--draft'])
      // Draft tags are not exposed by GitHub's get-release-by-tag endpoint yet.
      const drafts = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).flat()
      const release = drafts.find(release => release.tag_name === tag && release.draft)
      if (!release) throw new Error(`Draft ${tag} could not be found after upload`)
      // Verify uploaded bytes while the release is still a draft.
      for (const file of files) {
        const name = file.split(/[\\/]/).at(-1), asset = release.assets.find(asset => asset.name === name)
        if (!asset) throw new Error(`Draft upload missing ${name}; draft retained`)
        const result = spawnSync('gh', ['api', '-H', 'Accept: application/octet-stream', `repos/${repository}/releases/assets/${asset.id}`], { windowsHide: true, maxBuffer: 512 * 1024 * 1024 })
        if (result.status !== 0 || !Buffer.from(result.stdout ?? '').equals(await readFile(file))) throw new Error(`Draft verification failed: ${name}; draft retained`)
      }
      run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'])
      console.log(`Published https://github.com/${repository}/releases/tag/${tag}`)
    } finally { await rm(temp, { recursive: true, force: true }) }
  }
} catch (error) { console.error(`Publication stopped: ${error.message}`); process.exitCode = 1 }
