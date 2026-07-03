import { resolve, relative, isAbsolute, sep } from 'node:path'

// Разрешённые целевые зоны проекта: каталоги — по префиксу, файлы — только точное имя
// (CLAUDE.md.bak и т.п. — вне зоны).
const DIR_ZONES = ['.claude' + sep, '.glue' + sep]
const FILE_ZONES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']

// target должен остаться внутри проекта и в разрешённой зоне после нормализации.
export function safeTargetPath(projectDir, rel) {
  if (isAbsolute(rel)) throw new Error(`target must be relative: ${rel}`)
  const abs = resolve(projectDir, rel)
  const r = relative(projectDir, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`target escapes project: ${rel}`)
  const norm = r.split('/').join(sep)
  if (!FILE_ZONES.includes(norm) && !DIR_ZONES.some((z) => norm.startsWith(z))) {
    throw new Error(`target outside allowed zone: ${rel}`)
  }
  return abs
}
