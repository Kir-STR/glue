import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
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
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [{ producerPack: PRODUCER }] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [] }), true)
  assert.equal(isUsablePrevManifest({ schemaVersion: '1', files: [{ producerPack: 'glue-rules' }] }), false)
  assert.equal(isUsablePrevManifest({ schemaVersion: '2', files: [] }), false)
  assert.equal(isUsablePrevManifest(null), false)
})
