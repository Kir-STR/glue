import { loadBundle, loadContract, readPluginVersion, PLUGIN_ROOT } from './bundle.mjs'
import { resolveDependencies } from './resolve.mjs'
import { plan, KNOWN_ENGINES } from './plan.mjs'
import { applyPlan } from './apply.mjs'

// Программный оркестратор: resolve → plan → conflict-gate → apply. Не CLI.
export function runInit({ selected, engines, projectDir, force = false, now }) {
  // Движки: пуст/нет → claude; иначе как есть (не авто-добавлять claude).
  const effectiveEngines = engines && engines.length ? engines : ['claude']

  // Валидация движков до любого касания диска.
  for (const engine of effectiveEngines) {
    if (!KNOWN_ENGINES.includes(engine)) {
      throw new Error(`Unknown engine: ${engine}. Known: ${KNOWN_ENGINES.join(', ')}`)
    }
  }

  const contract = loadContract(PLUGIN_ROOT)
  const registry = loadBundle(PLUGIN_ROOT, contract)
  const resolvedIds = resolveDependencies(registry, selected)

  const planResult = plan({
    registry,
    modules: resolvedIds,
    engines: effectiveEngines,
    contract,
    pluginRoot: PLUGIN_ROOT,
    projectDir,
    force,
  })

  // Conflict-gate: при конфликтах без force диск не тронут (мутаций ещё не было).
  if (planResult.conflicts.length > 0 && !force) {
    return { manifest: null, conflicts: planResult.conflicts }
  }

  const manifest = applyPlan({
    plan: planResult,
    projectDir,
    engines: planResult.deliveredEngines,
    modules: resolvedIds,
    packVersion: readPluginVersion(PLUGIN_ROOT),
    deliveryId: now,
    completedAt: now,
  })

  return { manifest, conflicts: [] }
}
