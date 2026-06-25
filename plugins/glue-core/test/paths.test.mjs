import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { safeSourcePath, safeTargetPath } from '../lib/paths.mjs'

const PACK = '/packs/glue-rules'
const PROJ = '/proj'

test('source within pack ok', () => {
  assert.equal(
    safeSourcePath(PACK, 'rules/templates/x.md'),
    resolve(PACK, 'rules/templates/x.md'),
  )
})
test('source .. escape rejected', () => {
  assert.throws(() => safeSourcePath(PACK, '../other/x.md'), /escape/)
})
test('source absolute rejected', () => {
  assert.throws(() => safeSourcePath(PACK, '/etc/passwd'), /absolute|escape|relative/)
})
test('target within allowed zone ok', () => {
  assert.ok(safeTargetPath(PROJ, '.claude/rules/x.md'))
  assert.ok(safeTargetPath(PROJ, 'CLAUDE.md'))
  assert.ok(safeTargetPath(PROJ, '.glue/manifest.json'))
})
test('target outside zone rejected', () => {
  assert.throws(() => safeTargetPath(PROJ, 'src/evil.js'), /zone/)
})
test('target .. escape rejected', () => {
  assert.throws(() => safeTargetPath(PROJ, '../outside.md'), /escape|zone/)
})
