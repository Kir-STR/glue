import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plan, KNOWN_ENGINES } from '../lib/planner.mjs'
import { hashContent } from '../lib/hash.mjs'

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pack-a')
const TARGET = '.claude/rules/alpha.md'

// helper: один пак с модулем alpha; шаблон alpha.md (в pack-a) несёт известное содержимое.
function fixturePacks() {
  return [{
    name: 'glue-rules',
    version: '0.2.0',
    root: FIXTURE_ROOT,
    contract: { templatesDir: 'rules/templates', instructionsDir: 'rules/instructions' },
    registry: { alpha: { title: 'A', templates: ['alpha.md'], instructionBlock: 'alpha', dependsOn: [] } },
  }]
}

// то, что planner собирается записать в TARGET (= содержимое alpha.md в pack-a)
function readTemplateAlpha() {
  return readFileSync(join(FIXTURE_ROOT, 'rules', 'templates', 'alpha.md'), 'utf8')
}

function newProj() {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  return proj
}

const PREV_ALPHA = (writtenHash) => ({
  schemaVersion: '1',
  status: 'complete',
  files: [{ targetPath: TARGET, writtenHash, producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'alpha.md' }],
})

// --- named-кейсы ---

test('absent target → write', () => {
  const proj = newProj() // нет файла на диске
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  const w = r.writes.find((w) => w.targetPath === TARGET)
  assert.ok(w, 'in writes')
  assert.equal(w.expectedCurrentHash, null, 'expectedCurrentHash null (absent)')
  assert.equal(w.plannedHash, hashContent(readTemplateAlpha()))
  assert.ok(!r.conflicts.some((c) => c.targetPath === TARGET), 'not a conflict')
})

test('managed & current == writtenHash → write (update)', () => {
  const proj = newProj()
  const onDisk = 'previously delivered, now stale\n'
  writeFileSync(join(proj, TARGET), onDisk)
  const prev = PREV_ALPHA(hashContent(onDisk)) // writtenHash == on-disk
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  const w = r.writes.find((w) => w.targetPath === TARGET)
  assert.ok(w, 'in writes (update)')
  assert.equal(w.expectedCurrentHash, hashContent(onDisk), 'expectedCurrentHash == writtenHash')
  assert.ok(!r.conflicts.some((c) => c.targetPath === TARGET), 'not a conflict')
})

test('current != planned and != writtenHash → conflict', () => {
  const proj = newProj()
  writeFileSync(join(proj, TARGET), 'hand-edited managed\n')
  const prev = PREV_ALPHA(hashContent('orig delivered\n')) // writtenHash != on-disk
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  assert.ok(r.conflicts.some((c) => c.targetPath === TARGET), 'in conflicts')
  assert.ok(!r.writes.some((w) => w.targetPath === TARGET), 'not in writes')
})

test('unmanaged existing != planned → conflict', () => {
  const proj = newProj()
  writeFileSync(join(proj, TARGET), 'pre-existing not managed by us\n') // != planned, no prevManifest
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(r.conflicts.some((c) => c.targetPath === TARGET), 'in conflicts')
  assert.ok(!r.writes.some((w) => w.targetPath === TARGET), 'not in writes')
})

test('dropped managed module unchanged → delete', () => {
  const proj = newProj()
  const stale = '.claude/rules/old.md'
  const orig = 'orig\n'
  writeFileSync(join(proj, stale), orig) // on-disk == writtenHash
  const prev = {
    schemaVersion: '1', status: 'complete',
    files: [{ targetPath: stale, writtenHash: hashContent(orig), producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'old.md' }],
  }
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  const d = r.deletes.find((d) => d.targetPath === stale)
  assert.ok(d, 'in deletes')
  assert.equal(d.expectedCurrentHash, hashContent(orig), 'expectedCurrentHash == writtenHash')
  assert.ok(!r.conflicts.some((c) => c.targetPath === stale), 'not a conflict')
})

