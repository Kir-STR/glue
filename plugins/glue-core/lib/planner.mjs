import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDependencies } from './resolve.mjs'
import { mergePackRegistries } from './discovery.mjs'
import { filterModuleBlocks } from './blocks.mjs'
import { hashContent } from './hash.mjs'
import { safeSourcePath, safeTargetPath } from './paths.mjs'

// engine → [instruction template filename, target relative path]
const ENGINE_INSTRUCTIONS = {
  claude: ['CLAUDE.md.tmpl', 'CLAUDE.md'],
  agents: ['AGENTS.md.tmpl', 'AGENTS.md'],
  gemini: ['GEMINI.md.tmpl', 'GEMINI.md'],
}

// Computes the on-disk hash of a target file, or null if absent.
function diskHash(projectDir, rel) {
  const abs = safeTargetPath(projectDir, rel)
  if (!existsSync(abs)) return null
  return hashContent(readFileSync(abs, 'utf8'))
}

// Builds the ordered list of planned targets (rule files + instruction files).
// Each entry: { targetPath, plannedHash, content, sourcePack, packVersion, sourceTemplate }.
function planTargets({ packs, selected, engines }) {
  const { merged, owner } = mergePackRegistries(packs)
  const byName = new Map(packs.map((p) => [p.name, p]))
  const resolvedIds = resolveDependencies(merged, selected)
  const targets = []

  // 1. Rule files — one per template filename per resolved module.
  for (const id of resolvedIds) {
    const pack = byName.get(owner[id])
    const mod = merged[id]
    for (const file of mod.templates) {
      const src = safeSourcePath(pack.root, join(pack.contract.templatesDir, file))
      const content = readFileSync(src, 'utf8')
      targets.push({
        targetPath: '.claude/rules/' + file,
        plannedHash: hashContent(content),
        content,
        sourcePack: pack.name,
        packVersion: pack.version,
        sourceTemplate: file,
      })
    }
  }

  // 2. Instruction files — per engine, from each pack owning a resolved module.
  // Slice 1 has a single content pack; multiple packs are de-duped by name and
  // each contributes only the instruction templates that physically exist.
  const ownerPackNames = [...new Set(resolvedIds.map((id) => owner[id]))]
  for (const name of ownerPackNames) {
    const pack = byName.get(name)
    for (const engine of engines) {
      const map = ENGINE_INSTRUCTIONS[engine]
      if (!map) continue
      const [tmpl, targetFile] = map
      const src = safeSourcePath(pack.root, join(pack.contract.instructionsDir, tmpl))
      if (!existsSync(src)) continue // only plan engines whose .tmpl exists in the pack
      const filtered = filterModuleBlocks(readFileSync(src, 'utf8'), resolvedIds)
      targets.push({
        targetPath: targetFile,
        plannedHash: hashContent(filtered),
        content: filtered,
        sourcePack: pack.name,
        packVersion: pack.version,
        sourceTemplate: tmpl,
      })
    }
  }

  return targets
}

// Pure planner: reads the disk for current hashes, decides writes/materialized/
// deletes/conflicts per the dictated conflict algorithm. Writes NOTHING.
export function plan({ packs, selected, engines, projectDir, prevManifest, force = false }) {
  const targets = planTargets({ packs, selected, engines })

  // prevManifest.files indexed by targetPath → writtenHash.
  const prevFiles = new Map((prevManifest?.files ?? []).map((f) => [f.targetPath, f]))

  const writes = []
  const materialized = []
  const deletes = []
  const conflicts = []

  const newTargetPaths = new Set(targets.map((t) => t.targetPath))

  for (const t of targets) {
    const current = diskHash(projectDir, t.targetPath)
    const prev = prevFiles.get(t.targetPath)
    const writtenHash = prev?.writtenHash ?? null

    const writeEntry = (expectedCurrentHash) =>
      writes.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        content: t.content,
        sourcePack: t.sourcePack,
        packVersion: t.packVersion,
        sourceTemplate: t.sourceTemplate,
        expectedCurrentHash,
      })

    if (current === null) {
      // on-disk absent → write
      writeEntry(null)
    } else if (current === t.plannedHash) {
      // on-disk already == plannedHash → materialized (recovery; into manifest, not re-written)
      materialized.push({
        targetPath: t.targetPath,
        plannedHash: t.plannedHash,
        sourcePack: t.sourcePack,
        packVersion: t.packVersion,
        sourceTemplate: t.sourceTemplate,
      })
    } else if (writtenHash !== null && current === writtenHash) {
      // managed by prevManifest AND on-disk == writtenHash → write (update)
      writeEntry(writtenHash)
    } else {
      // current != plannedHash AND (unmanaged, OR managed but current != writtenHash) → conflict
      if (force) writeEntry(current)
      else conflicts.push({ targetPath: t.targetPath, reason: 'hash mismatch' })
    }
  }

  // Deletion: targets in prevManifest absent from the new target set.
  for (const [targetPath, f] of prevFiles) {
    if (newTargetPaths.has(targetPath)) continue
    const current = diskHash(projectDir, targetPath)
    if (current === null) continue // already gone — nothing to delete
    if (current === f.writtenHash) {
      deletes.push({ targetPath, expectedCurrentHash: f.writtenHash })
    } else if (force) {
      deletes.push({ targetPath, expectedCurrentHash: current })
    } else {
      conflicts.push({ targetPath, reason: 'dropped file hand-edited' })
    }
  }

  return { writes, materialized, deletes, conflicts }
}
