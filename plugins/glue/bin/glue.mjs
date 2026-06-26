#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// Реализованы: list (срез 1), status + session-start (срез 3). init — срез 4.

import { loadBundle, listModules } from '../src/bundle.mjs'
import { deliveryStatus } from '../src/status.mjs'
import { runSessionStart } from '../src/session-start.mjs'

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const [cmd] = process.argv.slice(2)

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
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.exitCode)
} else {
  process.stderr.write(`[glue] неизвестная команда: ${cmd ?? '(нет)'}\n`)
  process.exit(1)
}
