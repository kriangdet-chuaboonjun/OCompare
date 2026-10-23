import type { FolderEntry, FolderStatus } from '../shared/folders'

/** แสดง ancestors ของผลกรอง และใช้ collapse ร่วมกันทั้งซ้าย/ขวา */
export function visibleFolderEntries(entries: FolderEntry[], statuses: Set<FolderStatus>, collapsed: Set<string>): FolderEntry[] {
  const parents = new Set(entries.filter(e => e.relativePath.includes('/')).map(e => e.relativePath.slice(0, e.relativePath.lastIndexOf('/'))))
  const included = new Set<string>()
  for (const entry of entries) {
    const file = entry.left?.kind === 'file' || entry.right?.kind === 'file'
    const direct = file || entry.kind !== 'directory' || !parents.has(entry.relativePath) || entry.error !== null
    if (!direct || !statuses.has(entry.status)) continue
    let path = entry.relativePath
    while (path) {
      included.add(path)
      const slash = path.lastIndexOf('/')
      path = slash < 0 ? '' : path.slice(0, slash)
    }
  }
  return entries.filter(entry => {
    if (!included.has(entry.relativePath)) return false
    let path = entry.relativePath
    while (path.includes('/')) {
      path = path.slice(0, path.lastIndexOf('/'))
      if (collapsed.has(path)) return false
    }
    return true
  })
}
