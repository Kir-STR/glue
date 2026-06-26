import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashContent } from './hash.mjs'
import { buildManifest, writeManifest, PRODUCER } from './manifest.mjs'
import { safeTargetPath } from './paths.mjs'

// Проверяет один план-вход до любой мутации: symlink → abort; рассинхрон с тем,
// что видел планировщик, → abort. expectedCurrentHash:
//   null  → планировщик видел отсутствие файла (ожидаем absence);
//   hash  → ожидаем ровно этот контент;
//   undefined → нет ожидания (в плановых entries не используется).
function toctouCheck(projectDir, entry) {
  const target = safeTargetPath(projectDir, entry.targetPath)

  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`abort: symlink at target path: ${entry.targetPath}`)
    }
    // Планировщик видел отсутствие, а файл появился между plan и apply → abort
    // (без молчаливой перезаписи появившегося файла).
    if (entry.expectedCurrentHash === null) {
      throw new Error(`TOCTOU abort: file appeared since planning: ${entry.targetPath}`)
    }
    if (entry.expectedCurrentHash !== undefined) {
      const currentHash = hashContent(readFileSync(target, 'utf8'))
      if (currentHash !== entry.expectedCurrentHash) {
        throw new Error(
          `TOCTOU abort: file changed since planning: ${entry.targetPath} ` +
          `(expected ${entry.expectedCurrentHash}, got ${currentHash})`
        )
      }
    }
  } else {
    // Файл отсутствует. Планировщик ждал конкретный хеш → исчез между plan и apply → abort.
    if (entry.expectedCurrentHash !== null && entry.expectedCurrentHash !== undefined) {
      throw new Error(
        `TOCTOU abort: file absent but hash expected since planning: ${entry.targetPath} ` +
        `(expected ${entry.expectedCurrentHash}, got null)`
      )
    }
  }
}

const toManifestFileEntry = (packVersion) => (entry) => ({
  producerPack: PRODUCER,
  packVersion,
  sourceTemplate: entry.sourceTemplate,
  targetPath: entry.targetPath,
  writtenHash: entry.plannedHash,
})

// Применяет план: preflight (TOCTOU/symlink) → запись/удаление → манифест последним.
export function applyPlan({ plan, projectDir, engines, modules, packVersion, deliveryId, completedAt }) {
  const { writes = [], materialized = [], deletes = [] } = plan

  // Phase 1: batch preflight до любой мутации
  for (const entry of writes) toctouCheck(projectDir, entry)
  for (const entry of deletes) toctouCheck(projectDir, entry)

  // Phase 2: мутации
  for (const entry of writes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.content, 'utf8')
  }
  for (const entry of deletes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    if (existsSync(target)) unlinkSync(target)
  }

  // Phase 3: манифест (writes ∪ materialized)
  const files = [
    ...writes.map(toManifestFileEntry(packVersion)),
    ...materialized.map(toManifestFileEntry(packVersion)),
  ]
  const manifest = buildManifest({ deliveryId, completedAt, engines, modules, files })

  // Phase 4: публикация последней
  writeManifest(projectDir, manifest)
  return manifest
}
