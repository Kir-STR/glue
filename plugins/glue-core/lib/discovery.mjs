import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadPackContract, loadPackRegistry } from './registry.mjs'

const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const REGISTRY = join(HOME, '.claude', 'plugins', 'installed_plugins.json')

// Finds installed glue-* content packs (except glue-core) with a valid contract.
export function discoverPacks(registryPath = REGISTRY) {
  if (!existsSync(registryPath)) return []
  const reg = JSON.parse(readFileSync(registryPath, 'utf8'))
  const out = []
  for (const [key, installs] of Object.entries(reg.plugins ?? {})) {
    const name = key.split('@')[0]
    if (!name.startsWith('glue-') || name === 'glue-core') continue
    const usable = (Array.isArray(installs) ? installs : [])
      .filter((i) => i?.installPath && existsSync(join(i.installPath, 'glue.contract.json')))
      .sort((a, b) => String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || '')))
    if (!usable.length) continue
    const root = usable[0].installPath
    const contract = loadPackContract(root)
    out.push({ name, version: usable[0].version, root, contract, registry: loadPackRegistry(root, contract) })
  }
  return out
}

// Merges pack registries; fails fast on module ID collision across packs.
// Enforces within-pack-only dependsOn: a module may only depend on modules
// owned by its own pack (controller-directed reconciliation).
export function mergePackRegistries(packs) {
  const merged = {}
  const owner = {}
  for (const p of packs) {
    for (const [id, m] of Object.entries(p.registry)) {
      if (id in merged) throw new Error(`module id collision: '${id}' in ${owner[id]} and ${p.name}`)
      merged[id] = m
      owner[id] = p.name
    }
  }
  // Cross-pack dependency check: dependsOn must reference modules in the same pack only.
  for (const [id, m] of Object.entries(merged)) {
    for (const dep of m.dependsOn ?? []) {
      if (!(dep in merged) || owner[dep] !== owner[id]) {
        throw new Error(
          `cross-pack dependsOn rejected: module '${id}' (pack '${owner[id]}') depends on '${dep}' ` +
          `(within-pack only; dep owned by '${owner[dep] ?? 'unknown'}')`
        )
      }
    }
  }
  return { merged, owner }
}
