import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeDeliveryValid } from '../src/gate.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-gate-')) }
// Материализуем реальную нативную доставку (claude) через движок среза 2.
function seed(d) { runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' }) }

test('валидная нативная доставка → true', () => {
  const d = tmp()
  try { seed(d); assert.equal(nativeDeliveryValid(d), true) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → false', () => {
  const d = tmp()
  try { assert.equal(nativeDeliveryValid(d), false) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленый Claude-target (hash mismatch) → false', () => {
  const d = tmp()
  try {
    seed(d)
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'РУЧНАЯ ПРАВКА', 'utf8')
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('удалённый Claude-target → false', () => {
  const d = tmp()
  try {
    seed(d)
    rmSync(join(d, 'CLAUDE.md'))
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('foreign producerPack в манифесте → false', () => {
  const d = tmp()
  try {
    seed(d)
    const p = join(d, '.glue/manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.files[0].producerPack = 'glue-rules'
    writeFileSync(p, JSON.stringify(m), 'utf8')
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('AGENTS.md отсутствует, но Claude валиден → true (gate не требует движков)', () => {
  const d = tmp()
  try {
    seed(d) // engines=['claude'] → AGENTS.md и не создавался
    assert.equal(existsSync(join(d, 'AGENTS.md')), false)
    assert.equal(nativeDeliveryValid(d), true)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
