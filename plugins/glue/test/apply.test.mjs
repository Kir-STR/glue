import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyPlan } from '../src/apply.mjs'
import { hashContent } from '../src/hash.mjs'
import { readManifest } from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-apply-')) }
const write = (path, content, expectedCurrentHash = null) => ({
  targetPath: path, plannedHash: hashContent(content), content, sourceTemplate: 's.md', kind: 'rule', expectedCurrentHash,
})

test('applyPlan пишет файлы и публикует манифест последним', () => {
  const d = tmp()
  try {
    const m = applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'A')], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'A')
    assert.equal(m.files[0].producerPack, 'glue')
    assert.equal(m.files[0].packVersion, '0.1.0')
    assert.equal(m.files[0].writtenHash, hashContent('A'))
    assert.deepEqual(readManifest(d), m)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan включает materialized в манифест без перезаписи', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/m.md'), 'M', 'utf8')
    const m = applyPlan({
      plan: { writes: [], materialized: [{ targetPath: '.claude/rules/m.md', plannedHash: hashContent('M'), sourceTemplate: 'm.md', kind: 'rule' }], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['m'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(m.files[0].targetPath, '.claude/rules/m.md')
    assert.equal(m.files[0].writtenHash, hashContent('M'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort на TOCTOU-рассинхрон до любой записи', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/a.md'), 'DISK', 'utf8') // на диске не то, что ждал планировщик
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW', hashContent('EXPECTED'))], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /TOCTOU abort/)
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'DISK') // не перезаписан
    assert.equal(existsSync(join(d, '.glue/manifest.json')), false) // манифест не опубликован
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort если файл появился после планирования (expected null)', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/a.md'), 'RACE', 'utf8') // файл появился между plan и apply
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW', null)], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /file appeared since planning/)
    assert.equal(readFileSync(join(d, '.claude/rules/a.md'), 'utf8'), 'RACE') // не перезаписан
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan abort на symlink в target', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, 'real.txt'), 'R', 'utf8')
    try {
      symlinkSync(join(d, 'real.txt'), join(d, '.claude/rules/a.md'))
    } catch {
      return // среда без прав на symlink — пропускаем
    }
    assert.throws(() => applyPlan({
      plan: { writes: [write('.claude/rules/a.md', 'NEW')], materialized: [], deletes: [] },
      projectDir: d, engines: ['claude'], modules: ['a'], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    }), /symlink/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('applyPlan удаляет файлы из deletes', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, '.claude/rules/old.md'), 'OLD', 'utf8')
    applyPlan({
      plan: { writes: [], materialized: [], deletes: [{ targetPath: '.claude/rules/old.md', expectedCurrentHash: hashContent('OLD') }] },
      projectDir: d, engines: ['claude'], modules: [], packVersion: '0.1.0', deliveryId: 'D', completedAt: 'C',
    })
    assert.equal(existsSync(join(d, '.claude/rules/old.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
