import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterModuleBlocks } from '../lib/blocks.mjs'

test('keeps selected block, drops others, strips markers', () => {
  const t = 'A\n<!-- module:x -->\nX\n<!-- /module -->\n<!-- module:y -->\nY\n<!-- /module -->\nB'
  assert.equal(filterModuleBlocks(t, ['x']), 'A\nX\n\nB')
})
test('throws on nested block', () => {
  assert.throws(() => filterModuleBlocks('<!-- module:a -->\n<!-- module:b -->', ['a']), /nested/)
})
