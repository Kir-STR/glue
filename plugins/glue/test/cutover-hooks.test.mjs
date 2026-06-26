import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // plugins/glue/test
const PLUGINS_DIR = join(HERE, '..', '..')           // plugins/
const REPO_ROOT = join(PLUGINS_DIR, '..')            // корень репо

function pluginDirs() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}

test('cutover: ровно один плагин объявляет SessionStart-хук, и это glue', () => {
  const withSessionStart = []
  for (const name of pluginDirs()) {
    const hooksPath = join(PLUGINS_DIR, name, 'hooks', 'hooks.json')
    if (!existsSync(hooksPath)) continue // плагины без hooks/ игнорируем (устойчивость)
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'))
    if (hooks?.hooks?.SessionStart) withSessionStart.push(name)
  }
  assert.deepEqual(withSessionStart.sort(), ['glue'])
})

test('cutover: marketplace содержит только glue → ./plugins/glue', () => {
  const mp = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.deepEqual(mp.plugins.map((p) => p.name), ['glue'])
  const glue = mp.plugins.find((p) => p.name === 'glue')
  assert.equal(glue.source, './plugins/glue')
})

test('cutover: legacy-директории удалены, glue остаётся', () => {
  assert.ok(existsSync(join(PLUGINS_DIR, 'glue')))
  assert.ok(!existsSync(join(PLUGINS_DIR, 'glue-core')))
  assert.ok(!existsSync(join(PLUGINS_DIR, 'glue-rules')))
})
