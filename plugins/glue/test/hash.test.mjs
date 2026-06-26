import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashContent } from '../src/hash.mjs'

test('hashContent детерминирован и hex', () => {
  const h = hashContent('abc')
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(hashContent('abc'), h)
})

test('hashContent различает входы', () => {
  assert.notEqual(hashContent('a'), hashContent('b'))
})
