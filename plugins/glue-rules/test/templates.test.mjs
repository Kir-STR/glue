import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')

test('each registry module has its template file present', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const tdir = JSON.parse(readFileSync(join(PACK, 'glue.contract.json'), 'utf8')).templatesDir
  for (const [id, m] of Object.entries(reg)) {
    for (const t of m.templates) {
      assert.ok(existsSync(join(PACK, tdir, t)), `missing template ${t} for ${id}`)
    }
  }
})

test('no .invoker/ or retro-infra references survive in slice-1 templates', () => {
  const tdir = join(PACK, 'rules', 'templates')
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  for (const m of Object.values(reg)) {
    for (const t of m.templates) {
      const text = readFileSync(join(tdir, t), 'utf8')
      assert.ok(!/\.invoker\//.test(text), `${t} references .invoker/`)
      assert.ok(!/ideas_4_rules|retro-\*/.test(text), `${t} references retro infra`)
    }
  }
})

test('fallback layer preserved for old core 0.1.1 (top-level rules/*.md kept)', () => {
  // старый core читает rules/ нерекурсивно; эти файлы должны остаться до PR2 cutover
  assert.ok(existsSync(join(PACK, 'rules', 'commit-discipline.md')), 'commit-discipline kept')
  assert.ok(existsSync(join(PACK, 'rules', 'secret-hygiene.md')), 'secret-hygiene kept')
  // новые модули — в подкаталоге, нерекурсивный fallback их не подхватит (нет дубля)
  assert.ok(existsSync(join(PACK, 'rules', 'templates', 'operator-gate.md')))
})
