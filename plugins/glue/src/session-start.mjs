import { readManifest, isUsablePrevManifest } from './manifest.mjs'
import { nativeDeliveryValid } from './gate.mjs'
import { resolveDependencies } from './resolve.mjs'
import { buildTargets } from './plan.mjs'
import { loadContract, loadBundle, PLUGIN_ROOT } from './bundle.mjs'

// Resolved defaults: модули с default:true + их dependsOn.
function resolvedDefaults(registry) {
  const defaults = Object.keys(registry).filter((id) => registry[id].default)
  return resolveDependencies(registry, defaults)
}

// Выбор модулей для fallback-инъекции (R1):
//  - манифест usable (isUsablePrevManifest — наш формат и наш producerPack) + resolve успешно
//    → его modules (в т.ч. [] → пусто);
//  - иначе (нет/corrupt/unsupported/foreign/неразрешимо) → resolved defaults. Никогда «все» неявно.
//  Единый критерий «наш usable-манифест» по всему коду: хук не читает legacy/foreign-манифест
//  как источник выбора (согласуется с «не читать legacy ради миграции», срез 2).
function selectFallbackModules(projectDir, registry) {
  const m = readManifest(projectDir)
  if (isUsablePrevManifest(m)) {
    try { return resolveDependencies(registry, m.modules ?? []) } catch { return resolvedDefaults(registry) }
  }
  return resolvedDefaults(registry)
}

function payload(additionalContext) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } })
}

// Тестируемое ядро SessionStart-хука. Read-only (ничего не пишет в проект). exit 0 всегда.
export function runSessionStart(projectDir) {
  try {
    if (nativeDeliveryValid(projectDir)) {
      // Правила лежат нативно — ноль инъекции, ноль шума.
      return { stdout: '{}', stderr: '', exitCode: 0 }
    }
    const contract = loadContract(PLUGIN_ROOT)
    const registry = loadBundle(PLUGIN_ROOT, contract)
    const modules = selectFallbackModules(projectDir, registry)
    const { targets } = buildTargets({ registry, modules, engines: [], contract, pluginRoot: PLUGIN_ROOT })
    const bodies = targets.filter((t) => t.kind === 'rule').map((t) => t.content)
    const ctx = bodies.length
      ? '<glue>\nАктивные правила проекта (Glue, fallback-инъекция — native-доставка не активна). Соблюдай их:\n\n' + bodies.join('\n\n') + '\n</glue>'
      : '<glue>\nGlue: модули правил не выбраны — контроль не применяется. Сообщаю честно, иллюзии покрытия нет.\n</glue>'
    return { stdout: payload(ctx), stderr: '[glue] native delivery inactive — запусти /glue:init\n', exitCode: 0 }
  } catch (e) {
    // fail-closed: деградированный, но валидный ответ; сессию не валим.
    return { stdout: payload('<glue>\nGlue: ошибка fallback-инъекции — правила не применены.\n</glue>'), stderr: `[glue] fallback error: ${e.message}\n`, exitCode: 0 }
  }
}
