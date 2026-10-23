import * as monaco from 'monaco-editor'

const byExt: Record<string, string> = {
  sql: 'sql',
  cs: 'csharp',
  vb: 'vb',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  json: 'json',
  xml: 'xml',
  config: 'xml',
  csproj: 'xml',
  html: 'html',
  htm: 'html',
  aspx: 'html',
  ascx: 'html',
  cshtml: 'razor',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  py: 'python',
  java: 'java',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  go: 'go',
  rs: 'rust',
  cpp: 'cpp',
  c: 'c',
  h: 'cpp',
  php: 'php'
}

export function languageForPath(path: string | null): string {
  if (!path) return 'plaintext'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return byExt[ext] ?? 'plaintext'
}

export function allLanguages(): { id: string; label: string }[] {
  return monaco.languages
    .getLanguages()
    .map((l) => ({ id: l.id, label: l.aliases?.[0] ?? l.id }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
