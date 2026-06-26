import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA_VERSION = '1'
const PRODUCER = 'glue'
const rel = (d) => join(d, '.glue', 'manifest.json')

export function buildManifest({ deliveryId, completedAt, engines, modules, files }) {
  return { schemaVersion: SCHEMA_VERSION, deliveryId, completedAt, engines, modules, status: 'complete', files }
}

// Сырой ридер: отсутствует → null; битый JSON → null (не crash).
export function readManifest(projectDir) {
  const p = rel(projectDir)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// Можно ли доверять манифесту как prevManifest: наш формат и наш producer.
// Legacy/чужой манифест (producerPack ≠ 'glue') → не используется для миграции.
export function isUsablePrevManifest(m) {
  return !!m && m.schemaVersion === SCHEMA_VERSION && (m.files ?? []).every((f) => f.producerPack === PRODUCER)
}

// Атомарно: пишем во временный + rename (последним, после всех файлов).
export function writeManifest(projectDir, manifest) {
  mkdirSync(join(projectDir, '.glue'), { recursive: true })
  const p = rel(projectDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}

export { SCHEMA_VERSION, PRODUCER }
