import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverPacks, mergePackRegistries } from '../lib/discovery.mjs'

const FIX_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

test('discoverPacks returns [] for missing registry file', () => {
  const result = discoverPacks(join(FIX_DIR, 'nonexistent.json'))
  assert.deepEqual(result, [])
})

test('mergePackRegistries merges two packs without collision', () => {
  const p1 = { name: 'p1', registry: { alpha: { title: 'Alpha', templates: ['alpha.md'], instructionBlock: 'alpha', dependsOn: [] } } }
  const p2 = { name: 'p2', registry: { beta: { title: 'Beta', templates: ['beta.md'], instructionBlock: 'beta', dependsOn: [] } } }
  const { merged, owner } = mergePackRegistries([p1, p2])
  assert.ok('alpha' in merged)
  assert.ok('beta' in merged)
  assert.equal(owner['alpha'], 'p1')
  assert.equal(owner['beta'], 'p2')
})
