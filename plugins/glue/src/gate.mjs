import { statSync } from 'node:fs'
import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { safeTargetPath } from './paths.mjs'

// Обязательный Claude-target: корневой CLAUDE.md либо файл под .claude/rules/.
function isMandatoryClaudeTarget(targetPath) {
  return targetPath === 'CLAUDE.md' || targetPath.startsWith('.claude/rules/')
}

// «Harness сможет прочитать здесь файл?» — обычный файл на месте (директория → false,
// отсутствует → false). stat следует по symlink, как чтение файла harness'ом,
// поэтому gate и `status` (readFileSync тоже следует) согласованы по присутствию.
function isRegularFile(abs) {
  try { return statSync(abs).isFile() } catch { return false }
}

// Presence-gate native↔fallback: обязательные Claude-файлы должны присутствовать
// как обычные файлы; содержимое НЕ сверяется — ручная правка правила остаётся native
// (расхождение — забота `status`, не триггер fallback). Версию не проверяет. throw → false.
export function nativeDeliveryValid(projectDir) {
  try {
    const m = readManifest(projectDir)
    if (!isUsablePrevManifest(m)) return false      // нет манифеста / schemaVersion ≠ '2' / foreign producerPack
    if (m.status !== 'complete') return false

    const files = Array.isArray(m.files) ? m.files : []
    let sawClaudeMd = false

    for (const f of files) {
      if (!f || typeof f.targetPath !== 'string') return false
      if (f.targetPath === 'CLAUDE.md') sawClaudeMd = true
      if (isMandatoryClaudeTarget(f.targetPath)) {
        if (!isRegularFile(safeTargetPath(projectDir, f.targetPath))) return false
      }
    }

    if (!sawClaudeMd) return false  // Claude-доставка неполна без CLAUDE.md
    return true
  } catch {
    return false
  }
}
