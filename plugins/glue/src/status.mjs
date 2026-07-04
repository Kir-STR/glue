import { existsSync, readFileSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'
import { nativeDeliveryValid } from './gate.mjs'
import { buildTargets, engineTarget } from './plan.mjs'
import { loadContract, loadBundle, PLUGIN_ROOT } from './bundle.mjs'

// Хеш файла на диске под безопасным targetPath, либо null (нет/ошибка пути).
function diskHash(projectDir, rel) {
  try {
    const abs = safeTargetPath(projectDir, rel)
    if (!existsSync(abs)) return null
    return hashContent(readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
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
  const fileByPath = new Map(files.map((f) => [f.targetPath, f]))
  const moduleByPath = new Map()
  for (const mod of m.modules ?? []) {
    for (const tp of mod.targetPaths ?? []) moduleByPath.set(tp, mod)
  }

  // disk-vs-manifest (без buildTargets)
  for (const f of files) {
    const cur = diskHash(projectDir, f.targetPath)
    if (cur === null) missing.push(f.targetPath)
    else if (cur !== f.writtenHash) changed.push(f.targetPath)
  }

  // drift через текущий plannedHash (buildTargets); ошибка → errors, drift пуст.
  // Eligibility: модульный файл — только decision 'added-from-template';
  // безмодульный (инструкционный файл, напр. CLAUDE.md) — только если писался из шаблона (sourceTemplate).
  const drift = []
  let plannedByPath = null
  try {
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    // Реконструкция — полный состав карты на момент записи: все не-local id
    // (local нет в bundle; не-local id вне bundle → catch → errors — сигнал битости).
    const bundleIds = (m.modules ?? []).filter((x) => x.decision !== 'local').map((x) => x.id)
    const { targets } = buildTargets({ registry, modules: bundleIds, engines: m.engines ?? [], contract, pluginRoot: PLUGIN_ROOT })
    plannedByPath = new Map(targets.map((t) => [t.targetPath, t.plannedHash]))
    for (const f of files) {
      const planned = plannedByPath.get(f.targetPath)
      if (planned === undefined || planned === f.writtenHash) continue
      const mod = moduleByPath.get(f.targetPath)
      const eligible = mod ? mod.decision === 'added-from-template' : !!f.sourceTemplate
      if (eligible) drift.push(f.targetPath)
    }
  } catch (e) {
    errors.push(`drift не вычислен: ${e.message}`)
  }

  // покрытие по ВСЕМ manifest.engines (вкл. codex/gemini)
  const engines = {}
  for (const e of m.engines ?? []) {
    const targetPath = engineTarget(e)
    if (!targetPath) { errors.push(`неизвестный движок в манифесте: ${e}`); continue }
    const file = fileByPath.get(targetPath)
    const written = file?.writtenHash
    // Движок заявлен, но файла нет в files — несогласованный манифест: ошибка, не drift.
    if (written === undefined) { errors.push(`движок '${e}' заявлен без файла ${targetPath} в files`); continue }
    const cur = diskHash(projectDir, targetPath)
    const planned = plannedByPath?.get(targetPath)
    let status
    if (cur === null) status = 'missing'
    else if (cur !== written) status = 'changed'
    else if (planned !== undefined && planned !== written && file?.sourceTemplate) status = 'drift'
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
