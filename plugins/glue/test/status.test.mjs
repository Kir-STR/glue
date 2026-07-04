import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deliveryStatus } from '../src/status.mjs'
import { runInit } from '../src/init.mjs'
import { hashContent } from '../src/hash.mjs'
import { buildManifest, writeManifest, readManifest } from '../src/manifest.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-status-')) }

// Хелпер: manifest v2 с заданным decision для одного управляемого файла.
function seedAdoptLike(d, decision) {
  runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
  const p = join(d, '.glue', 'manifest.json')
  const m = JSON.parse(readFileSync(p, 'utf8'))
  m.modules.find((x) => x.id === 'operator-gate').decision = decision
  // Контент отличается от шаблона → кандидат в drift.
  const target = join(d, '.claude', 'rules', 'operator-gate.md')
  writeFileSync(target, 'ПРОЕКТНАЯ ВЕРСИЯ', 'utf8')
  m.files.find((f) => f.targetPath === '.claude/rules/operator-gate.md').writtenHash = hashContent('ПРОЕКТНАЯ ВЕРСИЯ')
  writeFileSync(p, JSON.stringify(m), 'utf8')
}

test('чистая нативная доставка → mode native, пустые наборы', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    const s = deliveryStatus(d)
    assert.equal(s.mode, 'native')
    assert.deepEqual(s.missing, [])
    assert.deepEqual(s.changed, [])
    assert.deepEqual(s.drift, [])
    assert.equal(s.engines.claude.status, 'ok')
    assert.equal(s.engines.claude.targetPath, 'CLAUDE.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → fallback, reason missing-or-unreadable-manifest, не бросает', () => {
  const d = tmp()
  try {
    const s = deliveryStatus(d)
    assert.equal(s.mode, 'fallback')
    assert.equal(s.reason, 'missing-or-unreadable-manifest')
    assert.deepEqual(s.engines, {})
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('foreign манифест → fallback, reason unusable-manifest', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify({ schemaVersion: '1', status: 'complete', engines: ['claude'], modules: [], files: [{ producerPack: 'glue-rules', targetPath: 'CLAUDE.md', writtenHash: 'x' }] }), 'utf8')
    const s = deliveryStatus(d)
    assert.equal(s.reason, 'unusable-manifest')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленый файл → changed', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'ПРАВКА', 'utf8')
    const s = deliveryStatus(d)
    assert.ok(s.changed.includes('.claude/rules/operator-gate.md'))
    assert.equal(s.engines.claude.status, 'ok') // CLAUDE.md не тронут
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: writtenHash старого контента, диск == written, текущий plannedHash ≠ → drift', () => {
  const d = tmp()
  try {
    // Готовим состояние «контент обновился после init»: на диске старый контент,
    // writtenHash = его хеш (значит НЕ changed), но текущий bundle даёт другой plannedHash.
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    const ruleOld = 'СТАРЫЙ КОНТЕНТ ПРАВИЛА'
    const claudeOld = 'СТАРЫЙ CLAUDE'
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), ruleOld, 'utf8')
    writeFileSync(join(d, 'CLAUDE.md'), claudeOld, 'utf8')
    const m = buildManifest({
      deliveryId: 'T', completedAt: 'T', engines: ['claude'],
      modules: [{ id: 'operator-gate', decision: 'added-from-template', targetPaths: ['.claude/rules/operator-gate.md'], referenceTemplate: 'operator-gate.md' }],
      files: [
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: hashContent(ruleOld) },
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'CLAUDE.md.tmpl', targetPath: 'CLAUDE.md', writtenHash: hashContent(claudeOld) },
      ],
    })
    writeManifest(d, m)
    const s = deliveryStatus(d)
    assert.ok(s.drift.includes('.claude/rules/operator-gate.md')) // текущий bundle plannedHash ≠ hashContent(ruleOld)
    assert.deepEqual(s.changed, []) // диск == writtenHash → не changed
    assert.equal(s.engines.claude.status, 'drift')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('битый bundle (unknown module в манифесте) → errors непуст, не бросает', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude/rules'), { recursive: true })
    writeFileSync(join(d, 'CLAUDE.md'), 'C', 'utf8')
    const m = buildManifest({
      deliveryId: 'T', completedAt: 'T', engines: ['claude'],
      modules: [{ id: 'nonexistent-module', decision: 'added-from-template', targetPaths: ['.claude/rules/nonexistent-module.md'], referenceTemplate: 'nonexistent-module.md' }],
      files: [{ producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'CLAUDE.md.tmpl', targetPath: 'CLAUDE.md', writtenHash: hashContent('C') }],
    })
    writeManifest(d, m)
    const s = deliveryStatus(d)
    assert.ok(s.errors.length > 0)        // buildTargets бросил на unknown module
    assert.deepEqual(s.drift, [])         // drift не вычислен
    assert.equal(s.engines.claude.status, 'ok') // CLAUDE.md на диске == written; drift не вычислен → ok
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('манифест с files:[null] → fallback unusable-manifest, не бросает', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify({ schemaVersion: '1', status: 'complete', engines: ['claude'], modules: [], files: [null] }), 'utf8')
    const s = deliveryStatus(d)
    assert.equal(s.mode, 'fallback')
    assert.equal(s.reason, 'unusable-manifest')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('движок в engines без entry в files → errors, не drift', () => {
  const d = tmp()
  try {
    // валидная claude-доставка; затем в манифест дописан codex без файла в files
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    const m = readManifest(d)
    m.engines = ['claude', 'codex']
    writeManifest(d, m)
    writeFileSync(join(d, 'AGENTS.md'), 'рукописный AGENTS', 'utf8')
    const s = deliveryStatus(d)
    assert.ok(s.errors.some((e) => e.includes('codex')))  // несогласованность манифеста — ошибка
    assert.equal(s.engines.codex, undefined)              // не рапортуется как drift
    assert.equal(s.engines.claude.status, 'ok')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('target-путь — директория на диске → не бросает (readFileSync EISDIR)', () => {
  const d = tmp()
  try {
    // CLAUDE.md существует как ФАЙЛ (чтобы манифест был «полным»), а rule-target — ДИРЕКТОРИЯ
    mkdirSync(join(d, '.claude/rules/operator-gate.md'), { recursive: true }) // путь-файл, но это каталог
    writeFileSync(join(d, 'CLAUDE.md'), 'C', 'utf8')
    const m = buildManifest({
      deliveryId: 'T', completedAt: 'T', engines: ['claude'], modules: ['operator-gate'],
      files: [
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: hashContent('X') },
        { producerPack: 'glue', packVersion: '0.1.0', sourceTemplate: 'CLAUDE.md.tmpl', targetPath: 'CLAUDE.md', writtenHash: hashContent('C') },
      ],
    })
    writeManifest(d, m)
    let s
    assert.doesNotThrow(() => { s = deliveryStatus(d) })
    assert.ok(Array.isArray(s.missing)) // деградировал, не упал
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: added-from-template с отличием от шаблона → drift', () => {
  const d = tmp()
  try {
    seedAdoptLike(d, 'added-from-template')
    const s = deliveryStatus(d)
    assert.deepEqual(s.drift, ['.claude/rules/operator-gate.md'])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: tailored-from-template с отличием от шаблона → НЕ drift', () => {
  const d = tmp()
  try {
    seedAdoptLike(d, 'tailored-from-template')
    const s = deliveryStatus(d)
    assert.deepEqual(s.drift, [])
    assert.deepEqual(s.errors, [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('drift: local-модуль (id вне bundle) не роняет рехеш', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    const p = join(d, '.glue', 'manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.modules.push({ id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] })
    writeFileSync(p, JSON.stringify(m), 'utf8')
    const s = deliveryStatus(d)
    assert.deepEqual(s.errors, [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})
