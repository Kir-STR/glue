import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { safeTargetPath } from '../src/paths.mjs'

const DIR = resolve('/tmp/proj')

test('safeTargetPath разрешает файлы в зонах', () => {
  assert.equal(safeTargetPath(DIR, '.claude/rules/x.md'), resolve(DIR, '.claude/rules/x.md'))
  assert.equal(safeTargetPath(DIR, 'CLAUDE.md'), resolve(DIR, 'CLAUDE.md'))
  assert.equal(safeTargetPath(DIR, '.glue/manifest.json'), resolve(DIR, '.glue/manifest.json'))
})

test('safeTargetPath бросает на абсолютный rel', () => {
  assert.throws(() => safeTargetPath(DIR, resolve('/etc/passwd')), /must be relative/)
})

test('safeTargetPath бросает на escape из проекта', () => {
  assert.throws(() => safeTargetPath(DIR, '../outside.md'), /escapes project/)
})

test('safeTargetPath бросает на путь вне зон', () => {
  assert.throws(() => safeTargetPath(DIR, 'src/code.js'), /outside allowed zone/)
})
