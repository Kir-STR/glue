import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runSessionStart } from '../src/session-start.mjs'
import { runInit } from '../src/init.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-ss-')) }

test('native валиден → stdout {} , stderr пусто, exit 0, диск не тронут', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    const before = JSON.stringify(snapshot(d))
    const r = runSessionStart(d)
    assert.equal(r.stdout, '{}')
    assert.equal(r.stderr, '')
    assert.equal(r.exitCode, 0)
    assert.equal(JSON.stringify(snapshot(d)), before) // read-only: ничего не записано
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('нет манифеста → fallback инжектит defaults (тела правил)', () => {
  const d = tmp()
  try {
    const r = runSessionStart(d)
    assert.equal(r.exitCode, 0)
    const payload = JSON.parse(r.stdout)
    const ctx = payload.hookSpecificOutput.additionalContext
    assert.match(ctx, /<glue>/)
    assert.match(ctx, /operator-gate|Operator gate/i) // дефолтный модуль operator-gate в инъекции
    assert.match(r.stderr, /native delivery inactive|init/i)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('fallback с usable-манифестом инжектит его modules', () => {
  const d = tmp()
  try {
    // материализуем доставку, затем ломаем native (правим CLAUDE.md) → fallback
    runInit({ selected: ['secret-hygiene'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    writeFileSync(join(d, 'CLAUDE.md'), 'РУЧНАЯ ПРАВКА', 'utf8') // native invalid, манифест usable
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /secret|hygiene/i) // инжектит выбранный модуль из манифеста
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('usable-манифест с modules:[] → инжект пусто (не defaults)', () => {
  const d = tmp()
  try {
    // init без выбора модулей: материализует только инструкц-файл (CLAUDE.md), modules:[]
    runInit({ selected: [], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    writeFileSync(join(d, 'CLAUDE.md'), 'ПРАВКА', 'utf8') // native invalid, манифест usable, modules:[]
    const r = runSessionStart(d)
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    assert.match(ctx, /не выбрано|не применяется/i) // честная заметка, без defaults
    assert.doesNotMatch(ctx, /Operator gate/i)       // дефолты НЕ инжектированы
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
