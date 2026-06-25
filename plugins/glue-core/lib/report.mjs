import { existsSync, readFileSync } from 'node:fs'
import { nativeDeliveryValid } from './init.mjs'
import { readManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { mergePackRegistries } from './discovery.mjs'
import { safeTargetPath } from './paths.mjs'

/**
 * deliveryStatus — read-only observability report on the current delivery state.
 *
 * @param {string} projectDir
 * @param {Array<{name:string, version:string, root:string, contract:object, registry:object}>} packs
 * @returns {{ mode: 'native'|'fallback', missing: string[], changed: string[], stale: string[], packs: {name:string,version:string}[], summary: string }}
 */
export function deliveryStatus(projectDir, packs) {
  const packsInfo = (packs ?? []).map((p) => ({ name: p.name, version: p.version }))
  const installedVersion = new Map(packsInfo.map((p) => [p.name, p.version]))

  const missing = []
  const changed = []
  const stale = []

  const manifest = readManifest(projectDir)

  // If no manifest, native is invalid; skip per-file iteration.
  if (manifest && Array.isArray(manifest.files)) {
    for (const f of manifest.files) {
      if (!f || typeof f.targetPath !== 'string') continue

      // stale: packVersion ≠ installed version
      if (installedVersion.get(f.producerPack) !== f.packVersion) {
        stale.push(f.targetPath)
      }

      let abs
      try {
        abs = safeTargetPath(projectDir, f.targetPath)
      } catch {
        missing.push(f.targetPath)
        continue
      }

      if (!existsSync(abs)) {
        missing.push(f.targetPath)
      } else if (hashContent(readFileSync(abs, 'utf8')) !== f.writtenHash) {
        changed.push(f.targetPath)
      }
    }
  }

  // Delegate validity check to nativeDeliveryValid (do not duplicate its logic).
  const isNative = nativeDeliveryValid(projectDir, packsInfo)
  const mode = isNative ? 'native' : 'fallback'

  let summary
  if (isNative) {
    const n = manifest?.files?.length ?? 0
    summary = `native delivery active: ${n} files`
  } else if (!manifest) {
    summary = 'fallback: no manifest'
  } else if (manifest.status !== 'complete') {
    summary = 'fallback: status not complete'
  } else if (missing.length > 0) {
    summary = `fallback: ${missing.length} file(s) missing`
  } else if (changed.length > 0) {
    summary = `fallback: ${changed.length} file(s) changed`
  } else if (stale.length > 0) {
    summary = `fallback: stale version`
  } else {
    // CLAUDE.md missing from manifest entries or schema mismatch
    summary = 'fallback: CLAUDE.md missing or schema mismatch'
  }

  return { mode, missing, changed, stale, packs: packsInfo, summary }
}

/**
 * listModules — flat list of all modules across discovered packs.
 *
 * @param {Array<{name:string, version:string, root:string, contract:object, registry:object}>} packs
 * @returns {Array<{id:string, title:string, group:string|null, default:boolean, dependsOn:string[]}>}
 */
export function listModules(packs) {
  const { merged } = mergePackRegistries(packs ?? [])
  return Object.entries(merged).map(([id, m]) => ({
    id,
    title: m.title,
    group: m.group ?? null,
    default: m.default ?? false,
    dependsOn: m.dependsOn ?? [],
  }))
}
