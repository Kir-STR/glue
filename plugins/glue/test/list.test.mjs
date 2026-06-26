import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listModules } from '../src/bundle.mjs'

test('listModules возвращает плоский список с нормализованными полями (включая note)', () => {
  const reg = {
    'a': { title: 'A', group: 'g1', default: true, note: 'заметка A', templates: ['a.md'], instructionBlock: 'a', dependsOn: [] },
    'b': { title: 'B', templates: ['b.md'], instructionBlock: 'b', dependsOn: ['a'] },
  }
  const list = listModules(reg)
  assert.deepEqual(list, [
    { id: 'a', title: 'A', group: 'g1', default: true, note: 'заметка A', dependsOn: [] },
    { id: 'b', title: 'B', group: null, default: false, note: null, dependsOn: ['a'] },
  ])
})
