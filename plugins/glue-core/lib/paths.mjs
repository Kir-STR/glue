import { resolve, relative, isAbsolute, sep } from 'node:path'

// source должен оставаться внутри корня пака после нормализации.
export function safeSourcePath(packRoot, rel) {
  if (isAbsolute(rel)) throw new Error(`source must be relative: ${rel}`)
  const abs = resolve(packRoot, rel)
  const r = relative(packRoot, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`source escapes pack root: ${rel}`)
  return abs
}

// разрешённые целевые зоны проекта (префиксы относительного пути).
const TARGET_ZONES = ['.claude' + sep, '.glue' + sep, 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
export function safeTargetPath(projectDir, rel) {
  if (isAbsolute(rel)) throw new Error(`target must be relative: ${rel}`)
  const abs = resolve(projectDir, rel)
  const r = relative(projectDir, abs)
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`target escapes project: ${rel}`)
  const norm = r.split('/').join(sep)
  if (!TARGET_ZONES.some((z) => norm === z || norm.startsWith(z))) {
    throw new Error(`target outside allowed zone: ${rel}`)
  }
  return abs
}
