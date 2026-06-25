import { discoverPacks, mergePackRegistries } from './discovery.mjs'
import { resolveDependencies } from './resolve.mjs'
import { plan } from './planner.mjs'
import { applyPlan } from './writer.mjs'
import { readManifest } from './manifest.mjs'

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
