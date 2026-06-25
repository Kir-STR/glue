import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPlan } from '../lib/writer.mjs'
import { hashContent } from '../lib/hash.mjs'

test('writes planned files and publishes manifest last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const content = '# rule\n'
  const p = { writes: [{ targetPath: '.claude/rules/alpha.md', plannedHash: hashContent(content), content, sourcePack: 'glue-rules', sourceTemplate: 'alpha.md', packVersion: '0.2.0', expectedCurrentHash: null }], materialized: [], deletes: [], conflicts: [] }
  const m = applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' })
  assert.equal(readFileSync(join(dir, '.claude/rules/alpha.md'), 'utf8'), content)
  assert.equal(m.status, 'complete')
})

test('manifest includes materialized (recovery) files, not just writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const p = {
    writes: [],
    materialized: [{ targetPath: '.claude/rules/alpha.md', plannedHash: 'h1', sourcePack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'alpha.md' }],
    deletes: [], conflicts: [],
  }
  const m = applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' })
  assert.ok(m.files.some((f) => f.targetPath === '.claude/rules/alpha.md' && f.writtenHash === 'h1'),
    'materialized file present in manifest')
})

test('TOCTOU: changed file aborts whole apply, manifest not published', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(dir, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(dir, '.claude/rules/alpha.md'), 'CHANGED after planning\n')
  const p = { writes: [{ targetPath: '.claude/rules/alpha.md', plannedHash: hashContent('new\n'), content: 'new\n', sourcePack: 'glue-rules', sourceTemplate: 'alpha.md', packVersion: '0.2.0', expectedCurrentHash: hashContent('what planner saw\n') }], materialized: [], deletes: [], conflicts: [] }
  assert.throws(() => applyPlan({ plan: p, projectDir: dir, engines: ['claude'], modules: ['alpha'], deliveryId: 'd', completedAt: 't' }), /TOCTOU|changed|abort/)
  assert.equal(existsSync(join(dir, '.glue', 'manifest.json')), false, 'manifest must not be published on abort')
})
