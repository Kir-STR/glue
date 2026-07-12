import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSessionStart } from '../src/session-start.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-ss-')) }

test('native валиден → stdout {} , stderr пусто, exit 0, диск не тронут', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    const before = JSON.stringify(snapshot(d))
    const r = runSessionStart(d)
    assert.equal(r.stdout, '{}')
    assert.doesNotMatch(r.stdout, /systemMessage/) // native молчит — нет UX-сообщения
    assert.equal(r.stderr, '')
    assert.equal(r.exitCode, 0)
    assert.equal(JSON.stringify(snapshot(d)), before) // read-only: ничего не записано
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → fallback инжектит defaults (тела правил) + systemMessage пользователю', () => {
  const d = tmp()
  try {
    const r = runSessionStart(d)
    assert.equal(r.exitCode, 0)
    const payload = JSON.parse(r.stdout)
    const ctx = payload.hookSpecificOutput.additionalContext
    assert.match(ctx, /<glue>/)
    assert.match(ctx, /operator-gate|Operator gate/i) // дефолтный модуль operator-gate в инъекции
    assert.match(payload.systemMessage, /не инициализирован/i) // UX-сообщение пользователю на экран
    assert.match(payload.systemMessage, /\/glue:init/)
    assert.equal(r.stderr, '') // диагностику несёт systemMessage; stderr при exit 0 невидим
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('правленое правило (файл на месте) → native молчит, без инъекции', () => {
  const d = tmp()
  try {
    // Вариант A: ручная правка правила не роняет native — ноль инъекции поверх живого правила.
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, now: 'T' })
    writeFileSync(join(d, '.claude/rules/operator-gate.md'), 'ПРОЕКТНАЯ ПРАВКА ПРАВИЛА', 'utf8')
    const r = runSessionStart(d)
    assert.equal(r.stdout, '{}')                       // native — ничего не впрыснуто
    assert.doesNotMatch(r.stdout, /systemMessage/)     // и нет UX-шума
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback с usable-манифестом инжектит его modules', () => {
  const d = tmp()
  try {
    // материализуем доставку, затем ломаем native (удаляем CLAUDE.md) → fallback
    runInit({ selected: ['secret-hygiene'], engines: ['claude'], projectDir: d, now: 'T' })
    rmSync(join(d, 'CLAUDE.md')) // native invalid (файл отсутствует), манифест usable
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /secret|hygiene/i) // инжектит выбранный модуль из манифеста
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('usable-манифест с modules:[] → инжект пусто (не defaults)', () => {
  const d = tmp()
  try {
    // init без выбора модулей: материализует только инструкц-файл (CLAUDE.md), modules:[]
    runInit({ selected: [], engines: ['claude'], projectDir: d, now: 'T' })
    rmSync(join(d, 'CLAUDE.md')) // native invalid (файл отсутствует), манифест usable, modules:[]
    const r = runSessionStart(d)
    const payload = JSON.parse(r.stdout)
    const ctx = payload.hookSpecificOutput.additionalContext
    assert.match(ctx, /не выбрано|не применяется/i) // честная заметка, без defaults
    assert.doesNotMatch(ctx, /Operator gate/i)       // дефолты НЕ инжектированы
    assert.match(payload.systemMessage, /модули не выбраны/i) // пустой fallback — свой UX-текст
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('foreign-манифест (producerPack glue-rules) → fallback defaults, НЕ его modules', () => {
  const d = tmp()
  try {
    // foreign-манифест: schemaVersion '2', но чужой producerPack; modules — не-дефолтный (glossary).
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify({
      schemaVersion: '2', status: 'complete', engines: ['claude'],
      modules: [{ id: 'glossary', decision: 'added-from-template', targetPaths: ['.claude/rules/glossary.md'] }],
      files: [{ producerPack: 'glue-rules', targetPath: 'CLAUDE.md', writtenHash: 'x' }],
    }), 'utf8')
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /operator-gate|Operator-gate/i)   // defaults инжектированы
    assert.doesNotMatch(ctx, /Глоссарий|Glossary/i)     // foreign modules (glossary) НЕ инжектированы
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback: v2-манифест → выбор из manifest.modules, не дефолты', () => {
  const d = tmp()
  try {
    // versioning — НЕ default-модуль: тихий откат к дефолтам не совпадёт с ожиданием.
    runInit({ selected: ['versioning'], engines: ['claude'], projectDir: d, now: 'T' })
    rmSync(join(d, 'CLAUDE.md')) // ломаем native → fallback
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /версионировани/i)      // тело versioning.md инжектировано
    assert.doesNotMatch(ctx, /Operator-gate/) // дефолты НЕ подтянулись
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback: local-модуль в манифесте не сваливает выбор в дефолты', () => {
  const d = tmp()
  try {
    runInit({ selected: ['versioning'], engines: ['claude'], projectDir: d, now: 'T' })
    const p = join(d, '.glue', 'manifest.json')
    const m = JSON.parse(readFileSync(p, 'utf8'))
    m.modules.push({ id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] })
    writeFileSync(p, JSON.stringify(m), 'utf8')
    rmSync(join(d, 'CLAUDE.md'))
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /версионировани/i)      // выбранный модуль инжектирован
    assert.doesNotMatch(ctx, /Operator-gate/) // дефолты НЕ подтянулись
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// Снимок дерева проекта (относительные пути файлов) для проверки read-only.
function snapshot(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? prefix + '/' + name.name : name.name
    if (name.isDirectory()) out.push(...snapshot(join(dir, name.name), rel))
    else out.push(rel)
  }
  return out
}
