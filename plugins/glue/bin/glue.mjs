#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// Реализованы: list (срез 1), status + session-start (срез 3), init (срез 4).

import { loadBundle, listModules } from '../src/bundle.mjs'
import { deliveryStatus } from '../src/status.mjs'
import { runSessionStart } from '../src/session-start.mjs'
import { runInit } from '../src/init.mjs'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const [cmd] = process.argv.slice(2)

// Значение флага, требующего аргумент; throw, если значение отсутствует или
// похоже на следующий флаг (--modules без значения и т.п.).
function flagValue(flags, i, name) {
  const v = flags[i + 1]
  if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return v
}

// Нераспознанный ввод (--help / unknown / нет команды): JSON error + exit 1.
// Никогда не дефолтит в session-start.
function emitUnknown(label) {
  emitError('cli', new Error(`unknown command: ${label ?? '(none)'}`))
}

function parseCsv(s) { return s.split(',').map((v) => v.trim()).filter(Boolean) }

// Единый JSON-контракт ошибок команд (кроме session-start — тот fail-closed с exit 0).
function emitError(scope, e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n')
  process.stderr.write(`[glue] ${scope}: ${e.message}\n`)
  process.exit(1)
}

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  try {
    const registry = loadBundle()
    process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
  } catch (e) { emitError('list', e) }
} else if (cmd === 'status') {
  // glue status → отчёт о состоянии доставки (JSON)
  try {
    process.stdout.write(JSON.stringify(deliveryStatus(PROJECT_DIR), null, 2) + '\n')
  } catch (e) { emitError('status', e) }
} else if (cmd === 'session-start') {
  // SessionStart-хук: native → {}; иначе fallback-инъекция тел правил
  const r = runSessionStart(PROJECT_DIR)
  process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.exitCode)
} else if (cmd === 'init') {
  // glue init --modules a,b[,c] [--engines claude,codex]
  // JSON всегда: success/conflicts → exit 0; ошибка аргументов/движка/модуля → exit 1.
  try {
    const flags = process.argv.slice(3)
    let modulesArg = null
    let enginesArg = null
    for (let i = 0; i < flags.length; i++) {
      const a = flags[i]
      if (a === '--force') throw new Error("--force removed: resolve conflicts manually or use semantic adopt ('replace' mode)")
      else if (a === '--modules') { modulesArg = flagValue(flags, i, '--modules'); i++ }
      else if (a === '--engines') { enginesArg = flagValue(flags, i, '--engines'); i++ }
      else throw new Error(`Unknown argument: ${a}`)
    }
    if (modulesArg === null) throw new Error('Missing required --modules')
    const selected = parseCsv(modulesArg)
    if (selected.length === 0) throw new Error('Empty --modules: at least one module required')
    const engines = enginesArg !== null ? parseCsv(enginesArg) : undefined
    const { manifest, conflicts } = runInit({
      selected,
      engines,
      projectDir: PROJECT_DIR,
      now: new Date().toISOString(),
    })
    const ok = conflicts.length === 0
    process.stdout.write(JSON.stringify({ ok, manifest: ok ? manifest : null, conflicts }, null, 2) + '\n')
    process.exit(0)
  } catch (e) { emitError('init', e) }
} else {
  emitUnknown(cmd)
}
