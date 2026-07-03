import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadContract, loadBundle, validateBundle } from '../src/bundle.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('loadContract читает glue.contract_v1.json без contractVersion', () => {
  const c = loadContract(ROOT)
  assert.equal(c.registry, 'content/bundle.json')
  assert.equal(c.modulesDir, 'content/modules')
  assert.equal(c.instructionsDir, 'content/instructions')
  assert.equal('contractVersion' in c, false)
})

test('loadBundle загружает встроенный реестр с 10 модулями', () => {
  const reg = loadBundle(ROOT)
  assert.equal(Object.keys(reg).length, 10)
  assert.ok(reg['operator-gate'])
  assert.equal(reg['retro-loop'], undefined)
})

test('validateBundle принимает модуль без instructionBlock (мёртвое поле удалено)', () => {
  const reg = validateBundle({ x: { title: 'X', templates: ['x.md'], dependsOn: [] } })
  assert.ok(reg.x)
})

test('validateBundle отклоняет модуль без title', () => {
  assert.throws(
    () => validateBundle({ x: { templates: ['x.md'], dependsOn: [] } }),
    /title/,
  )
})

test('validateBundle отклоняет dependsOn на неизвестный модуль', () => {
  assert.throws(
    () => validateBundle({ a: { title: 'A', templates: ['a.md'], dependsOn: ['nope'] } }),
    /unknown 'nope'/,
  )
})
