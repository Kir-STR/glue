import { existsSync, readFileSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'
import { nativeDeliveryValid } from './gate.mjs'
import { buildTargets, engineTarget } from './plan.mjs'
import { loadContract, loadBundle, PLUGIN_ROOT } from './bundle.mjs'

// Хеш файла на диске под безопасным targetPath, либо null (нет/ошибка пути).
function diskHash(projectDir, rel) {
  let abs
  try { abs = safeTargetPath(projectDir, rel) } catch { return null }
  if (!existsSync(abs)) return null
  return hashContent(readFileSync(abs, 'utf8'))
}

// Read-only отчёт о состоянии доставки. Не бросает: деградирует через reason/errors.
export function deliveryStatus(projectDir) {
  const mode = nativeDeliveryValid(projectDir) ? 'native' : 'fallback'
  const base = { mode, missing: [], changed: [], drift: [], engines: {}, errors: [] }

  const m = readManifest(projectDir)
  if (m === null) {
    return { ...base, reason: 'missing-or-unreadable-manifest', summary: 'fallback: манифест отсутствует или нечитаем' }
  }
  if (!isUsablePrevManifest(m)) {
    return { ...base, reason: 'unusable-manifest', summary: 'fallback: манифест не от glue либо неподдерживаемая версия' }
  }

  const files = Array.isArray(m.files) ? m.files : []
  const errors = []
  const missing = []
  const changed = []
  const writtenByPath = new Map(files.map((f) => [f.targetPath, f.writtenHash]))

  // disk-vs-manifest (без buildTargets)
  for (const f of files) {
    const cur = diskHash(projectDir, f.targetPath)
    if (cur === null) missing.push(f.targetPath)
    else if (cur !== f.writtenHash) changed.push(f.targetPath)
  }

  // drift через текущий plannedHash (buildTargets); ошибка → errors, drift пуст
  const drift = []
  let plannedByPath = null
  try {
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    const { targets } = buildTargets({ registry, modules: m.modules ?? [], engines: m.engines ?? [], contract, pluginRoot: PLUGIN_ROOT })
    plannedByPath = new Map(targets.map((t) => [t.targetPath, t.plannedHash]))
    for (const f of files) {
      const planned = plannedByPath.get(f.targetPath)
      if (planned !== undefined && planned !== f.writtenHash) drift.push(f.targetPath)
    }
  } catch (e) {
    errors.push(`drift не вычислен: ${e.message}`)
  }

  // покрытие по ВСЕМ manifest.engines (вкл. codex/gemini)
  const engines = {}
  for (const e of m.engines ?? []) {
    const targetPath = engineTarget(e)
    if (!targetPath) { errors.push(`неизвестный движок в манифесте: ${e}`); continue }
    const written = writtenByPath.get(targetPath)
    const cur = diskHash(projectDir, targetPath)
    let status
    if (cur === null) status = 'missing'
    else if (written !== undefined && cur !== written) status = 'changed'
    else if (plannedByPath && plannedByPath.get(targetPath) !== undefined && plannedByPath.get(targetPath) !== written) status = 'drift'
    else status = 'ok'
    engines[e] = { status, targetPath }
  }

  const reason = mode === 'native' ? 'native-valid'
    : missing.length ? 'targets-missing'
    : changed.length ? 'targets-changed'
    : 'incomplete'
  const summary = mode === 'native'
    ? `native delivery active: ${files.length} files${drift.length ? `; ${drift.length} drifted` : ''}`
    : `fallback (${reason})`

  return { mode, reason, missing, changed, drift, engines, errors, summary }
}
