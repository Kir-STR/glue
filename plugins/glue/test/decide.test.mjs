import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePlan } from '../src/plan.mjs'

const T = (targetPath, plannedHash) => ({ targetPath, plannedHash, content: 'C', sourceTemplate: 's.md', kind: 'rule' })
const disk = (map) => (p) => (p in map ? map[p] : null)

test('absent на диске → write с expectedCurrentHash null', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({}), force: false })
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].expectedCurrentHash, null)
  assert.equal(r.writes[0].plannedHash, 'H')
})

test('current == plannedHash → materialized (recovery)', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'H' }), force: false })
  assert.equal(r.writes.length, 0)
  assert.equal(r.materialized.length, 1)
  assert.equal(r.materialized[0].plannedHash, 'H')
})

test('managed и current == writtenHash → write (update)', () => {
  const prev = { files: [{ targetPath: '.claude/rules/a.md', writtenHash: 'OLD' }] }
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'NEW')], prevManifest: prev, diskHashFn: disk({ '.claude/rules/a.md': 'OLD' }), force: false })
  assert.equal(r.writes.length, 1)
  assert.equal(r.writes[0].expectedCurrentHash, 'OLD')
  assert.equal(r.conflicts.length, 0)
})

test('current != plannedHash и unmanaged → conflict', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'HAND' }), force: false })
  assert.equal(r.writes.length, 0)
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0].reason, 'hash mismatch')
})

test('force перезаписывает конфликт (expectedCurrentHash = current)', () => {
  const r = decidePlan({ targets: [T('.claude/rules/a.md', 'H')], prevManifest: null, diskHashFn: disk({ '.claude/rules/a.md': 'HAND' }), force: true })
  assert.equal(r.conflicts.length, 0)
  assert.equal(r.writes[0].expectedCurrentHash, 'HAND')
})

test('снятый managed-файл без правок → delete', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({ '.claude/rules/old.md': 'W' }), force: false })
  assert.deepEqual(r.deletes, [{ targetPath: '.claude/rules/old.md', expectedCurrentHash: 'W' }])
})

test('снятый правленный файл → conflict (без force)', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({ '.claude/rules/old.md': 'HAND' }), force: false })
  assert.equal(r.deletes.length, 0)
  assert.equal(r.conflicts[0].reason, 'dropped file hand-edited')
})

test('снятый уже отсутствующий файл → ничего', () => {
  const prev = { files: [{ targetPath: '.claude/rules/old.md', writtenHash: 'W' }] }
  const r = decidePlan({ targets: [], prevManifest: prev, diskHashFn: disk({}), force: false })
  assert.equal(r.deletes.length, 0)
  assert.equal(r.conflicts.length, 0)
})
