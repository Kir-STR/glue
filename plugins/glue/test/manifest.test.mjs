import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildManifest, readManifest, writeManifest, isUsablePrevManifest, SCHEMA_VERSION, PRODUCER,
} from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-mf-')) }

test('buildManifest задаёт schemaVersion/status', () => {
  const m = buildManifest({ deliveryId: 'd', completedAt: 'c', engines: ['claude'], modules: ['a'], files: [] })
  assert.equal(m.schemaVersion, SCHEMA_VERSION)
  assert.equal(m.status, 'complete')
  assert.deepEqual(m.modules, ['a'])
})

test('readManifest отсутствующего → null', () => {
  const d = tmp()
  try { assert.equal(readManifest(d), null) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('write→read round-trip; tmp убран', () => {
  const d = tmp()
  try {
    const m = buildManifest({ deliveryId: 'd', completedAt: 'c', engines: ['claude'], modules: [], files: [] })
    writeManifest(d, m)
    assert.deepEqual(readManifest(d), m)
    assert.equal(existsSync(join(d, '.glue', 'manifest.json.tmp')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('readManifest corrupt JSON → null (не throw)', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue', 'manifest.json'), '{not json', 'utf8')
    assert.equal(readManifest(d), null)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('isUsablePrevManifest: glue → true, чужой producerPack → false', () => {
  const modules = [{ id: 'operator-gate' }]
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules, files: [{ producerPack: PRODUCER }] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules, files: [] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules, files: [{ producerPack: 'glue-rules' }] }), false)
  assert.equal(isUsablePrevManifest(null), false)
})

test('isUsablePrevManifest: битые files (не-объекты, не-массив) → false, не бросает', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', files: [null] }), false)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', files: ['строка'] }), false)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', files: 42 }), false)
})

test('buildManifest пишет schemaVersion 2 и объектные modules round-trip', () => {
  const d = tmp()
  try {
    const modules = [{ id: 'operator-gate', decision: 'added-from-template', targetPaths: ['.claude/rules/operator-gate.md'], referenceTemplate: 'operator-gate.md' }]
    const m = buildManifest({ deliveryId: 'T', completedAt: 'T', engines: ['claude'], modules, files: [] })
    assert.equal(m.schemaVersion, '2')
    writeManifest(d, m)
    const r = readManifest(d)
    assert.deepEqual(r.modules, modules)
    assert.equal(isUsablePrevManifest(r), true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('v1-манифест (schemaVersion 1, string modules) → unusable', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', modules: ['operator-gate'], files: [] }), false)
})

test('v2 с битыми modules (строки вместо объектов) → unusable', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules: ['operator-gate'], files: [] }), false)
})

test('isUsablePrevManifest: битые modules (null-элемент, не-массив) → false, не throw', () => {
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules: [null], files: [] }), false)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', modules: 42, files: [] }), false)
})

test('manifest.schema_v2.json парсится и перечисляет все 6 decision', () => {
  const schema = JSON.parse(readFileSync(new URL('../manifest.schema_v2.json', import.meta.url), 'utf8'))
  assert.deepEqual(
    schema.properties.modules.items.properties.decision.enum,
    ['added-from-template', 'tailored-from-template', 'adopted-existing', 'merged', 'declined', 'local']
  )
})
