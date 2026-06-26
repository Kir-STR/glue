import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { runInit } from '../src/init.mjs'
import { loadBundle, loadContract } from '../src/bundle.mjs'
import { hashContent } from '../src/hash.mjs'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = loadBundle(PLUGIN_ROOT, loadContract(PLUGIN_ROOT))
function tmp() { return mkdtempSync(join(tmpdir(), 'glue-init-')) }

test('runInit чистый проект → файлы + манифест', () => {
  const d = tmp()
  try {
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    assert.equal(conflicts.length, 0)
    assert.ok(existsSync(join(d, '.claude/rules/operator-gate.md')))
    assert.ok(existsSync(join(d, 'CLAUDE.md')))
    assert.equal(manifest.producerPack, undefined) // producerPack на file-entry, не на манифесте
    assert.equal(manifest.engines.length, 1)
    assert.ok(manifest.files.every((f) => f.producerPack === 'glue'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit пустые engines → default claude', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: [], projectDir: d, force: false, now: 'T' })
    assert.deepEqual(manifest.engines, ['claude'])
    assert.ok(existsSync(join(d, 'CLAUDE.md')))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit явный codex → НЕ добавляет claude', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['operator-gate'], engines: ['codex'], projectDir: d, force: false, now: 'T' })
    assert.deepEqual(manifest.engines, ['codex'])
    assert.ok(existsSync(join(d, 'AGENTS.md')))
    assert.equal(existsSync(join(d, 'CLAUDE.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit разрешает зависимости (pr-policy → worktree-workflow)', () => {
  const d = tmp()
  try {
    const { manifest } = runInit({ selected: ['pr-policy'], engines: ['claude'], projectDir: d, force: false, now: 'T' })
    assert.ok(manifest.modules.includes('worktree-workflow'))
    assert.ok(manifest.modules.indexOf('worktree-workflow') < manifest.modules.indexOf('pr-policy'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit неизвестный движок → throw до записи', () => {
  const d = tmp()
  try {
    assert.throws(() => runInit({ selected: ['operator-gate'], engines: ['borg'], projectDir: d, force: false, now: 'T' }), /Unknown engine/)
    assert.equal(existsSync(join(d, 'CLAUDE.md')), false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit повторный → идемпотентен (без конфликтов)', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(conflicts.length, 0)
    assert.ok(manifest) // materialized, не конфликт
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit правленный файл → конфликт, без перезаписи и манифеста', () => {
  const d = tmp()
  try {
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const rule = join(d, '.claude/rules/operator-gate.md')
    writeFileSync(rule, 'РУЧНАЯ ПРАВКА', 'utf8')
    rmSync(join(d, '.glue/manifest.json')) // имитируем потерю манифеста → unmanaged
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(manifest, null)
    assert.ok(conflicts.some((c) => c.targetPath === '.claude/rules/operator-gate.md'))
    assert.equal(readFileSync(rule, 'utf8'), 'РУЧНАЯ ПРАВКА') // не перезаписан
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('runInit поверх legacy-манифеста (producerPack glue-rules) → не падает, перезаписывает в новый формат', () => {
  const d = tmp()
  try {
    // чистый init создаёт файлы; затем подменяем манифест на legacy-форму (byte-identical файлы остаются)
    runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T1' })
    const legacy = {
      schemaVersion: '1', deliveryId: 'L', completedAt: 'L', engines: ['claude'], modules: ['operator-gate'], status: 'complete',
      files: [{ producerPack: 'glue-rules', packVersion: '0.2.1', sourceTemplate: 'operator-gate.md', targetPath: '.claude/rules/operator-gate.md', writtenHash: 'STALE' }],
    }
    mkdirSync(join(d, '.glue'), { recursive: true })
    writeFileSync(join(d, '.glue/manifest.json'), JSON.stringify(legacy), 'utf8')
    const { manifest, conflicts } = runInit({ selected: ['operator-gate'], engines: ['claude'], projectDir: d, force: false, now: 'T2' })
    assert.equal(conflicts.length, 0) // byte-identical → materialized, legacy writtenHash проигнорирован
    assert.ok(manifest.files.every((f) => f.producerPack === 'glue'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
