import { hashContent } from './hash.mjs'
import { applyPlan } from './apply.mjs'
import { readPluginVersion, PLUGIN_ROOT } from './bundle.mjs'
import { KNOWN_ENGINES, engineTarget } from './plan.mjs'

export const DECISIONS = ['added-from-template', 'tailored-from-template', 'adopted-existing', 'merged', 'declined', 'local']

// Валидация авторского adopt-плана до любой мутации. Бросает с полной диагностикой.
export function validateAdoptPlan(p) {
  const errors = []
  if (!Array.isArray(p?.engines) || p.engines.some((e) => !KNOWN_ENGINES.includes(e))) {
    errors.push(`engines: array of known engines required (${KNOWN_ENGINES.join(', ')})`)
  }
  if (!Array.isArray(p?.modules) || p.modules.length === 0) errors.push('modules: non-empty array required')
  const seenModuleIds = new Set()
  for (const m of p?.modules ?? []) {
    if (typeof m?.id !== 'string' || !m.id) errors.push('module: string id required')
    if (typeof m?.id === 'string' && seenModuleIds.has(m.id)) errors.push(`${m.id}: duplicate module id`)
    seenModuleIds.add(m?.id)
    if (!DECISIONS.includes(m?.decision)) errors.push(`${m?.id}: unknown decision '${m?.decision}'`)
    if (!Array.isArray(m?.targetPaths)) errors.push(`${m?.id}: targetPaths array required`)
    for (const tp of Array.isArray(m?.targetPaths) ? m.targetPaths : []) {
      if (typeof tp !== 'string') errors.push(`${m?.id}: targetPaths element must be string`)
      // Манифест хранит путь дословно; backslash ломает строковые gate-предикаты.
      else if (tp.includes('\\')) errors.push(`${tp}: use forward slashes in targetPath`)
    }
    if (m?.decision === 'declined' && Array.isArray(m?.targetPaths) && m.targetPaths.length > 0) {
      errors.push(`${m?.id}: declined module must have empty targetPaths`)
    }
  }
  if (!Array.isArray(p?.writes)) errors.push('writes: array required')
  if (p?.materialized !== undefined && !Array.isArray(p.materialized)) errors.push('materialized: array required')
  // Спека выводит связь file→module через targetPath ∈ module.targetPaths (поля relation нет) —
  // план, где связь отсутствует, не принимается. Instruction-таргеты — только заявленных движков.
  const claimed = new Set((p?.modules ?? []).flatMap((m) => m?.targetPaths ?? []))
  for (const e of Array.isArray(p?.engines) ? p.engines : []) {
    const t = engineTarget(e)
    if (t) claimed.add(t)
  }
  const seen = new Set()
  const checkTargetPath = (w, label) => {
    if (typeof w?.targetPath !== 'string' || !w.targetPath) { errors.push(`${label}: targetPath required`); return }
    if (seen.has(w.targetPath)) errors.push(`${w.targetPath}: duplicate write target`)
    seen.add(w.targetPath)
    if (w.targetPath.includes('\\')) errors.push(`${w.targetPath}: use forward slashes in targetPath`)
    if (w.targetPath === '.glue' || w.targetPath.startsWith('.glue/')) {
      errors.push(`${w.targetPath}: .glue/ is engine-owned, not writable by adopt plan`)
    }
    if (!claimed.has(w.targetPath)) {
      errors.push(`${w.targetPath}: write target not claimed by any module or engine instruction file`)
    }
  }
  for (const w of p?.writes ?? []) {
    checkTargetPath(w, 'write')
    if (typeof w?.content !== 'string') errors.push(`${w?.targetPath}: string content required`)
    if (w?.expectedCurrentHash !== null && typeof w?.expectedCurrentHash !== 'string') {
      errors.push(`${w?.targetPath}: expectedCurrentHash must be hash or null`)
    }
  }
  for (const w of Array.isArray(p?.materialized) ? p.materialized : []) {
    checkTargetPath(w, 'materialized')
    // materialized = «файл остаётся как есть»: планировщик обязан был видеть содержимое, null недопустим.
    if (typeof w?.expectedCurrentHash !== 'string') {
      errors.push(`${w?.targetPath}: materialized requires string expectedCurrentHash`)
    }
  }
  // Манифест перезаписывается доставкой целиком — непокрытый таргет выпадает из отслеживания status,
  // а движок без инструкц-файла в files даёт fallback. Полнота обязательна на входе.
  for (const e of Array.isArray(p?.engines) ? p.engines : []) {
    const t = engineTarget(e)
    if (t && !seen.has(t)) errors.push(`engine '${e}': instruction file ${t} not covered by writes or materialized`)
  }
  for (const m of p?.modules ?? []) {
    if (m?.decision === 'local' || m?.decision === 'declined') continue
    for (const tp of Array.isArray(m?.targetPaths) ? m.targetPaths : []) {
      if (typeof tp === 'string' && !seen.has(tp)) errors.push(`${m?.id}: ${tp} not covered by writes or materialized`)
    }
  }
  if (errors.length) throw new Error('Invalid adopt plan:\n' + errors.join('\n'))
  return p
}

// Authored-targets: writes[]-entries для applyPlan из авторского контента
// (plannedHash = hash(текста); TOCTOU — по expectedCurrentHash из P2-обзора).
export function buildAuthoredWrites(writes) {
  return writes.map((w) => ({
    targetPath: w.targetPath,
    plannedHash: hashContent(w.content),
    content: w.content,
    sourceTemplate: w.sourceTemplate ?? null,
    kind: w.kind ?? 'rule',
    expectedCurrentHash: w.expectedCurrentHash,
  }))
}

// Materialized-targets: файлы, остающиеся как есть, но входящие в manifest.files
// (plannedHash = expectedCurrentHash — содержимое, которое видел P2-обзор; apply перепроверит TOCTOU).
export function buildAuthoredMaterialized(materialized) {
  return materialized.map((w) => ({
    targetPath: w.targetPath,
    plannedHash: w.expectedCurrentHash,
    sourceTemplate: w.sourceTemplate ?? null,
    kind: w.kind ?? 'rule',
    expectedCurrentHash: w.expectedCurrentHash,
  }))
}

// Оркестратор adopt: validate → authored writes → applyPlan (манифест v2 последним).
// Расхождение диска с expectedCurrentHash — ошибка (гонка после P2-обзора), не conflicts:
// план строится на свежем P2-обзоре.
export function runAdopt({ adoptPlan, projectDir, now }) {
  const p = validateAdoptPlan(adoptPlan)
  const manifest = applyPlan({
    plan: { writes: buildAuthoredWrites(p.writes), materialized: buildAuthoredMaterialized(p.materialized ?? []) },
    projectDir,
    engines: p.engines,
    modules: p.modules,
    packVersion: readPluginVersion(PLUGIN_ROOT),
    deliveryId: now,
    completedAt: now,
  })
  return { manifest }
}
