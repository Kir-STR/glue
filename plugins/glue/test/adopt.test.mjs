import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAdopt } from '../src/adopt.mjs'
import { hashContent } from '../src/hash.mjs'

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-adopt-')) }

const MODS = [
  { id: 'safety', decision: 'tailored-from-template', targetPaths: ['.claude/rules/safety.md'], referenceTemplate: 'safety.md' },
  { id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] },
  { id: 'glossary', decision: 'declined', targetPaths: [], referenceTemplate: 'glossary.md' },
]
function plan(writes) { return { engines: ['claude'], modules: MODS, writes } }

test('happy path: авторский текст записан, манифест v2 с decisions, declined без files', () => {
  const d = tmp()
  try {
    const { manifest } = runAdopt({
      adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', content: 'ПРОЕКТНЫЙ ТЕКСТ', sourceTemplate: 'safety.md', kind: 'rule', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    })
    assert.equal(readFileSync(join(d, '.claude', 'rules', 'safety.md'), 'utf8'), 'ПРОЕКТНЫЙ ТЕКСТ')
    assert.equal(manifest.schemaVersion, '2')
    assert.equal(manifest.modules.find((x) => x.id === 'glossary').decision, 'declined')
    assert.equal(manifest.files.length, 1)
    assert.equal(manifest.files[0].writtenHash, hashContent('ПРОЕКТНЫЙ ТЕКСТ'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('TOCTOU: диск разошёлся с expectedCurrentHash → throw, диск не тронут', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(d, '.claude', 'rules', 'safety.md'), 'ИЗМЕНИЛОСЬ ПОСЛЕ ОБЗОРА', 'utf8')
    assert.throws(() => runAdopt({
      adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', content: 'X', expectedCurrentHash: hashContent('ЧТО ВИДЕЛ P2') }]),
      projectDir: d, now: 'T',
    }), /TOCTOU abort/)
    assert.equal(readFileSync(join(d, '.claude', 'rules', 'safety.md'), 'utf8'), 'ИЗМЕНИЛОСЬ ПОСЛЕ ОБЗОРА')
    assert.equal(existsSync(join(d, '.glue', 'manifest.json')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('невалидный план: неизвестный decision / нет content / чужой движок → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({ adoptPlan: { engines: ['claude'], modules: [{ id: 'x', decision: 'kept', targetPaths: [] }], writes: [] }, projectDir: d, now: 'T' }), /Invalid adopt plan/)
    assert.throws(() => runAdopt({ adoptPlan: plan([{ targetPath: '.claude/rules/safety.md', expectedCurrentHash: null }]), projectDir: d, now: 'T' }), /Invalid adopt plan/)
    assert.throws(() => runAdopt({ adoptPlan: { ...plan([]), engines: ['borg'] }, projectDir: d, now: 'T' }), /Invalid adopt plan/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('запись вне разрешённой зоны → abort до мутаций', () => {
  const d = tmp()
  try {
    // Claiming-модуль проводит план через V2-связность: зонный abort — отдельная
    // защита safeTargetPath в preflight applyPlan, до любых мутаций.
    assert.throws(() => runAdopt({
      adoptPlan: {
        ...plan([{ targetPath: 'src/evil.md', content: 'X', expectedCurrentHash: null }]),
        modules: [...MODS, { id: 'evil', decision: 'local', targetPaths: ['src/evil.md'] }],
      },
      projectDir: d, now: 'T',
    }), /outside allowed zone/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('modules-only план (writes: []) → успех, files пуст, decisions записаны', () => {
  const d = tmp()
  try {
    const { manifest } = runAdopt({ adoptPlan: plan([]), projectDir: d, now: 'T' })
    assert.deepEqual(manifest.files, [])
    assert.equal(manifest.modules.find((x) => x.id === 'safety').decision, 'tailored-from-template')
    assert.equal(manifest.modules.find((x) => x.id === 'retro-loop').decision, 'local')
    assert.equal(manifest.modules.find((x) => x.id === 'glossary').decision, 'declined')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('дубликат targetPath в writes → Invalid adopt plan / duplicate write target', () => {
  const d = tmp()
  try {
    const w = { targetPath: '.claude/rules/safety.md', content: 'X', expectedCurrentHash: null }
    assert.throws(() => runAdopt({ adoptPlan: plan([w, { ...w }]), projectDir: d, now: 'T' }), /Invalid adopt plan/)
    assert.throws(() => runAdopt({ adoptPlan: plan([w, { ...w }]), projectDir: d, now: 'T' }), /duplicate write target/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('write не заявлен ни модулем, ни инструкц-таргетом → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan([{ targetPath: '.claude/rules/unclaimed.md', content: 'X', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    }), /Invalid adopt plan/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('write в CLAUDE.md (инструкц-таргет без модуля) — валиден и записывается', () => {
  const d = tmp()
  try {
    const { manifest } = runAdopt({
      adoptPlan: plan([{ targetPath: 'CLAUDE.md', content: '# Инструкции', sourceTemplate: null, kind: 'instruction', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    })
    assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# Инструкции')
    assert.equal(manifest.files[0].targetPath, 'CLAUDE.md')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
