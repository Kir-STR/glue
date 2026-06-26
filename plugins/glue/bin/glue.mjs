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
  const error = `unknown command: ${label ?? '(none)'}`
  process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + '\n')
  process.stderr.write(`[glue] ${error}\n`)
  process.exit(1)
}

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  const registry = loadBundle()
  process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
} else if (cmd === 'status') {
  // glue status → отчёт о состоянии доставки (JSON)
  process.stdout.write(JSON.stringify(deliveryStatus(PROJECT_DIR), null, 2) + '\n')
} else if (cmd === 'session-start') {
  // SessionStart-хук: native → {}; иначе fallback-инъекция тел правил
  const r = runSessionStart(PROJECT_DIR)
  process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.exitCode)
} else if (cmd === 'init') {
  // glue init --modules a,b[,c] [--engines claude,codex] [--force]
  // JSON всегда: success/conflicts → exit 0; ошибка аргументов/движка/модуля → exit 1.
  try {
    const flags = process.argv.slice(3)
    let modulesArg = null
    let enginesArg = null
    let force = false
    for (let i = 0; i < flags.length; i++) {
      const a = flags[i]
      if (a === '--force') force = true
      else if (a === '--modules') { modulesArg = flagValue(flags, i, '--modules'); i++ }
      else if (a === '--engines') { enginesArg = flagValue(flags, i, '--engines'); i++ }
      else throw new Error(`Unknown argument: ${a}`)
    }
    if (modulesArg === null) throw new Error('Missing required --modules')
    const selected = modulesArg.split(',').map((s) => s.trim()).filter(Boolean)
    const engines = enginesArg === null ? undefined : enginesArg.split(',').map((s) => s.trim()).filter(Boolean)
    const { manifest, conflicts } = runInit({
      selected,
      engines,
      projectDir: PROJECT_DIR,
      force,
      now: new Date().toISOString(),
    })
    const ok = conflicts.length === 0
    process.stdout.write(JSON.stringify({ ok, manifest: ok ? manifest : null, conflicts }, null, 2) + '\n')
    process.exit(0)
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + '\n')
    process.stderr.write(`[glue] init: ${e.message}\n`)
    process.exit(1)
  }
} else {
  emitUnknown(cmd)
}
