import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runAdopt } from '../src/adopt.mjs'
import { runInit } from '../src/init.mjs'
import { deliveryStatus } from '../src/status.mjs'
import { hashContent } from '../src/hash.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'bin', 'glue.mjs')

// Гоняет настоящий бинарь как пользовательский путь (образец — acceptance.test.mjs).
function runCli(args, projectDir) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  })
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status }
}

function tmp() { return mkdtempSync(join(tmpdir(), 'glue-adopt-')) }

const MODS = [
  { id: 'safety', decision: 'tailored-from-template', targetPaths: ['.claude/rules/safety.md'], referenceTemplate: 'safety.md' },
  { id: 'retro-loop', decision: 'local', targetPaths: ['.claude/rules/retro-loop.md'] },
  { id: 'glossary', decision: 'declined', targetPaths: [], referenceTemplate: 'glossary.md' },
]
const INSTR = { targetPath: 'CLAUDE.md', content: '# Карта', sourceTemplate: null, kind: 'instruction', expectedCurrentHash: null }
// Валидатор требует покрытия инструкц-файла заявленного движка: если тест
// сам не покрывает CLAUDE.md — добавляем стандартный write.
function plan(writes, materialized = []) {
  const hasInstr = [...writes, ...materialized].some((w) => w?.targetPath === 'CLAUDE.md')
  return { engines: ['claude'], modules: MODS, writes: hasInstr ? writes : [INSTR, ...writes], materialized }
}

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
    assert.equal(manifest.files.length, 2) // safety + CLAUDE.md
    const f = manifest.files.find((x) => x.targetPath === '.claude/rules/safety.md')
    assert.equal(f.writtenHash, hashContent('ПРОЕКТНЫЙ ТЕКСТ'))
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
    assert.equal(existsSync(join(d, 'CLAUDE.md')), false) // batch preflight: abort до любых мутаций
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
        ...plan([
          { targetPath: '.claude/rules/safety.md', content: 'S', expectedCurrentHash: null },
          { targetPath: 'src/evil.md', content: 'X', expectedCurrentHash: null },
        ]),
        modules: [...MODS, { id: 'evil', decision: 'local', targetPaths: ['src/evil.md'] }],
      },
      projectDir: d, now: 'T',
    }), /outside allowed zone/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('план без writes: materialized покрывает всё → успех, содержимое не тронуто', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(d, '.claude', 'rules', 'safety.md'), 'СВОЙ ТЕКСТ', 'utf8')
    writeFileSync(join(d, 'CLAUDE.md'), '# Карта проекта', 'utf8')
    const { manifest } = runAdopt({
      adoptPlan: plan([], [
        { targetPath: '.claude/rules/safety.md', sourceTemplate: null, kind: 'rule', expectedCurrentHash: hashContent('СВОЙ ТЕКСТ') },
        { targetPath: 'CLAUDE.md', sourceTemplate: null, kind: 'instruction', expectedCurrentHash: hashContent('# Карта проекта') },
      ]),
      projectDir: d, now: 'T',
    })
    assert.equal(readFileSync(join(d, '.claude', 'rules', 'safety.md'), 'utf8'), 'СВОЙ ТЕКСТ')
    assert.equal(manifest.files.length, 2)
    const f = manifest.files.find((x) => x.targetPath === '.claude/rules/safety.md')
    assert.equal(f.writtenHash, hashContent('СВОЙ ТЕКСТ'))
    assert.equal(manifest.modules.find((x) => x.id === 'retro-loop').decision, 'local')
    assert.equal(manifest.modules.find((x) => x.id === 'glossary').decision, 'declined')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('materialized TOCTOU: диск разошёлся с expectedCurrentHash → throw, манифест не записан', () => {
  const d = tmp()
  try {
    mkdirSync(join(d, '.claude', 'rules'), { recursive: true })
    writeFileSync(join(d, '.claude', 'rules', 'safety.md'), 'ИЗМЕНИЛОСЬ', 'utf8')
    assert.throws(() => runAdopt({
      adoptPlan: plan([], [{ targetPath: '.claude/rules/safety.md', sourceTemplate: null, kind: 'rule', expectedCurrentHash: hashContent('ЧТО ВИДЕЛ P2') }]),
      projectDir: d, now: 'T',
    }), /TOCTOU abort/)
    assert.equal(existsSync(join(d, '.glue', 'manifest.json')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('materialized отсутствующего на диске файла → TOCTOU abort', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan([], [{ targetPath: '.claude/rules/safety.md', sourceTemplate: null, kind: 'rule', expectedCurrentHash: hashContent('X') }]),
      projectDir: d, now: 'T',
    }), /TOCTOU abort/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('materialized без expectedCurrentHash → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan([], [{ targetPath: '.claude/rules/safety.md', sourceTemplate: null, kind: 'rule', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    }), /materialized requires string expectedCurrentHash/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('заявленный движок без инструкц-файла в плане → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: { engines: ['claude'], modules: MODS, writes: [{ targetPath: '.claude/rules/safety.md', content: 'S', expectedCurrentHash: null }], materialized: [] },
      projectDir: d, now: 'T',
    }), /engine 'claude': instruction file CLAUDE.md not covered/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('targetPath модуля вне local/declined не покрыт → Invalid adopt plan', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: { engines: ['claude'], modules: MODS, writes: [INSTR], materialized: [] },
      projectDir: d, now: 'T',
    }), /not covered by writes or materialized/)
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

test('дубликат таргета между writes и materialized → duplicate write target', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan(
        [{ targetPath: '.claude/rules/safety.md', content: 'X', expectedCurrentHash: null }],
        [{ targetPath: '.claude/rules/safety.md', sourceTemplate: null, kind: 'rule', expectedCurrentHash: hashContent('X') }],
      ),
      projectDir: d, now: 'T',
    }), /duplicate write target/)
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
      adoptPlan: plan([
        { targetPath: 'CLAUDE.md', content: '# Инструкции', sourceTemplate: null, kind: 'instruction', expectedCurrentHash: null },
        { targetPath: '.claude/rules/safety.md', content: 'S', sourceTemplate: null, kind: 'rule', expectedCurrentHash: null },
      ]),
      projectDir: d, now: 'T',
    })
    assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# Инструкции')
    assert.ok(manifest.files.some((f) => f.targetPath === 'CLAUDE.md'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('инструкц-таргет незаявленного движка: engines [claude], write в AGENTS.md → reject', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: plan([{ targetPath: 'AGENTS.md', content: 'X', expectedCurrentHash: null }]),
      projectDir: d, now: 'T',
    }), /Invalid adopt plan/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('backslash в targetPath (write и modules.targetPaths) → reject', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: {
        ...plan([{ targetPath: '.claude\\rules\\bs.md', content: 'X', expectedCurrentHash: null }]),
        modules: [...MODS, { id: 'bs', decision: 'local', targetPaths: ['.claude\\rules\\bs.md'] }],
      },
      projectDir: d, now: 'T',
    }), /use forward slashes/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('write в .glue/ → reject (манифест — артефакт движка)', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: {
        ...plan([{ targetPath: '.glue/manifest.json', content: '{}', expectedCurrentHash: null }]),
        modules: [...MODS, { id: 'g', decision: 'local', targetPaths: ['.glue/manifest.json'] }],
      },
      projectDir: d, now: 'T',
    }), /engine-owned/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('дубликат id в modules → reject', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: { ...plan([]), modules: [...MODS, { ...MODS[1] }] },
      projectDir: d, now: 'T',
    }), /duplicate module id/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('не-строка в modules.targetPaths → reject', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: { ...plan([]), modules: [...MODS, { id: 'n', decision: 'local', targetPaths: [42] }] },
      projectDir: d, now: 'T',
    }), /targetPaths element must be string/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('declined с непустым targetPaths → reject', () => {
  const d = tmp()
  try {
    assert.throws(() => runAdopt({
      adoptPlan: { ...plan([]), modules: [...MODS, { id: 'dcl', decision: 'declined', targetPaths: ['.claude/rules/dcl.md'], referenceTemplate: 'dcl.md' }] },
      projectDir: d, now: 'T',
    }), /declined module must have empty targetPaths/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

// Регрессия dogfood 2026-07-06: adopt поверх собственного init выкидывал из манифеста
// инструкц-файлы движков и нетронутые правила → status падал в fallback (incomplete).
test('re-delivery: init → adopt (writes + materialized) → status native без ошибок', () => {
  const d = tmp()
  try {
    const { manifest: m1 } = runInit({ selected: ['safety'], engines: ['claude'], projectDir: d, now: 'T1' })
    const prevSafety = m1.files.find((f) => f.targetPath === '.claude/rules/safety.md')
    const mats = m1.files.filter((f) => f !== prevSafety).map((f) => ({
      targetPath: f.targetPath, sourceTemplate: f.sourceTemplate, kind: 'instruction', expectedCurrentHash: f.writtenHash,
    }))
    const { manifest: m2 } = runAdopt({
      adoptPlan: {
        engines: ['claude'],
        modules: [{ id: 'safety', decision: 'tailored-from-template', targetPaths: ['.claude/rules/safety.md'], referenceTemplate: 'safety.md' }],
        writes: [{ targetPath: '.claude/rules/safety.md', content: 'ПРОЕКТНЫЙ ТЕКСТ', sourceTemplate: null, kind: 'rule', expectedCurrentHash: prevSafety.writtenHash }],
        materialized: mats,
      },
      projectDir: d, now: 'T2',
    })
    assert.equal(m2.files.length, m1.files.length)
    const st = deliveryStatus(d)
    assert.equal(st.mode, 'native')
    assert.deepEqual(st.errors, [])
    assert.deepEqual(st.missing, [])
    assert.deepEqual(st.changed, [])
    assert.equal(st.engines.claude.status, 'ok')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('CLI adopt: --plan file → ok:true, manifest в stdout', () => {
  const d = tmp()
  try {
    const planPath = join(d, 'adopt-plan.json')
    writeFileSync(planPath, JSON.stringify(plan([{ targetPath: '.claude/rules/safety.md', content: 'T', sourceTemplate: 'safety.md', kind: 'rule', expectedCurrentHash: null }])), 'utf8')
    const r = runCli(['adopt', '--plan', planPath], d)
    assert.equal(r.exitCode, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.manifest.schemaVersion, '2')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('CLI adopt: нет --plan / битый JSON → JSON error, exit 1', () => {
  const d = tmp()
  try {
    const r1 = runCli(['adopt'], d)
    assert.equal(r1.exitCode, 1)
    assert.equal(JSON.parse(r1.stdout).ok, false)
    const bad = join(d, 'bad.json')
    writeFileSync(bad, '{оборвано', 'utf8')
    const r2 = runCli(['adopt', '--plan', bad], d)
    assert.equal(r2.exitCode, 1)
    assert.equal(JSON.parse(r2.stdout).ok, false)
    const r3 = runCli(['adopt', '--plan', join(d, 'no-such.json')], d)
    assert.equal(r3.exitCode, 1)
    assert.equal(JSON.parse(r3.stdout).ok, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
