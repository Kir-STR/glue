import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDependencies } from '../lib/resolve.mjs'

const reg = {
  'worktree-workflow': { dependsOn: [] },
  'pr-policy': { dependsOn: ['worktree-workflow'] },
  'review-loop': { dependsOn: ['pr-policy'] },
}

test('pulls deps in topological order', () => {
  assert.deepEqual(resolveDependencies(reg, ['review-loop']),
    ['worktree-workflow', 'pr-policy', 'review-loop'])
})
test('throws on unknown module', () => {
  assert.throws(() => resolveDependencies(reg, ['nope']), /Unknown module/)
})
test('throws on cycle', () => {
  const c = { a: { dependsOn: ['b'] }, b: { dependsOn: ['a'] } }
  assert.throws(() => resolveDependencies(c, ['a']), /cycle/)
})
