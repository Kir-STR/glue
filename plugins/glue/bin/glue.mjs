#!/usr/bin/env node
// glue — единый плагин. Тонкий диспетчер подкоманд над src/.
// В этом срезе реализована только `list`; init/status/session-start — следующие срезы.

import { loadBundle, listModules } from '../src/bundle.mjs'

const [cmd] = process.argv.slice(2)

if (cmd === 'list') {
  // glue list → плоский список модулей встроенного bundle (JSON)
  const registry = loadBundle()
  process.stdout.write(JSON.stringify(listModules(registry), null, 2) + '\n')
  process.exit(0)
} else {
  process.stderr.write(`[glue] неизвестная команда: ${cmd ?? '(нет)'}\n`)
  process.exit(1)
}
