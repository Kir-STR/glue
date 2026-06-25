import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashContent } from './hash.mjs'
import { buildManifest, writeManifest } from './manifest.mjs'
import { safeTargetPath } from './paths.mjs'

/**
 * toctouCheck — validates a single plan entry before any mutation:
 *   - resolves safeTargetPath
 *   - if target exists: symlink → throw; hash mismatch → throw
 *   - if target absent: expectedCurrentHash non-null → throw
 *
 * @param {string} projectDir
 * @param {object} entry - {targetPath, expectedCurrentHash}
 */
function toctouCheck(projectDir, entry) {
  const target = safeTargetPath(projectDir, entry.targetPath)

  if (existsSync(target)) {
    // Symlink check — abort immediately
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`abort: symlink at target path: ${entry.targetPath}`)
    }

    // TOCTOU check — compare current on-disk hash with what planner saw
    if (entry.expectedCurrentHash !== null && entry.expectedCurrentHash !== undefined) {
      const currentContent = readFileSync(target, 'utf8')
      const currentHash = hashContent(currentContent)
      if (currentHash !== entry.expectedCurrentHash) {
        throw new Error(
          `TOCTOU abort: file changed since planning: ${entry.targetPath} ` +
          `(expected ${entry.expectedCurrentHash}, got ${currentHash})`
        )
      }
    }
  } else {
    // Target is absent — current hash is null.
    // If planner saw a file there (non-null expectedCurrentHash), it was
    // deleted/moved between planning and apply: TOCTOU mismatch → abort.
    if (entry.expectedCurrentHash !== null && entry.expectedCurrentHash !== undefined) {
      throw new Error(
        `TOCTOU abort: file absent but hash expected since planning: ${entry.targetPath} ` +
        `(expected ${entry.expectedCurrentHash}, got null)`
      )
    }
  }
}

/**
 * toManifestFileEntry — maps a plan entry to its manifest file shape.
 * writtenHash = plannedHash for both writes and materialized entries.
 *
 * @param {object} entry - {sourcePack, packVersion, sourceTemplate, targetPath, plannedHash}
 * @returns {object} manifest file entry
 */
const toManifestFileEntry = (entry) => ({
  producerPack: entry.sourcePack,
  packVersion: entry.packVersion,
  sourceTemplate: entry.sourceTemplate,
  targetPath: entry.targetPath,
  writtenHash: entry.plannedHash,
})

/**
 * applyPlan — consumes a plan from Task 2.5 and applies it:
 *   1. Batch TOCTOU + symlink checks (abort before any mutation on mismatch)
 *   2. Write files, delete files
 *   3. Build manifest (writes ∪ materialized), publish atomically last
 *
 * @param {object} opts
 * @param {object} opts.plan        - {writes, materialized, deletes, conflicts}
 * @param {string} opts.projectDir  - absolute project root
 * @param {string[]} opts.engines
 * @param {string[]} opts.modules
 * @param {string} opts.deliveryId
 * @param {string} opts.completedAt
 * @returns {object} manifest
 */
export function applyPlan({ plan, projectDir, engines, modules, deliveryId, completedAt }) {
  const { writes = [], materialized = [], deletes = [] } = plan

  // ── Phase 1: Batch safety + TOCTOU checks (before ANY mutation) ──────────

  for (const entry of writes) {
    toctouCheck(projectDir, entry)
  }

  for (const entry of deletes) {
    toctouCheck(projectDir, entry)
  }

  // ── Phase 2: Mutations ────────────────────────────────────────────────────

  for (const entry of writes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.content, 'utf8')
  }

  for (const entry of deletes) {
    const target = safeTargetPath(projectDir, entry.targetPath)
    if (existsSync(target)) {
      unlinkSync(target)
    }
  }

  // ── Phase 3: Build manifest (writes ∪ materialized) ──────────────────────

  const files = [
    ...writes.map(toManifestFileEntry),
    ...materialized.map(toManifestFileEntry),
  ]

  const manifest = buildManifest({ deliveryId, completedAt, engines, modules, files })

  // ── Phase 4: Atomic manifest publish — LAST ───────────────────────────────
  writeManifest(projectDir, manifest)

  return manifest
}
