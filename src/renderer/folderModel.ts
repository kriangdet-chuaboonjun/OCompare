import type { FolderEntry, FolderViewOptions, FolderStatus } from '../shared/folders'

export const allStatuses: FolderStatus[] = [
  'identical',
  'minor',
  'different',
  'left-only',
  'right-only',
  'error',
  'skipped',
]
export const defaultViewOptions = (): FolderViewOptions => ({
  include: '*.*',
  exclude: '',
  structure: 'tree',
  peek: false,
  showMinor: true,
  statuses: [...allStatuses],
  sort: 'name',
  sortSide: 'left',
  descending: false,
  split: 50,
  columns: [88, 156, 88, 156],
})

function glob(pattern: string): RegExp {
  let result = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      result += '.*'
      i++
    } else if (c === '*') result += '[^/]*'
    else if (c === '?') result += '[^/]'
    else result += /[\\^$+?.()|{}\[\]]/.test(c) ? `\\${c}` : c
  }
  return new RegExp(`^${result}$`, 'i')
}

/** Windows-style masks are view filters, never filesystem paths. */
export function matchesName(path: string, include: string, exclude: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const matches = (patterns: string) =>
    patterns
      .split(';')
      .map((p) => p.trim().replaceAll('\\', '/'))
      .filter(Boolean)
      .some((p) => {
        if (p === '*.*') p = '*'
        const value = p.includes('/') ? path : name
        return glob(p).test(value) || (p.endsWith('/**') && glob(p.slice(0, -3)).test(path))
      })
  return (!include.trim() || matches(include)) && !matches(exclude)
}

export interface ProjectedRow {
  entry: FolderEntry
  hidden: boolean
}
/** One ordering/projection supplies both panes, keeping virtualized rows aligned. */
export function projectRows(
  entries: FolderEntry[],
  options: FolderViewOptions,
  collapsed: Set<string>,
): ProjectedRow[] {
  const direct = new Set(
    entries
      .filter(
        (e) =>
          matchesName(e.relativePath, options.include, options.exclude) &&
          options.statuses.includes(e.status) &&
          (options.showMinor || e.status !== 'minor'),
      )
      .map((e) => e.relativePath),
  )
  const included = new Set(direct)
  for (const path of direct) {
    let parent = path
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'))
      included.add(parent)
    }
  }
  const compare = (a: FolderEntry, b: FolderEntry) => {
    const av = a[options.sortSide],
      bv = b[options.sortSide]
    const value =
      options.sort === 'name'
        ? a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true, sensitivity: 'base' })
        : (options.sort === 'size'
            ? (av?.size ?? -1) - (bv?.size ?? -1)
            : (av?.mtimeMs ?? -1) - (bv?.mtimeMs ?? -1)) || a.relativePath.localeCompare(b.relativePath)
    return options.descending ? -value : value
  }
  if (options.structure === 'flat')
    return entries
      .filter((e) => e.kind !== 'directory' && (options.peek || direct.has(e.relativePath)))
      .sort(compare)
      .map((entry) => ({ entry, hidden: !direct.has(entry.relativePath) }))
  const groups = new Map<string, FolderEntry[]>()
  for (const entry of entries) {
    if (!options.peek && !included.has(entry.relativePath)) continue
    const parent = entry.relativePath.includes('/')
      ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
      : ''
    const group = groups.get(parent) ?? []
    group.push(entry)
    groups.set(parent, group)
  }
  const result: ProjectedRow[] = []
  const visit = (parent: string) => {
    for (const entry of (groups.get(parent) ?? []).sort(
      (a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || compare(a, b),
    )) {
      result.push({ entry, hidden: !included.has(entry.relativePath) })
      if (!collapsed.has(entry.relativePath)) visit(entry.relativePath)
    }
  }
  visit('')
  return result
}

const caseInsensitive = typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
/** Same case rule as the Rust scanner: Windows paths compare case-insensitively. */
export const ignoredKey = (path: string): string => (caseInsensitive ? path.toLowerCase() : path)
const isUnder = (path: string, parent: string) => ignoredKey(path).startsWith(ignoredKey(parent) + '/')

/** Adds root-relative folders; duplicates and children of an already ignored folder are dropped. */
export function addIgnoredFolders(current: readonly string[], additions: readonly string[]): string[] {
  const all = [...current, ...additions]
  const unique = [...new Map(all.map((p) => [ignoredKey(p), p])).values()]
  return unique.filter((p) => !unique.some((other) => isUnder(p, other)))
}
/** Keep only well-formed strings from restored sessions; Rust validates the paths before use. */
export const normalizeIgnoredFolders = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string' && p.length > 0) : []
