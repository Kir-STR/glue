import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPackContract, loadPackRegistry, validatePackRegistry } from '../lib/registry.mjs'
import { mergePackRegistries } from '../lib/discovery.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pack-a')

test('loads contract and registry', () => {
  const c = loadPackContract(FIX)
  assert.equal(c.contractVersion, '1')
  const reg = loadPackRegistry(FIX, c)
  assert.ok(Object.keys(reg).length >= 1)
})
test('validate rejects missing title', () => {
  assert.throws(() => validatePackRegistry({ x: { dependsOn: [] } }), /title/)
})
test('cross-pack id collision fails fast', () => {
  const p1 = { name: 'p1', registry: { dup: { title: 'A', dependsOn: [] } } }
  const p2 = { name: 'p2', registry: { dup: { title: 'B', dependsOn: [] } } }
  assert.throws(() => mergePackRegistries([p1, p2]), /collision|dup/)
})
test('cross-pack dependsOn is rejected (within-pack only)', () => {
  const p1 = { name: 'p1', registry: { a: { title: 'A', dependsOn: ['b'] } } }
  const p2 = { name: 'p2', registry: { b: { title: 'B', dependsOn: [] } } }
  assert.throws(() => mergePackRegistries([p1, p2]), /cross-pack|within-pack|unknown/)
})