test('dropped managed module hand-edited → conflict', () => {
  const proj = newProj()
  const stale = '.claude/rules/old.md'
  writeFileSync(join(proj, stale), 'edited after delivery\n') // != writtenHash
  const prev = {
    schemaVersion: '1', status: 'complete',
    files: [{ targetPath: stale, writtenHash: hashContent('orig\n'), producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'old.md' }],
  }
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  assert.ok(r.conflicts.some((c) => c.targetPath === stale), 'in conflicts')
  assert.ok(!r.deletes.some((d) => d.targetPath === stale), 'not in deletes')
})

// --- ДОСЛОВНЫЕ (дефект-фиксы) ---

test('current == plannedHash → materialized, not write (recovery into manifest)', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  const content = readTemplateAlpha() // то, что planner собирается записать
  writeFileSync(join(proj, TARGET), content)           // файл уже == plannedHash
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(!r.writes.some((w) => w.targetPath === TARGET), 'not re-written')
  assert.ok(!r.conflicts.some((c) => c.targetPath === TARGET), 'not a conflict')
  assert.ok(r.materialized.some((m) => m.targetPath === TARGET && m.plannedHash === hashContent(content)),
    'recovery file present in materialized → reaches manifest')
})

test('force turns a conflict into a write', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  writeFileSync(join(proj, TARGET), 'hand-edited unmanaged\n')   // != planned, unmanaged
  const noForce = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(noForce.conflicts.some((c) => c.targetPath === TARGET))
  const forced = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: null, force: true })
  assert.ok(forced.writes.some((w) => w.targetPath === TARGET), 'force → write')
  assert.equal(forced.conflicts.length, 0)
})

test('force turns a hand-edited dropped file into a delete', () => {
  const proj = mkdtempSync(join(tmpdir(), 'glue-'))
  mkdirSync(join(proj, '.claude', 'rules'), { recursive: true })
  const stale = '.claude/rules/old.md'
  writeFileSync(join(proj, stale), 'edited\n')
  const prev = { schemaVersion: '1', status: 'complete', files: [{ targetPath: stale, writtenHash: hashContent('orig\n'), producerPack: 'glue-rules', packVersion: '0.2.0', sourceTemplate: 'old.md' }] }
  const noForce = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: false })
  assert.ok(noForce.conflicts.some((c) => c.targetPath === stale))
  const forced = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude'], projectDir: proj, prevManifest: prev, force: true })
  assert.ok(forced.deletes.some((d) => d.targetPath === stale), 'force → delete')
})

// --- Task A: engine contract ---

test('KNOWN_ENGINES exported and contains claude, codex, gemini', () => {
  assert.ok(Array.isArray(KNOWN_ENGINES), 'KNOWN_ENGINES is array')
  assert.ok(KNOWN_ENGINES.includes('claude'), 'claude present')
  assert.ok(KNOWN_ENGINES.includes('codex'), 'codex present')
  assert.ok(KNOWN_ENGINES.includes('gemini'), 'gemini present')
  assert.ok(!KNOWN_ENGINES.includes('agents'), 'old agents key absent')
})

test('codex engine — plan deliveredEngines contains codex when AGENTS.md.tmpl present', () => {
  const proj = newProj()
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude', 'codex'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(Array.isArray(r.deliveredEngines), 'deliveredEngines is array')
  assert.ok(r.deliveredEngines.includes('codex'), 'codex in deliveredEngines')
  assert.ok(r.deliveredEngines.includes('claude'), 'claude in deliveredEngines')
  // AGENTS.md target is in writes
  assert.ok(r.writes.some((w) => w.targetPath === 'AGENTS.md'), 'AGENTS.md in writes')
})

test('gemini engine — not in deliveredEngines when GEMINI.md.tmpl absent from fixture', () => {
  const proj = newProj()
  const r = plan({ packs: fixturePacks(), selected: ['alpha'], engines: ['claude', 'gemini'], projectDir: proj, prevManifest: null, force: false })
  assert.ok(!r.deliveredEngines.includes('gemini'), 'gemini absent from deliveredEngines (no template)')
})
