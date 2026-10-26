import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

export const repository = 'kriangdet-chuaboonjun/OCompare'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))

/** Refuse mixed-version builds before packaging or publishing any files. */
export async function releaseInfo(root = process.cwd()) {
  const { version } = await json(join(root, 'package.json'))
  const config = await json(join(root, 'src-tauri/tauri.conf.json'))
  const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8')
  const cargoVersion = cargo.split(/\n\[/)[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1]
  if (!/^\d+\.\d+\.\d+$/.test(version) || config.version !== version || cargoVersion !== version) throw new Error('Release version must be stable and match package.json, Cargo.toml and tauri.conf.json')
  const names = [`OCompare-${version}-portable.exe`, `OCompare-${version}-x64-setup.exe`, `OCompare-${version}-x64-setup.exe.sig`, 'latest.json']
  const url = `https://github.com/${repository}/releases/download/v${version}/${names[1]}`
  return { version, config, names, url, directory: resolve(root, 'release') }
}

/** Publishable artifacts reference the immutable version tag, never latest/download. */
export async function packageRelease(root = process.cwd()) {
  const info = await releaseInfo(root), { version, names, directory, url } = info
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')
  const heading = `## [${version}]`
  if (!changelog.includes(heading)) throw new Error(`Missing changelog for ${version}`)
  const notes = changelog.split(heading)[1].split('\n').slice(1).join('\n').split('\n## ')[0].trim()
  if (!notes) throw new Error('Release notes cannot be empty')
  const setup = join(root, `src-tauri/target/release/bundle/nsis/OCompare_${version}_x64-setup.exe`)
  const signature = (await readFile(setup + '.sig', 'utf8')).trim()
  if (!signature) throw new Error('Missing updater signature')
  await mkdir(directory, { recursive: true })
  await copyFile(join(root, 'src-tauri/target/release/o-compare-rust.exe'), join(directory, names[0]))
  await copyFile(setup, join(directory, names[1]))
  await writeFile(join(directory, names[2]), signature + '\n')
  await writeFile(join(directory, 'latest.json'), JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms: { 'windows-x86_64': { url, signature } } }, null, 2) + '\n')
  const hashes = await Promise.all(names.map(async name => `${sha256(await readFile(join(directory, name)))}  ${name}`))
  await writeFile(join(directory, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
  await mkdir(join(directory, 'explorer-integration/resources'), { recursive: true })
  await copyFile(join(root, 'src-tauri/target/release/o-compare-rust.exe'), join(directory, 'explorer-integration/o-compare-rust.exe'))
  await cp(join(root, 'src-tauri/explorer'), join(directory, 'explorer-integration/resources/explorer'), { recursive: true })
  return validateRelease(root)
}

/** Validate the manifest and exact checksum inventory before creating a GitHub draft. */
export async function validateRelease(root = process.cwd()) {
  const { version, names, directory, url } = await releaseInfo(root)
  const sums = (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)
  if (sums.length !== names.length) throw new Error('Invalid checksum inventory')
  for (const name of names) {
    const expected = `${sha256(await readFile(join(directory, name)))}  ${name}`
    if (sums.filter(line => line === expected).length !== 1) throw new Error(`Invalid checksum: ${name}`)
  }
  const manifest = await json(join(directory, 'latest.json'))
  const platform = manifest.platforms?.['windows-x86_64']
  const signature = (await readFile(join(directory, names[2]), 'utf8')).trim()
  if (manifest.version !== version || !manifest.notes || !Number.isFinite(Date.parse(manifest.pub_date)) || Object.keys(manifest.platforms ?? {}).length !== 1 || platform?.url !== url || !signature || platform?.signature !== signature) throw new Error('Invalid update manifest')
  return [...names, 'SHA256SUMS.txt'].map(name => join(directory, name))
}
