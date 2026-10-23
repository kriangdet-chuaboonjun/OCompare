import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('release', { recursive: true })
const files = [
  [`src-tauri/target/release/o-compare-rust.exe`, `OCompare-${version}-portable.exe`],
  [`src-tauri/target/release/bundle/nsis/OCompare_${version}_x64-setup.exe`, `OCompare-${version}-x64-setup.exe`]
]
const hashes = []
for (const [from, name] of files) {
  const dest = resolve('release', name)
  await copyFile(from, dest)
  hashes.push(`${createHash('sha256').update(await readFile(dest)).digest('hex')}  ${name}`)
  console.log(dest)
}
await writeFile('release/SHA256SUMS.txt', hashes.join('\n') + '\n')
// Keep the integration test installation independent of the single-file portable build.
await mkdir('release/explorer-integration/resources', { recursive: true })
await copyFile('src-tauri/target/release/o-compare-rust.exe', 'release/explorer-integration/o-compare-rust.exe')
await cp('src-tauri/explorer', 'release/explorer-integration/resources/explorer', { recursive: true })
