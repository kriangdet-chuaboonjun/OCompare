import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { releaseInfo, validateRelease, repository } from './release-artifacts.mjs'
import { syncDraftAssets, uploadFile } from './release-upload.mjs'

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(command === 'gh' && args[0] === 'auth'
    ? 'GitHub authentication unavailable; sign in with gh auth login'
    : `${command} ${args[0]} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

try {
  const flags = new Set(process.argv.slice(2))
  if ([...flags].some(flag => !['--dry-run', '--resume-draft', '--help'].includes(flag))) throw new Error('Unknown option. Use --help for supported options.')
  if (flags.has('--help')) {
    console.log('Usage: npm run publish:release -- [--dry-run | --resume-draft]\n--dry-run: validate local artifacts without GitHub writes\n--resume-draft: continue a draft for the exact current source commit; never overwrite complete assets')
    process.exit(0)
  }
  process.chdir(resolve(import.meta.dirname, '..'))
  const info = await releaseInfo(), files = await validateRelease()
  const tag = `v${info.version}`
  const checksumSnapshot = await readFile(join(info.directory, 'SHA256SUMS.txt'), 'utf8')
  const manifest = JSON.parse(await readFile(join(info.directory, 'latest.json'), 'utf8'))
  // Verify with the same minisign implementation used by Tauri, before upload.
  run('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/Cargo.toml', '--no-default-features', '--example', 'verify-update', '--', 'src-tauri/tauri.conf.json', files[1], files[2]])
  if (flags.has('--dry-run')) {
    console.log(`Validated ${tag}: ${files.length} artifacts, checksums and updater signature. No upload performed.`)
  } else {
    const target = run('git', ['rev-parse', 'HEAD'])
    if (run('git', ['status', '--porcelain'])) throw new Error('Commit release changes before publishing')
    const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0]
    if (remote !== target) throw new Error('Push the tested release commit to origin/main before publishing')
    const existingTag = run('git', ['ls-remote', 'origin', `refs/tags/${tag}`]).split(/\s/)[0]
    if (existingTag && existingTag !== target) throw new Error(`Tag ${tag} targets another commit; it will not be changed`)
    const repositoryUrl = `https://github.com/${repository}`
    const repo = JSON.parse(run('gh', ['repo', 'view', repositoryUrl, '--json', 'visibility']))
    if (repo.visibility !== 'PUBLIC') throw new Error('Release repository must be public')
    const api = (path, ...options) => JSON.parse(run('gh', ['api', '--hostname', 'github.com', ...options, `repos/${repository}/${path}`]))
    const listReleases = () => api('releases?per_page=100', '--paginate', '--slurp').flat()
    let release = listReleases().find(release => release.tag_name === tag)
    if (release && !release.draft) throw new Error(`Release ${tag} already exists; it will not be overwritten`)
    if (release && !flags.has('--resume-draft')) throw new Error(`Draft ${tag} exists. Inspect it, then use --resume-draft to continue`)
    if (!release && flags.has('--resume-draft')) throw new Error(`No draft ${tag} exists; omit --resume-draft to create one`)
    if (release && release.target_commitish !== target) throw new Error('Draft belongs to a different source commit; refusing to resume')
    run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--version'])
    // The token stays in memory and goes to curl only over stdin, never argv or files.
    const token = run('gh', ['auth', 'token', '--hostname', 'github.com'])
    const temp = await mkdtemp(join(tmpdir(), 'ocompare-publish-'))
    try {
      if (!release) {
        const notesFile = join(temp, 'notes.md'); await writeFile(notesFile, manifest.notes)
        run('gh', ['release', 'create', tag, '--repo', repositoryUrl, '--target', target, '--title', `OCompare ${info.version}`, '--notes-file', notesFile, '--draft'])
        // Draft tags are not exposed by GitHub's get-release-by-tag endpoint.
        release = listReleases().find(release => release.tag_name === tag && release.draft)
      }
      if (!release || release.target_commitish !== target) throw new Error(`Draft ${tag} is missing or has a different source commit`)
      console.log(`Draft: https://github.com/${repository}/releases (ID ${release.id})`)
      const assertDraft = () => {
        const current = api(`releases/${release.id}`)
        if (!current.draft || current.target_commitish !== target) throw new Error('Draft changed during upload; publication stopped')
      }
      await syncDraftAssets(release, files, {
        listAssets: async () => api(`releases/${release.id}/assets?per_page=100`, '--paginate', '--slurp').flat(),
        removeIncomplete: async asset => {
          assertDraft()
          run('gh', ['api', '--hostname', 'github.com', '--method', 'DELETE', `repos/${repository}/releases/assets/${asset.id}`])
          console.log(`Retrying incomplete upload: ${asset.name}`)
        },
        upload: async file => {
          assertDraft()
          return uploadFile({
            url: `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(basename(file))}`,
            file, token,
            onProgress: (percent, size) => console.log(`${basename(file)}: ${percent}% of ${(size / 1024 / 1024).toFixed(2)} MiB`),
          })
        },
        verify: async (asset, file) => {
          console.log(`Verifying ${asset.name}…`)
          const expected = await readFile(file)
          if (asset.size !== expected.length) throw new Error(`Uploaded size differs: ${asset.name}`)
          const response = await fetch(`https://api.github.com/repos/${repository}/releases/assets/${asset.id}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream', 'User-Agent': 'OCompare-release' },
            signal: AbortSignal.timeout(30 * 60_000),
          })
          if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(expected)) throw new Error(`Uploaded bytes differ: ${asset.name}; draft retained`)
        },
      })
      await validateRelease() // Detect accidental local artifact changes during a slow upload.
      if (await readFile(join(info.directory, 'SHA256SUMS.txt'), 'utf8') !== checksumSnapshot) throw new Error('Local release artifacts changed during upload; draft retained')
      assertDraft()
      run('gh', ['release', 'edit', tag, '--repo', repositoryUrl, '--draft=false', '--latest'])
      console.log(`Published https://github.com/${repository}/releases/tag/${tag}`)
    } finally { await rm(temp, { recursive: true, force: true }) }
  }
} catch (error) {
  console.error(`Publication stopped: ${error.message}`)
  console.error('If a draft was created, keep the same source commit and artifacts, then retry with: npm run publish:release -- --resume-draft')
  process.exitCode = 1
}
