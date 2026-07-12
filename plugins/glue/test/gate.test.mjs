import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, renameSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeDeliveryValid } from '../src/gate.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-gate-')) }
// Материализуем реальную нативную доставку (claude) через движок среза 2.
function seed(d) { runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' }) }

test('валидная нативная доставка → true', () => {
  const d = tmp()
  try { seed(d); assert.equal(nativeDeliveryValid(d), true) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → false', () => {
  const d = tmp()
  try { assert.equal(nativeDeliveryValid(d), false) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленый Claude-target (present, hash mismatch) → true (presence-gate)', () => {
  const d = tmp()
  try {
    seed(d)
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'РУЧНАЯ ПРАВКА', 'utf8')
    // вариант A: файл на месте → native (расхождение — сигнал changed в status, не fallback)
    assert.equal(nativeDeliveryValid(d), true)
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

test('директория (не regular file) на месте Claude-target → false', () => {
  const d = tmp()
  try {
    seed(d)
    rmSync(join(d, '.claude/rules/operator-gate.md'))
    mkdirSync(join(d, '.claude/rules/operator-gate.md')) // каталог вместо файла — не regular file
    assert.equal(nativeDeliveryValid(d), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('symlink на валидный файл → true (stat следует по ссылке, как harness)', (t) => {
  const d = tmp()
  try {
    seed(d)
    // Подменяем target symlink'ом на реальный файл с валидным содержимым.
    const rule = join(d, '.claude/rules/operator-gate.md')
    const real = join(d, '.claude/rules/operator-gate.real.md')
    renameSync(rule, real)
    try { symlinkSync(real, rule) }
    catch (e) { if (e.code === 'EPERM' || e.code === 'ENOSYS') return t.skip('symlink недоступен без привилегий'); throw e }
    assert.equal(nativeDeliveryValid(d), true) // gate следует по symlink — доставка native
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
