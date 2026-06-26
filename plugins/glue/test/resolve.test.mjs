import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDependencies } from '../src/resolve.mjs'

const REG = {
  a: { dependsOn: [] },
  b: { dependsOn: ['a'] },
  c: { dependsOn: ['b'] },
}

test('resolveDependencies дотягивает зависимости в топопорядке', () => {
  assert.deepEqual(resolveDependencies(REG, ['c']), ['a', 'b', 'c'])
})

test('resolveDependencies без дублей при пересечении', () => {
  assert.deepEqual(resolveDependencies(REG, ['b', 'c']), ['a', 'b', 'c'])
})

test('resolveDependencies бросает на неизвестный модуль', () => {
  assert.throws(() => resolveDependencies(REG, ['nope']), /Unknown module: nope/)
})

test('resolveDependencies бросает на цикл', () => {
  const cyc = { x: { dependsOn: ['y'] }, y: { dependsOn: ['x'] } }
  assert.throws(() => resolveDependencies(cyc, ['x']), /Dependency cycle/)
})
