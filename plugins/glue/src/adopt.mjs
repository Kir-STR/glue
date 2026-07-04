import { hashContent } from './hash.mjs'
import { applyPlan } from './apply.mjs'
import { readPluginVersion, PLUGIN_ROOT } from './bundle.mjs'
import { KNOWN_ENGINES } from './plan.mjs'

export const DECISIONS = ['added-from-template', 'tailored-from-template', 'adopted-existing', 'merged', 'declined', 'local']

// Валидация авторского adopt-плана до любой мутации. Бросает с полной диагностикой.
export function validateAdoptPlan(p) {
  const errors = []
  if (!Array.isArray(p?.engines) || p.engines.some((e) => !KNOWN_ENGINES.includes(e))) {
    errors.push(`engines: array of known engines required (${KNOWN_ENGINES.join(', ')})`)
  }
  if (!Array.isArray(p?.modules) || p.modules.length === 0) errors.push('modules: non-empty array required')
  for (const m of p?.modules ?? []) {
    if (typeof m?.id !== 'string' || !m.id) errors.push('module: string id required')
    if (!DECISIONS.includes(m?.decision)) errors.push(`${m?.id}: unknown decision '${m?.decision}'`)
    if (!Array.isArray(m?.targetPaths)) errors.push(`${m?.id}: targetPaths array required`)
  }
  if (!Array.isArray(p?.writes)) errors.push('writes: array required')
  for (const w of p?.writes ?? []) {
    if (typeof w?.targetPath !== 'string' || !w.targetPath) errors.push('write: targetPath required')
    if (typeof w?.content !== 'string') errors.push(`${w?.targetPath}: string content required`)
    if (w?.expectedCurrentHash !== null && typeof w?.expectedCurrentHash !== 'string') {
      errors.push(`${w?.targetPath}: expectedCurrentHash must be hash or null`)
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

// Оркестратор adopt: validate → authored writes → applyPlan (манифест v2 последним).
// Расхождение диска с expectedCurrentHash — ошибка (гонка после P2-обзора), не conflicts:
// план строится на свежем P2-обзоре.
export function runAdopt({ adoptPlan, projectDir, now }) {
  const p = validateAdoptPlan(adoptPlan)
  const manifest = applyPlan({
    plan: { writes: buildAuthoredWrites(p.writes) },
    projectDir,
    engines: p.engines,
    modules: p.modules,
    packVersion: readPluginVersion(PLUGIN_ROOT),
    deliveryId: now,
    completedAt: now,
  })
  return { manifest }
}
