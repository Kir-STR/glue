import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Корень плагина = родитель каталога src/.
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function loadContract(root = PLUGIN_ROOT) {
  return JSON.parse(readFileSync(join(root, 'glue.contract_v1.json'), 'utf8'))
}

export function loadBundle(root = PLUGIN_ROOT, contract = loadContract(root)) {
  const registry = JSON.parse(readFileSync(join(root, contract.registry), 'utf8'))
  return validateBundle(registry)
}

export function validateBundle(registry) {
  const ids = Object.keys(registry)
  const errors = []
  for (const [id, m] of Object.entries(registry)) {
    if (typeof m?.title !== 'string' || !m.title) errors.push(`${id}: title`)
    if (!Array.isArray(m?.templates) || m.templates.length === 0) errors.push(`${id}: templates`)
    if (typeof m?.instructionBlock !== 'string') errors.push(`${id}: instructionBlock`)
    if (!Array.isArray(m?.dependsOn)) errors.push(`${id}: dependsOn`)
    for (const dep of m?.dependsOn ?? []) {
      if (!ids.includes(dep)) errors.push(`${id}: dependsOn references unknown '${dep}'`)
    }
  }
  if (errors.length) throw new Error('Invalid bundle registry:\n' + errors.join('\n'))
  return registry
}

export function listModules(registry) {
  return Object.entries(registry).map(([id, m]) => ({
    id,
    title: m.title,
    group: m.group ?? null,
    default: m.default ?? false,
    note: m.note ?? null,
    dependsOn: m.dependsOn ?? [],
  }))
}
