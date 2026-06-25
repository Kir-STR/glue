import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadPackContract(packRoot) {
  return JSON.parse(readFileSync(join(packRoot, 'glue.contract.json'), 'utf8'))
}

export function loadPackRegistry(packRoot, contract) {
  return validatePackRegistry(JSON.parse(readFileSync(join(packRoot, contract.registry), 'utf8')))
}

export function validatePackRegistry(registry) {
  const ids = Object.keys(registry)
  const errors = []
  for (const [id, m] of Object.entries(registry)) {
    if (typeof m?.title !== 'string' || !m.title) errors.push(`${id}: title`)
    if (!Array.isArray(m?.templates) || m.templates.length === 0) errors.push(`${id}: templates`)
    if (typeof m?.instructionBlock !== 'string') errors.push(`${id}: instructionBlock`)
    if (!Array.isArray(m?.dependsOn)) errors.push(`${id}: dependsOn`)
    for (const dep of m?.dependsOn ?? []) {
      if (!ids.includes(dep)) errors.push(`${id}: dependsOn references unknown '${dep}' (within-pack only)`)
    }
  }
  if (errors.length) throw new Error('Invalid pack registry:\n' + errors.join('\n'))
  return registry
}
