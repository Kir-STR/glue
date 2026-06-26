import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterModuleBlocks } from '../src/blocks.mjs'

const TXT = [
  'head',
  '<!-- module:a -->',
  'A-body',
  '<!-- /module -->',
  '<!-- module:b -->',
  'B-body',
  '<!-- /module -->',
  'tail',
].join('\n')

test('filterModuleBlocks оставляет keep, вырезает прочие, снимает маркеры', () => {
  assert.equal(filterModuleBlocks(TXT, ['a']), ['head', 'A-body', 'tail'].join('\n'))
})

test('filterModuleBlocks с пустым keep вырезает все блоки', () => {
  assert.equal(filterModuleBlocks(TXT, []), ['head', 'tail'].join('\n'))
})

test('filterModuleBlocks бросает на вложенный блок', () => {
  const nested = '<!-- module:a -->\n<!-- module:b -->\nx\n<!-- /module -->\n<!-- /module -->'
  assert.throws(() => filterModuleBlocks(nested, ['a', 'b']), /nested module block/)
})

test('filterModuleBlocks бросает на непарный close', () => {
  assert.throws(() => filterModuleBlocks('x\n<!-- /module -->', []), /stray/)
})

test('filterModuleBlocks бросает на незакрытый блок', () => {
  assert.throws(() => filterModuleBlocks('<!-- module:a -->\nx', ['a']), /unclosed module block/)
})
