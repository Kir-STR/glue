import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = [
  'operator-gate', 'secret-hygiene', 'worktree-workflow', 'pr-policy',
  'review-loop', 'subagent-dispatch', 'safety', 'architectural-invariants',
  'versioning', 'glossary',
]

test('registry has exactly the 10 slice-1 modules, no retro-loop', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  assert.deepEqual(Object.keys(reg).sort(), [...EXPECTED].sort())
  assert.ok(!('retro-loop' in reg), 'retro-loop must be deferred to slice 3')
})

test('every module declares required fields and valid dependsOn', () => {
  const reg = JSON.parse(readFileSync(join(PACK, 'rules', 'registry.json'), 'utf8'))
  const ids = Object.keys(reg)
  for (const [id, m] of Object.entries(reg)) {
    assert.equal(typeof m.title, 'string')
    assert.ok(Array.isArray(m.templates) && m.templates.length > 0, `${id}.templates`)
    assert.equal(typeof m.instructionBlock, 'string')
    assert.ok(Array.isArray(m.dependsOn), `${id}.dependsOn`)
    for (const dep of m.dependsOn) assert.ok(ids.includes(dep), `${id} dep ${dep}`)
  }
})

test('contract points to existing registry/template dirs', () => {
  const c = JSON.parse(readFileSync(join(PACK, 'glue.contract.json'), 'utf8'))
  assert.equal(c.contractVersion, '1')
  assert.ok(readFileSync(join(PACK, c.registry))) // не бросает
})
