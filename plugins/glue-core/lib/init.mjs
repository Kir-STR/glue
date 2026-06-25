import { existsSync, readFileSync } from 'node:fs'
import { discoverPacks, mergePackRegistries } from './discovery.mjs'
import { resolveDependencies } from './resolve.mjs'
import { plan } from './planner.mjs'
import { applyPlan } from './writer.mjs'
import { readManifest, SCHEMA_VERSION } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'

/**
 * runInit — orchestrates discover → plan → (conflict gate) → apply.
 *
 * @param {object} opts
 * @param {string[]} opts.selected     - module IDs to install
 * @param {string[]} opts.engines      - engines (claude always present)
 * @param {string}   opts.projectDir   - absolute project root
 * @param {boolean}  opts.force        - overwrite conflicts
 * @param {string}   opts.now          - ISO timestamp for deliveryId + completedAt
 * @param {string}   [opts.registryPath] - path to installed_plugins.json (default: OS default)
 * @returns {{ manifest: object|null, conflicts: object[] }}
 */
export function runInit({ selected, engines, projectDir, force, now, registryPath }) {
  // Ensure claude is always in engines
  const effectiveEngines = engines.includes('claude') ? engines : ['claude', ...engines]

  // 1. Discover installed content packs
  const packs = discoverPacks(registryPath)

  // 2. Merge registries and resolve dependency order (for modules list in manifest)
  const { merged } = mergePackRegistries(packs)
  const resolvedIds = resolveDependencies(merged, selected)

  // 3. Plan (reads disk, computes writes/deletes/conflicts — no mutations)
  const planResult = plan({
    packs,
    selected,
    engines: effectiveEngines,
    projectDir,
    prevManifest: readManifest(projectDir),
    force,
  })

  // 4. Conflict gate: return early without writing if conflicts exist and !force
  if (planResult.conflicts.length > 0 && !force) {
    return { manifest: null, conflicts: planResult.conflicts }
  }

  // 5. Apply plan (write files, build manifest)
  const manifest = applyPlan({
    plan: planResult,
    projectDir,
    engines: effectiveEngines,
    modules: resolvedIds,
    deliveryId: now,
    completedAt: now,
  })

  return { manifest, conflicts: [] }
}

// A manifest file entry is a mandatory Claude-target when it targets the root
// CLAUDE.md or any file under .claude/rules/.
function isMandatoryClaudeTarget(targetPath) {
  return targetPath === 'CLAUDE.md' || targetPath.startsWith('.claude/rules/')
}

/**
 * nativeDeliveryValid — predicate gating the conditional SessionStart hook.
 *
 * Returns true ONLY when native rule delivery (.claude/rules + CLAUDE.md) is
 * fully validated; otherwise false → the hook MUST fall back to body-injection.
 * Fallback is the safe default: any thrown error during validation → false.
 *
 * All of the following must hold:
 *  - manifest present and non-null,
 *  - manifest.schemaVersion === supported SCHEMA_VERSION,
 *  - manifest.status === 'complete',
 *  - every mandatory Claude-target (root CLAUDE.md + each .claude/rules/* entry)
 *    exists on disk and its current hash equals the manifest writtenHash,
 *  - each manifest file's producerPack/packVersion matches an installed pack
 *    (same name + version) in `packs` (stale delivery → false).
 *
 * @param {string} projectDir
 * @param {Array<{name:string, version:string}>} packs
 * @returns {boolean}
 */
export function nativeDeliveryValid(projectDir, packs) {
  try {
    const manifest = readManifest(projectDir)
    if (!manifest) return false
    if (manifest.schemaVersion !== SCHEMA_VERSION) return false
    if (manifest.status !== 'complete') return false

    const files = Array.isArray(manifest.files) ? manifest.files : []

    // Installed pack versions by name (for stale-delivery detection).
    const installedVersion = new Map((packs ?? []).map((p) => [p.name, p.version]))

    let sawClaudeMd = false

    for (const f of files) {
      if (!f || typeof f.targetPath !== 'string') return false

      // packVersion must match the actually-installed pack version.
      if (installedVersion.get(f.producerPack) !== f.packVersion) return false

      if (f.targetPath === 'CLAUDE.md') sawClaudeMd = true

      // Mandatory Claude-targets must be on disk and hash-match.
      if (isMandatoryClaudeTarget(f.targetPath)) {
        const abs = safeTargetPath(projectDir, f.targetPath)
        if (!existsSync(abs)) return false
        if (hashContent(readFileSync(abs, 'utf8')) !== f.writtenHash) return false
      }
    }

    // Defect-fix 5: a CLAUDE.md target absent from disk is caught above; but if
    // the manifest carries no CLAUDE.md entry at all, native delivery is
    // incomplete for the claude engine → fallback.
    if (!sawClaudeMd) return false

    return true
  } catch {
    return false
  }
}
