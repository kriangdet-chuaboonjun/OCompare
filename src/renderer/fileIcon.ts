const SVG_NS = 'http://www.w3.org/2000/svg'
const page = 'M14 3H5v18h14V8h-5V3Zm0 0 5 5'
const icons: Record<string, string> = {
  file: page,
  text: `${page}M8 12h8M8 16h6`,
  code: `${page}M10 12l-3 3 3 3m4-6 3 3-3 3`,
  config: `${page}M8 12h8M8 16h8M10 11v2m4 2v2`,
  database: 'M20 6c0 2-16 2-16 0s16-2 16 0Zm-16 0v12c0 3 16 3 16 0V6M4 12c0 3 16 3 16 0',
  image: `${page}M7 18l4-5 3 3 2-2 3 4M9 9h.01`,
  archive: `${page}M11 9h2m-2 3h2m-2 3h2m-2 3h2`,
  pdf: `${page}M8 17c4-6 3-8 2-6s0 5 6 5c-3-2-6-1-8 1Z`,
  document: `${page}M8 11h8M8 14h8M8 17h5`,
  spreadsheet: `${page}M7 11h10v7H7v-7Zm0 3h10m-6-3v7`,
  presentation: `${page}M7 11h10v6H7v-6Zm5 6v3m-3 0h6`,
  audio: `${page}M14 11v6m0-6 3-1M14 17c0 2-5 2-5 0s5-2 5 0Z`,
  video: `${page}M10 11v7l6-3.5-6-3.5Z`,
  executable: `${page}M8 12l3 3-3 3m5 0h3`,
  font: `${page}M8 18l4-8 4 8m-6-3h4`,
  link: 'M10 14l4-4m-6 6-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 6a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-1 1'
}
const extensions: Record<string, string> = {}
for (const [kind, names] of Object.entries({
  text: 'txt log md markdown rst rtf',
  code: 'ts tsx js jsx mjs cjs html htm css scss sass less vue svelte rs py pyw cs fs vb c h cpp hpp cc java kt kts go php rb swift dart lua pl r sh bash ps1 bat cmd',
  config: 'json jsonc yaml yml toml xml ini cfg conf env props csproj fsproj vbproj sln lock',
  database: 'sql db sqlite sqlite3 mdb accdb bak',
  image: 'png jpg jpeg gif bmp webp svg ico tif tiff avif heic psd',
  archive: 'zip 7z rar tar gz bz2 xz tgz zst cab iso',
  pdf: 'pdf',
  document: 'doc docx odt pages',
  spreadsheet: 'xls xlsx xlsm csv tsv ods numbers',
  presentation: 'ppt pptx odp key',
  audio: 'mp3 wav flac aac ogg m4a wma opus',
  video: 'mp4 mkv avi mov wmv webm m4v mpg mpeg',
  executable: 'exe dll msi com wasm',
  font: 'ttf otf woff woff2'
})) {
  for (const extension of names.split(' ')) extensions[extension] = kind
}

/** Local vector icons inherit comparison status colors; unknown extensions use a plain file. */
export function createFileIcon(name: string, isLink = false): SVGSVGElement {
  const normalized = name.toLowerCase()
  const extension = normalized.includes('.') ? normalized.slice(normalized.lastIndexOf('.') + 1) : ''
  const kind = isLink ? 'link' : extensions[extension] ?? (['dockerfile', 'makefile', 'license', 'readme', '.gitignore', '.gitattributes', '.editorconfig'].includes(normalized) ? 'text' : 'file')
  const icon = document.createElementNS(SVG_NS, 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  icon.dataset.fileKind = kind
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', icons[kind])
  icon.append(path)
  return icon
}
