import { existsSync, readFileSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { hashContent } from './hash.mjs'
import { safeTargetPath } from './paths.mjs'

// Обязательный Claude-target: корневой CLAUDE.md либо файл под .claude/rules/.
function isMandatoryClaudeTarget(targetPath) {
  return targetPath === 'CLAUDE.md' || targetPath.startsWith('.claude/rules/')
}

// Узкий Claude-gate native↔fallback. Версию не проверяет. Любой throw → false.
export function nativeDeliveryValid(projectDir) {
  try {
    const m = readManifest(projectDir)
    if (!isUsablePrevManifest(m)) return false      // нет манифеста / schemaVersion ≠ '1' / foreign producerPack
    if (m.status !== 'complete') return false

    const files = Array.isArray(m.files) ? m.files : []
    let sawClaudeMd = false

    for (const f of files) {
      if (!f || typeof f.targetPath !== 'string') return false
      if (f.targetPath === 'CLAUDE.md') sawClaudeMd = true
      if (isMandatoryClaudeTarget(f.targetPath)) {
        const abs = safeTargetPath(projectDir, f.targetPath)
        if (!existsSync(abs)) return false
        if (hashContent(readFileSync(abs, 'utf8')) !== f.writtenHash) return false
      }
    }

    if (!sawClaudeMd) return false  // Claude-доставка неполна без CLAUDE.md
    return true
  } catch {
    return false
  }
}
