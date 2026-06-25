import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, writeManifest, readManifest } from '../lib/manifest.mjs'

test('build sets status complete and roundtrips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  const m = buildManifest({
    deliveryId: 'd1', completedAt: '2026-06-25T00:00:00Z', engines: ['claude'],
    modules: ['operator-gate'],
    files: [{ producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: 'abc' }],
  })
  assert.equal(m.status, 'complete')
  writeManifest(dir, m)
  assert.deepEqual(readManifest(dir), m)
})
test('readManifest returns null when absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glue-'))
  assert.equal(readManifest(dir), null)
})
