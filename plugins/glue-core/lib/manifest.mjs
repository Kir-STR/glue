import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA_VERSION = '1'
const rel = (d) => join(d, '.glue', 'manifest.json')

export function buildManifest({ deliveryId, completedAt, engines, modules, files }) {
  return { schemaVersion: SCHEMA_VERSION, deliveryId, completedAt, engines, modules, status: 'complete', files }
}
export function readManifest(projectDir) {
  const p = rel(projectDir)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}
// Атомарно: пишем во временный + rename (последним, после всех файлов).
export function writeManifest(projectDir, manifest) {
  mkdirSync(join(projectDir, '.glue'), { recursive: true })
  const p = rel(projectDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}
export { SCHEMA_VERSION }
